import { CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { Board } from './board';
import { BoardData, Item } from './models';

// The card is `<article cdkDrag>` holding the drag handle, `.card-quick-actions` (command + copy), and the body link as siblings.
function card(id: number, position: number): Item {
  return {
    id,
    projectId: 1,
    number: id,
    columnId: 1,
    title: `card ${id}`,
    description: '',
    position,
    backlogPosition: position,
    offsetY: 0,
    prUrls: [],
    relatedItems: [],
    assignee: '',
    closeReason: '',
    solution: '',
    favorite: false,
    dueAt: null,
    createdAt: '',
    updatedAt: '',
  };
}

const board = (): BoardData => ({
  columns: [{ id: 1, name: 'Todo', position: 0 }],
  items: [card(1, 0), card(2, 1)],
  settings: { cardLayout: 'pack', activeProjectId: 1 },
});

async function setup() {
  const reorderItems = vi.fn(() => of({ items: board().items }));
  TestBed.configureTestingModule({
    imports: [Board],
    providers: [
      provideRouter([]),
      {
        provide: Api,
        useValue: {
          board: () => of(board()),
          reorderItems,
          listCommandTemplates: () => of({ templates: [] }),
          listFilter: () => of({ query: '', statusIds: [] }),
          putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
      },
    ],
  });
  const f = TestBed.createComponent(Board);
  f.detectChanges();
  await f.whenStable();
  const root: HTMLElement = f.nativeElement;
  const article = root.querySelector('.task-card') as HTMLElement;
  const handle = article.querySelector('.card-drag-handle') as HTMLButtonElement;
  const link = article.querySelector('.task-card-body') as HTMLAnchorElement;
  const copy = article.querySelector('.copy-card-link') as HTMLButtonElement;
  return { f, root, article, handle, link, copy, reorderItems };
}

describe('Board card structure', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('places the drag handle, quick actions, and body link as siblings inside the draggable article', async () => {
    const { f, root, article, handle, link, copy } = await setup();
    const actions = article.querySelector('.card-quick-actions') as HTMLElement;
    const drags = f.debugElement.queryAll(By.directive(CdkDrag));
    const handles = f.debugElement.queryAll(By.directive(CdkDragHandle));
    expect(drags.length).toBe(2);
    expect(handles.length).toBe(2);
    expect(drags[0].nativeElement).toBe(article);
    expect(handles[0].nativeElement).toBe(handle);
    expect(article.tagName).toBe('ARTICLE');
    expect(article.getAttribute('data-card-id')).toBe('1');
    expect(handle.tagName).toBe('BUTTON');
    expect(handle.getAttribute('type')).toBe('button');
    expect(handle.textContent?.trim()).toBe('⋮⋮');
    expect(handle.getAttribute('aria-label')).toBe(
      'ITEM-001 card 1を移動（ドラッグまたは上下矢印キー）',
    );
    expect(handle.getAttribute('aria-describedby')).toBe('card-drag-help');
    expect(link.tagName).toBe('A');
    expect(link.hasAttribute('data-card-id')).toBe(false);
    expect(link.hasAttribute('aria-describedby')).toBe(false);
    expect(link.getAttribute('href')).toBe('/items/1?project=1');
    // The drag handle, quick-actions wrapper, and link are siblings. Copy stays inside quick actions, never inside the anchor.
    expect(handle.parentElement).toBe(article);
    expect(actions.parentElement).toBe(article);
    expect(link.parentElement).toBe(article);
    expect(actions.contains(copy)).toBe(true);
    expect(link.contains(handle)).toBe(false);
    expect(link.contains(copy)).toBe(false);
    expect(root.querySelectorAll('.task-card-body [data-card-id]').length).toBe(0);
  });

  it('handles arrow keys from the drag handle only, never from the link or copy button', async () => {
    const { handle, copy, link, reorderItems } = await setup();
    const press = (el: HTMLElement) => {
      const ev = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(ev);
      return ev;
    };
    const onCopy = press(copy);
    expect(onCopy.defaultPrevented).toBe(false);
    expect(reorderItems).not.toHaveBeenCalled();

    const onLink = press(link);
    expect(onLink.defaultPrevented).toBe(false);
    expect(reorderItems).not.toHaveBeenCalled();

    const onHandle = press(handle);
    expect(onHandle.defaultPrevented).toBe(true);
    expect(reorderItems).toHaveBeenCalledTimes(1);
  });

  it('navigates on a plain click of the link, leaves Ctrl-click to the browser, and does not navigate on handle click', async () => {
    const { handle, link } = await setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const handleClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    handle.dispatchEvent(handleClick);
    expect(navigate).not.toHaveBeenCalled();

    const ctrl = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    link.dispatchEvent(ctrl);
    expect(ctrl.defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();

    const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith(['/items', 1], { queryParams: { project: 1 } });
  });

  it('copying a link neither navigates nor reorders', async () => {
    const original = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    try {
      const { f, copy, reorderItems } = await setup();
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      const navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
      copy.dispatchEvent(ev);
      await vi.waitUntil(() => f.componentInstance.copyLinkAnnouncement() !== '');
      expect(ev.defaultPrevented).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(reorderItems).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: original });
    }
  });
});
