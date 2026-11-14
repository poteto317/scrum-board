import { CdkDrag } from '@angular/cdk/drag-drop';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { Board } from './board';
import { BoardData, Card } from './models';

// The card is `<article cdkDrag>` holding the copy button and the `<a>` link. These drive the real DOM so the
// split between "the article is dragged" and "the link navigates / handles keys / takes focus" stays pinned.
function card(id: number, position: number): Card {
  return {
    id,
    number: id,
    columnId: 1,
    title: `card ${id}`,
    description: '',
    position,
    backlogPosition: position,
    prUrls: [],
    assignee: '',
    createdAt: '',
    updatedAt: '',
  };
}

const board = (): BoardData => ({
  columns: [{ id: 1, name: 'Todo', position: 0 }],
  cards: [card(1, 0), card(2, 1)],
});

async function setup() {
  const reorderCards = vi.fn(() => of({ cards: board().cards }));
  TestBed.configureTestingModule({
    imports: [Board],
    providers: [
      provideRouter([]),
      { provide: Api, useValue: { board: () => of(board()), reorderCards } },
    ],
  });
  const f = TestBed.createComponent(Board);
  f.detectChanges();
  await f.whenStable();
  const root: HTMLElement = f.nativeElement;
  const article = root.querySelector('.task-card') as HTMLElement;
  const link = article.querySelector('.task-card-body') as HTMLAnchorElement;
  const copy = article.querySelector('.copy-card-link') as HTMLButtonElement;
  return { f, root, article, link, copy, reorderCards };
}

describe('Board card structure', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('drags the whole article and keeps the link a plain, focusable anchor', async () => {
    const { f, root, article, link, copy } = await setup();
    const drags = f.debugElement.queryAll(By.directive(CdkDrag));
    expect(drags.length).toBe(2);
    expect(drags[0].nativeElement).toBe(article);
    expect(article.tagName).toBe('ARTICLE');
    expect(article.getAttribute('data-card-id')).toBe('1');
    expect(link.tagName).toBe('A');
    expect(link.hasAttribute('data-card-id')).toBe(false);
    expect(link.getAttribute('href')).toBe('/cards/1');
    // The copy button and the link are siblings: a button must not sit inside an anchor.
    expect(copy.parentElement).toBe(article);
    expect(link.parentElement).toBe(article);
    expect(link.contains(copy)).toBe(false);
    expect(root.querySelectorAll('.task-card-body [data-card-id]').length).toBe(0);
  });

  it('handles arrow keys from the link only, never from the copy button', async () => {
    const { copy, link, reorderCards } = await setup();
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
    expect(reorderCards).not.toHaveBeenCalled();

    const onLink = press(link);
    expect(onLink.defaultPrevented).toBe(true);
    expect(reorderCards).toHaveBeenCalledTimes(1);
  });

  it('navigates on a plain click of the link but leaves a Ctrl-click to the browser', async () => {
    const { link } = await setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const ctrl = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    link.dispatchEvent(ctrl);
    expect(ctrl.defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();

    const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith(['/cards', 1]);
  });

  it('copying a link neither navigates nor reorders', async () => {
    const original = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    try {
      const { f, copy, reorderCards } = await setup();
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      const navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
      copy.dispatchEvent(ev);
      await vi.waitUntil(() => f.componentInstance.copyLinkAnnouncement() !== '');
      expect(ev.defaultPrevented).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(reorderCards).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: original });
    }
  });
});
