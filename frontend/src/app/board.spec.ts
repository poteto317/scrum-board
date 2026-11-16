import { provideRouter, Router } from '@angular/router';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Api } from './api';
import { Board } from './board';
import { CommandTemplatesSession } from './command-templates-session';
import { itemDetailUrl } from './item-link';
import { COPY_LINK_SUCCESS } from './copy-link-feedback';
import {
  COMMAND_ITEM_MENU_EMPTY,
  COPY_COMMAND_FAILURE,
  COPY_COMMAND_SUCCESS,
  resolveCommand,
} from './command-template';
import {
  readBoardScroll,
  readReturnTo,
  saveBoardScroll,
} from './list-scroll-session';
import { normalizeBoardData } from './board-data';
import { BoardData, Column } from './models';
import { pageScrollElement } from './page-scroll';
import { TODO_COLUMN_MISSING } from './todo-column';

describe('Board create requests', () => {
  it('freezes card inputs while creating and retains them on failure', () => {
    const pending = new Subject<never>();
    const api = {
      createItem: vi.fn(() => pending),
      listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
    };
    TestBed.configureTestingModule({
      providers: [CommandTemplatesSession, { provide: Api, useValue: api }],
    });
    const board = TestBed.runInInjectionContext(() => new Board());
    board.data.set(
      normalizeBoardData({
        columns: [
          { id: 1, name: 'Todo', position: 0 },
          { id: 2, name: 'Doing', position: 1 },
        ],
        items: [],
      }),
    );
    board.itemForm.setValue({ title: '保存するタイトル', description: '本文' });
    board.addItem();
    board.addItem();
    expect(api.createItem).toHaveBeenCalledTimes(1);
    expect(api.createItem).toHaveBeenCalledWith({
      title: '保存するタイトル',
      description: '本文',
      columnId: 1,
    });
    expect(board.itemForm.disabled).toBe(true);
    pending.error({ error: { message: '失敗' } });
    expect(board.itemForm.enabled).toBe(true);
    expect(board.itemForm.controls.title.value).toBe('保存するタイトル');
    expect(board.formError()).toBe('失敗');
  });
  it('always creates in Todo even when opened from another column', () => {
    const createItem = vi.fn(() =>
      of({
        id: 9,
        number: 9,
        columnId: 1,
        title: 'n',
        description: '',
        position: 0,
        backlogPosition: 0,
    offsetY: 0,
        prUrls: [],
        relatedItems: [],
        assignee: '',
        createdAt: '',
        updatedAt: '',
      }),
    );
    TestBed.configureTestingModule({
      providers: [
        CommandTemplatesSession,
        {
          provide: Api,
          useValue: { createItem, listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }) },
        },
      ],
    });
    const board = TestBed.runInInjectionContext(() => new Board());
    board.data.set(
      normalizeBoardData({
        columns: [
          { id: 1, name: 'Todo', position: 0 },
          { id: 2, name: 'Doing', position: 1 },
        ],
        items: [],
      }),
    );
    board.openItem(2);
    board.itemForm.setValue({ title: 'from doing', description: '' });
    board.addItem();
    expect(createItem).toHaveBeenCalledWith({
      title: 'from doing',
      description: '',
      columnId: 1,
    });
  });
  it('creates in an empty Todo column', () => {
    const createItem = vi.fn(() =>
      of({
        id: 1,
        number: 1,
        columnId: 1,
        title: 'first',
        description: '',
        position: 0,
        backlogPosition: 0,
    offsetY: 0,
        prUrls: [],
        relatedItems: [],
        assignee: '',
        createdAt: '',
        updatedAt: '',
      }),
    );
    TestBed.configureTestingModule({
      providers: [
        CommandTemplatesSession,
        {
          provide: Api,
          useValue: { createItem, listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }) },
        },
      ],
    });
    const board = TestBed.runInInjectionContext(() => new Board());
    board.data.set(normalizeBoardData({ columns: [{ id: 1, name: 'Todo', position: 0 }], items: [] }));
    board.itemForm.setValue({ title: 'first', description: '' });
    board.addItem();
    expect(createItem).toHaveBeenCalledWith({ title: 'first', description: '', columnId: 1 });
  });
  it('does not create when Todo column is missing', () => {
    const createItem = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        CommandTemplatesSession,
        {
          provide: Api,
          useValue: { createItem, listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }) },
        },
      ],
    });
    const board = TestBed.runInInjectionContext(() => new Board());
    board.data.set(normalizeBoardData({ columns: [{ id: 2, name: 'Doing', position: 0 }], items: [] }));
    board.itemForm.setValue({ title: 'x', description: '' });
    board.addItem();
    expect(createItem).not.toHaveBeenCalled();
    expect(board.formError()).toBe(TODO_COLUMN_MISSING);
  });
  it('omits the status select from the card modal', async () => {
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () =>
              of({
                columns: [
                  { id: 1, name: 'Todo', position: 0 },
                  { id: 2, name: 'Doing', position: 1 },
                ],
                items: [],
              }),
            listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
      showModal?: () => void;
      close?: () => void;
    };
    const origShowModal = proto.showModal;
    const origClose = proto.close;
    proto.showModal = function () {
      this.open = true;
    };
    proto.close = function () {
      this.open = false;
    };
    try {
      f.componentInstance.openItem(2);
      f.detectChanges();
      expect(f.nativeElement.querySelector('#card-status')).toBeNull();
      f.componentInstance.close();
      f.detectChanges();
    } finally {
      proto.showModal = origShowModal;
      proto.close = origClose;
    }
  });
  it('freezes column input while creating and restores it after failure', () => {
    const pending = new Subject<never>();
    const api = {
      createColumn: vi.fn(() => pending),
      listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
    };
    TestBed.configureTestingModule({
      providers: [CommandTemplatesSession, { provide: Api, useValue: api }],
    });
    const board = TestBed.runInInjectionContext(() => new Board());
    board.columnForm.controls.name.setValue('Review');
    board.addColumn();
    expect(board.columnForm.disabled).toBe(true);
    pending.error({ error: { message: '重複' } });
    expect(board.columnForm.enabled).toBe(true);
    expect(board.columnForm.controls.name.value).toBe('Review');
  });
});

const singleCardBoard = (assignee = '') =>
  of({
    columns: [{ id: 1, name: 'Todo', position: 0 }],
    items: [
      {
        id: 17,
        number: 2,
        columnId: 1,
        title: 'Task',
        description: '',
        position: 0,
        backlogPosition: 0,
    offsetY: 0,
        prUrls: [],
        relatedItems: [],
        assignee,
        createdAt: '',
        updatedAt: '',
      },
    ],
  });

describe('Board assignee chip', () => {
  it('shows an assignee chip when set and hides it when empty', async () => {
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => singleCardBoard('Cursor'),
            listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    const chip = f.nativeElement.querySelector('.card-assignee') as HTMLElement;
    expect(chip.textContent?.trim()).toBe('Cursor');
    expect(chip.getAttribute('data-assignee')).toBe('cursor');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: { board: singleCardBoard, listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
 listFilter: () => of({ query: '', statusIds: [] }),
 putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const empty = TestBed.createComponent(Board);
    empty.detectChanges();
    await empty.whenStable();
    empty.detectChanges();
    expect(empty.nativeElement.querySelector('.card-assignee')).toBeNull();
  });
});

describe('Board task numbers', () => {
  it('links to the same public number shown on the card', async () => {
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: { board: singleCardBoard, listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
 listFilter: () => of({ query: '', statusIds: [] }),
 putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    const card: HTMLElement = f.nativeElement.querySelector('.task-card');
    expect(card.tagName.toLowerCase()).toBe('article');
    expect(f.nativeElement.querySelector('.card-arrow')).toBeNull();
    const link: HTMLAnchorElement = card.querySelector('.task-card-body') as HTMLAnchorElement;
    expect(link.textContent).toContain('ITEM-002');
    // A real link keeps "open in new tab", "copy link" and the status-bar URL working.
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/items/2');
    expect(link.getAttribute('role')).toBeNull();
    // The accessible name of the link stays the card's own text; the drag handle carries the move label and help.
    expect(link.getAttribute('aria-label')).toBeNull();
    expect(link.getAttribute('aria-describedby')).toBeNull();
    const handle = card.querySelector('.card-drag-handle') as HTMLButtonElement;
    expect(handle.getAttribute('aria-label')).toBe(
      'ITEM-002 Taskを移動（ドラッグまたは上下矢印キー）',
    );
    const helpId = handle.getAttribute('aria-describedby') as string;
    expect(f.nativeElement.querySelector(`#${helpId}`)?.textContent).toContain('ドラッグ');
    expect(f.nativeElement.querySelector(`#${helpId}`)?.textContent).toContain('ステータス');
    const copyBtn = f.nativeElement.querySelector('.copy-card-link');
    expect(copyBtn).not.toBeNull();
    expect(copyBtn.getAttribute('aria-label')).toBe('ITEM-002 のリンクをコピー');
  });
});

describe('Board copy card link', () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: { board: singleCardBoard, listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
 listFilter: () => of({ query: '', statusIds: [] }),
 putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  const create = async () => {
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    return f;
  };

  it('copies the public card detail URL on success without navigating', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const f = await create();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const copyBtn = f.nativeElement.querySelector('.copy-card-link') as HTMLButtonElement;
    copyBtn.click();
    await vi.waitUntil(() => f.componentInstance.copyLinkAnnouncement() !== '');
    f.detectChanges();
    expect(writeText).toHaveBeenCalledWith(itemDetailUrl(window.location.origin, 2));
    expect(navigateSpy).not.toHaveBeenCalled();
    const live = f.nativeElement.querySelector('.copy-feedback-banner') as HTMLElement;
    expect(live).not.toBeNull();
    expect(live.classList.contains('copy-feedback-banner--ok')).toBe(true);
    expect(live.querySelector('.copy-feedback-banner__icon')).not.toBeNull();
    expect(live.textContent).toContain('リンクをコピーしました');
  });

  it('announces failure when clipboard writeText rejects', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const f = await create();
    const copyBtn = f.nativeElement.querySelector('.copy-card-link') as HTMLButtonElement;
    copyBtn.click();
    await vi.waitUntil(() => f.componentInstance.copyLinkAnnouncement() !== '');
    f.detectChanges();
    const live = f.nativeElement.querySelector('.copy-feedback-banner') as HTMLElement;
    expect(live.classList.contains('copy-feedback-banner--error')).toBe(true);
    expect(live.querySelector('.copy-feedback-banner__icon')).not.toBeNull();
    expect(live.textContent).toContain('リンクをコピーできませんでした');
  });
});

describe('Board copy command menu', () => {
  const originalClipboard = navigator.clipboard;
  const template = {
    id: 4,
    name: 'gh pr',
    template: 'gh pr view {{url}} extra',
    position: 0,
  };

  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  const create = async (
    templates: { id: number; name: string; template: string; position: number }[],
    listItemCommandTemplatesByNumber = vi.fn(() => of({ templates })),
  ) => {
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: { board: singleCardBoard, listItemCommandTemplatesByNumber,
 listFilter: () => of({ query: '', statusIds: [] }),
 putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return { f, listItemCommandTemplatesByNumber };
  };

  const openMenu = async (f: {
    nativeElement: HTMLElement;
    detectChanges(): void;
    whenStable(): Promise<unknown>;
  }) => {
    const button = f.nativeElement.querySelector(
      '.copy-command-button',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button!.getAttribute('aria-haspopup')).toBe('menu');
    expect(button!.getAttribute('aria-expanded')).toBe('false');
    button!.click();
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    const menu = f.nativeElement.querySelector('.copy-command-menu') as HTMLElement | null;
    expect(menu).not.toBeNull();
    expect(button!.getAttribute('aria-expanded')).toBe('true');
    return { button: button!, menu: menu! };
  };

  it('copies immediately when only one template is linked without leaving the menu open', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const { f, listItemCommandTemplatesByNumber } = await create([template]);
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const button = f.nativeElement.querySelector(
      '.copy-command-button',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    button!.click();
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(listItemCommandTemplatesByNumber).toHaveBeenCalled();
    await vi.waitUntil(() => {
      f.detectChanges();
      return (f.nativeElement.querySelector('.copy-feedback-banner')?.textContent ?? '').includes(
        COPY_COMMAND_SUCCESS,
      );
    });
    expect(writeText).toHaveBeenCalledWith(
      resolveCommand(template.template, itemDetailUrl(window.location.origin, 2)),
    );
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(f.nativeElement.querySelector('.copy-command-menu')).toBeNull();
    expect(button!.getAttribute('aria-expanded')).toBe('false');
    const live = f.nativeElement.querySelector('.copy-feedback-banner') as HTMLElement;
    expect(live.classList.contains('copy-feedback-banner--ok')).toBe(true);
    expect(live.querySelector('.copy-feedback-banner__icon')).not.toBeNull();
    expect(live.textContent).toContain(COPY_COMMAND_SUCCESS);
  });

  it('keeps the menu open for multiple templates and copies the chosen item', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const second = { id: 8, name: 'echo', template: 'echo {{url}}', position: 1 };
    const { f, listItemCommandTemplatesByNumber } = await create([template, second]);
    const { menu } = await openMenu(f);
    expect(listItemCommandTemplatesByNumber).toHaveBeenCalled();
    expect(menu.textContent).toContain(template.name);
    expect(menu.textContent).toContain(second.name);
    (menu.querySelector('button') as HTMLButtonElement).click();
    await vi.waitUntil(() => {
      f.detectChanges();
      return (f.nativeElement.querySelector('.copy-feedback-banner')?.textContent ?? '').includes(
        COPY_COMMAND_SUCCESS,
      );
    });
    expect(writeText).toHaveBeenCalledWith(
      resolveCommand(template.template, itemDetailUrl(window.location.origin, 2)),
    );
  });

  it('announces command copy failure in the shared live region', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const { f } = await create([template]);
    const button = f.nativeElement.querySelector(
      '.copy-command-button',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    button!.click();
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    await vi.waitUntil(() => {
      f.detectChanges();
      return (f.nativeElement.querySelector('.copy-feedback-banner')?.textContent ?? '').includes(
        COPY_COMMAND_FAILURE,
      );
    });
    const live = f.nativeElement.querySelector('.copy-feedback-banner') as HTMLElement;
    expect(live.classList.contains('copy-feedback-banner--error')).toBe(true);
    expect(live.querySelector('.copy-feedback-banner__icon')).not.toBeNull();
    expect(live.textContent).toContain(COPY_COMMAND_FAILURE);
  });

  it('shows an empty notice and does not copy when no templates exist', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const { f } = await create([]);
    const { menu } = await openMenu(f);
    expect(menu.textContent).toContain(COMMAND_ITEM_MENU_EMPTY);
    expect(menu.querySelector('button, [role="menuitem"]')).toBeNull();
    menu.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(writeText).not.toHaveBeenCalled();
  });

  it('shows a load failure instead of the empty-registration notice when listing templates fails', async () => {
    const { f } = await create(
      [],
      vi.fn(() => throwError(() => ({ status: 404 }))),
    );
    const { menu } = await openMenu(f);
    expect(menu.textContent).not.toContain(COMMAND_ITEM_MENU_EMPTY);
    expect(menu.textContent).toContain('通信に失敗しました');
    expect(menu.querySelector('button, [role="menuitem"]')).toBeNull();
  });

  it('does not auto-copy a single template after the menu was closed before the response', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const { Subject } = await import('rxjs');
    const delayed = new Subject<{ templates: typeof template[] }>();
    const { f } = await create([template], vi.fn(() => delayed.asObservable()));
    const button = f.nativeElement.querySelector(
      '.copy-command-button',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    button!.click();
    f.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.detectChanges();
    delayed.next({ templates: [template] });
    delayed.complete();
    await f.whenStable();
    f.detectChanges();
    expect(writeText).not.toHaveBeenCalled();
    expect(f.nativeElement.querySelector('.copy-command-menu')).toBeNull();
  });

  it('raises the card while its command menu is open', async () => {
    const second = { id: 8, name: 'echo', template: 'echo {{url}}', position: 1 };
    const { f } = await create([template, second]);
    const card = f.nativeElement.querySelector('.task-card') as HTMLElement;
    expect(card.classList.contains('command-menu-open')).toBe(false);
    await openMenu(f);
    expect(card.classList.contains('command-menu-open')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.detectChanges();
    expect(card.classList.contains('command-menu-open')).toBe(false);
  });

  it('shows only the latest copy feedback when a link copy follows a command copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const { f } = await create([template]);
    const button = f.nativeElement.querySelector(
      '.copy-command-button',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    button!.click();
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    await vi.waitUntil(() => {
      f.detectChanges();
      return (f.nativeElement.querySelector('.copy-feedback-banner')?.textContent ?? '').includes(
        COPY_COMMAND_SUCCESS,
      );
    });
    (f.nativeElement.querySelector('.copy-card-link') as HTMLButtonElement).click();
    await vi.waitUntil(() => {
      f.detectChanges();
      return f.componentInstance.copyFeedback() === COPY_LINK_SUCCESS;
    });
    const live = f.nativeElement.querySelector('.copy-feedback-banner').textContent ?? '';
    expect(live).toContain(COPY_LINK_SUCCESS);
    expect(live).not.toContain(COPY_COMMAND_SUCCESS);
    expect(f.componentInstance.copyCommandAnnouncement()).toBe(COPY_COMMAND_SUCCESS);
  });

  it('renders the template name as text and closes on Escape or an outside click', async () => {
    const { f } = await create([
      { id: 4, name: '<b>gh</b>', template: 'echo {{url}}', position: 0 },
      { id: 5, name: 'other', template: 'cat {{url}}', position: 1 },
    ]);
    const { menu } = await openMenu(f);
    expect(menu.textContent).toContain('<b>gh</b>');
    expect(menu.querySelector('b')).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.detectChanges();
    expect(f.nativeElement.querySelector('.copy-command-menu')).toBeNull();
    await openMenu(f);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    f.detectChanges();
    expect(f.nativeElement.querySelector('.copy-command-menu')).toBeNull();
  });
});

function sampleBoard(columns: Column[]) {
  return normalizeBoardData({
    columns: columns.map((c) => ({ ...c })),
    items: [
      {
        id: 1,
        number: 1,
        columnId: columns[0].id,
        title: 'Card 1',
        description: '',
        position: 0,
        backlogPosition: 0,
        offsetY: 0,
        prUrls: [],
        relatedItems: [],
        assignee: '',
        createdAt: '',
        updatedAt: '',
      },
    ],
    settings: { cardLayout: 'pack' },
  });
}

function makeColumns(): Column[] {
  return [
    { id: 1, name: 'Todo', position: 0 },
    { id: 2, name: 'Doing', position: 1 },
    { id: 3, name: 'Done', position: 2 },
    { id: 9, name: 'Review', position: 3 },
  ];
}

function mockColumnRects(root: HTMLElement, rects: { left: number; width: number }[]) {
  const sections = Array.from(root.querySelectorAll<HTMLElement>('.kanban-column'));
  sections.forEach((el, i) => {
    const r = rects[i] ?? { left: i * 320, width: 300 };
    el.getBoundingClientRect = () =>
      ({
        left: r.left,
        right: r.left + r.width,
        width: r.width,
        top: 0,
        bottom: 200,
        height: 200,
        x: r.left,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  });
}

function dispatchDragEvent(
  target: EventTarget,
  type: string,
  opts: { clientX?: number; clientY?: number; relatedTarget?: EventTarget | null } = {},
) {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    clientX: number;
    clientY: number;
    relatedTarget: EventTarget | null;
    dataTransfer: {
      setData: ReturnType<typeof vi.fn>;
      getData: ReturnType<typeof vi.fn>;
      effectAllowed: string;
      dropEffect: string;
    };
  };
  Object.defineProperty(ev, 'clientX', { value: opts.clientX ?? 0 });
  Object.defineProperty(ev, 'clientY', { value: opts.clientY ?? 0 });
  Object.defineProperty(ev, 'relatedTarget', { value: opts.relatedTarget ?? null });
  Object.defineProperty(ev, 'dataTransfer', {
    value: {
      setData: vi.fn(),
      getData: vi.fn(() => ''),
      effectAllowed: 'uninitialized',
      dropEffect: 'none',
    },
  });
  target.dispatchEvent(ev);
  return ev;
}

describe('Board column reordering', () => {
  it('reorders columns via drag-and-drop (including over column gap) and persists via API', async () => {
    const cols = makeColumns();
    const reorderColumns = vi.fn((ids: number[]) =>
      of({
        columns: ids.map((id, position) => ({ ...cols.find((c) => c.id === id)!, position })),
      }),
    );
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(sampleBoard(cols)),
            reorderColumns,
            listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();

    mockColumnRects(f.nativeElement, [
      { left: 0, width: 300 }, // midpoint 150
      { left: 320, width: 300 }, // midpoint 470
      { left: 640, width: 300 }, // midpoint 790
      { left: 960, width: 300 }, // midpoint 1110
    ]);

    const dragZones = f.nativeElement.querySelectorAll(
      '.column-drag-zone',
    ) as NodeListOf<HTMLElement>;
    const scrollRegion = f.nativeElement.querySelector('.board-scroll') as HTMLElement;
    const columns = f.nativeElement.querySelectorAll('.kanban-column') as NodeListOf<HTMLElement>;

    // 後方→前方: Review (index 3, id=9) を Done (index 2, midpoint 790) の前（gap x=630）へドロップ
    dispatchDragEvent(dragZones[3], 'dragstart', { clientX: 980 });
    f.detectChanges();
    expect(f.componentInstance.draggingColumnId()).toBe(9);

    dispatchDragEvent(scrollRegion, 'dragover', { clientX: 630 });
    f.detectChanges();
    expect(f.componentInstance.dropSlot()).toBe(2);
    expect(columns[2].classList.contains('drop-before')).toBe(true);

    dispatchDragEvent(scrollRegion, 'drop', { clientX: 630 });
    dispatchDragEvent(dragZones[3], 'dragend');
    f.detectChanges();

    expect(reorderColumns).toHaveBeenCalledWith([1, 2, 9, 3]);
    let titles = Array.from(
      f.nativeElement.querySelectorAll('.column-heading h2') as NodeListOf<HTMLElement>,
    ).map((el) => el.textContent?.trim());
    expect(titles).toEqual(['Todo', 'Doing', 'Review', 'Done']);
    expect(f.nativeElement.querySelector('[aria-live="polite"]')?.textContent).toContain('Review');

    // 前方→後方: Todo (index 0, id=1) を末尾（slot 4）へドロップし .drop-after を確認
    mockColumnRects(f.nativeElement, [
      { left: 0, width: 300 },
      { left: 320, width: 300 },
      { left: 640, width: 300 },
      { left: 960, width: 300 },
    ]);
    const updatedZones = f.nativeElement.querySelectorAll(
      '.column-drag-zone',
    ) as NodeListOf<HTMLElement>;
    const updatedColumns = f.nativeElement.querySelectorAll(
      '.kanban-column',
    ) as NodeListOf<HTMLElement>;
    dispatchDragEvent(updatedZones[0], 'dragstart', { clientX: 80 });
    dispatchDragEvent(scrollRegion, 'dragover', { clientX: 1200 });
    f.detectChanges();
    expect(f.componentInstance.dropSlot()).toBe(4);
    expect(updatedColumns[3].classList.contains('drop-after')).toBe(true);

    dispatchDragEvent(scrollRegion, 'drop', { clientX: 1200 });
    dispatchDragEvent(updatedZones[0], 'dragend');
    f.detectChanges();

    expect(reorderColumns).toHaveBeenCalledWith([2, 9, 3, 1]);
    titles = Array.from(
      f.nativeElement.querySelectorAll('.column-heading h2') as NodeListOf<HTMLElement>,
    ).map((el) => el.textContent?.trim());
    expect(titles).toEqual(['Doing', 'Review', 'Done', 'Todo']);
  });

  it('ignores same-position drop, external drags, and keeps add-card icon button outside draggable zone', async () => {
    const cols = makeColumns();
    const reorderColumns = vi.fn();
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(sampleBoard(cols)),
            reorderColumns,
            listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    mockColumnRects(f.nativeElement, [
      { left: 0, width: 300 },
      { left: 320, width: 300 },
      { left: 640, width: 300 },
      { left: 960, width: 300 },
    ]);

    const addBtn = f.nativeElement.querySelector('.column-heading .icon-button') as HTMLElement;
    expect(addBtn.closest('[draggable="true"]')).toBeNull();
    dispatchDragEvent(addBtn, 'dragstart', { clientX: 250 });
    expect(f.componentInstance.draggingColumnId()).toBeNull();

    const scrollRegion = f.nativeElement.querySelector('.board-scroll') as HTMLElement;
    // External / card link drag while draggingColumnId is null must be ignored
    const extOver = dispatchDragEvent(scrollRegion, 'dragover', { clientX: 700 });
    expect(extOver.defaultPrevented).toBe(false);
    dispatchDragEvent(scrollRegion, 'drop', { clientX: 700 });
    expect(reorderColumns).not.toHaveBeenCalled();

    // Same-position drop (Doing dragged over own midpoint 400 -> slot 1) is no-op
    const dragZones = f.nativeElement.querySelectorAll(
      '.column-drag-zone',
    ) as NodeListOf<HTMLElement>;
    dispatchDragEvent(dragZones[1], 'dragstart', { clientX: 350 });
    dispatchDragEvent(scrollRegion, 'dragover', { clientX: 400 });
    expect(f.componentInstance.dropSlot()).toBeNull();
    dispatchDragEvent(scrollRegion, 'drop', { clientX: 400 });
    dispatchDragEvent(dragZones[1], 'dragend');
    expect(reorderColumns).not.toHaveBeenCalled();
  });

  it('moves columns with ArrowLeft/ArrowRight keys, guards boundaries, and preserves handle focus', async () => {
    const cols = makeColumns();
    const reorderColumns = vi.fn((ids: number[]) =>
      of({
        columns: ids.map((id, position) => ({ ...cols.find((c) => c.id === id)!, position })),
      }),
    );
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(sampleBoard(cols)),
            reorderColumns,
            listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();

    const getHandles = () =>
      Array.from(
        f.nativeElement.querySelectorAll('.column-drag-handle') as NodeListOf<HTMLButtonElement>,
      );

    // First column ArrowLeft -> boundary no-op
    getHandles()[0].focus();
    const firstLeft = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true });
    getHandles()[0].dispatchEvent(firstLeft);
    expect(reorderColumns).not.toHaveBeenCalled();
    expect(firstLeft.defaultPrevented).toBe(false);

    // Last column ArrowRight -> boundary no-op
    getHandles()[3].focus();
    const lastRight = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
    getHandles()[3].dispatchEvent(lastRight);
    expect(reorderColumns).not.toHaveBeenCalled();

    // Move Review (index 3, id=9) left before Done -> [1, 2, 9, 3]
    const moveLeft = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true });
    getHandles()[3].dispatchEvent(moveLeft);
    expect(moveLeft.defaultPrevented).toBe(true);
    f.detectChanges();
    await f.whenStable();

    expect(reorderColumns).toHaveBeenCalledWith([1, 2, 9, 3]);
    expect(document.activeElement).toBe(getHandles()[2]);
    expect(f.nativeElement.querySelector('[aria-live="polite"]')?.textContent).toContain('Review');

    // Move Todo (index 0, id=1) right after Doing -> [2, 1, 9, 3]
    getHandles()[0].focus();
    const moveRight = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
    getHandles()[0].dispatchEvent(moveRight);
    expect(moveRight.defaultPrevented).toBe(true);
    f.detectChanges();
    await f.whenStable();

    expect(reorderColumns).toHaveBeenCalledWith([2, 1, 9, 3]);
    expect(document.activeElement).toBe(getHandles()[1]);
  });

  it('locks concurrent reorder and add-column while saving, and disables reorder when <= 1 column', async () => {
    const pending = new Subject<{ columns: Column[] }>();
    const cols = makeColumns();
    const reorderColumns = vi.fn(() => pending);
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(sampleBoard(cols)),
            reorderColumns,
            listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();

    const handles = f.nativeElement.querySelectorAll(
      '.column-drag-handle',
    ) as NodeListOf<HTMLButtonElement>;
    handles[3].focus();
    handles[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }));
    f.detectChanges();

    expect(f.componentInstance.reordering()).toBe(true);
    expect(f.componentInstance.canReorder()).toBe(false);
    expect(handles[3].hasAttribute('disabled')).toBe(false);
    expect(handles[3].getAttribute('aria-disabled')).toBe('true');
    const addColumnBtn = f.nativeElement.querySelector('.add-column-tile') as HTMLButtonElement;
    expect(addColumnBtn.disabled).toBe(true);

    // Second move while in-flight is ignored
    handles[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }));
    f.componentInstance.openColumn();
    expect(reorderColumns).toHaveBeenCalledTimes(1);
    expect(f.componentInstance.modal()).toBeNull();

    pending.next({ columns: [cols[0], cols[1], cols[3], cols[2]] });
    pending.complete();
    f.detectChanges();
    expect(f.componentInstance.reordering()).toBe(false);
    expect(f.componentInstance.canReorder()).toBe(true);

    // Single column disables reordering
    f.componentInstance.data.set(sampleBoard([cols[0]]));
    f.detectChanges();
    expect(f.componentInstance.canReorder()).toBe(false);
  });

  it('rolls back order on 500 or 409 error without hiding the board and recovers on reload', async () => {
    const cols = makeColumns();
    let boardCalls = 0;
    const reorderSubject = new Subject<{ columns: Column[] }>();
    const board = vi.fn(() => {
      boardCalls++;
      return of(
        sampleBoard(boardCalls === 1 ? cols : [...cols, { id: 10, name: 'QA', position: 4 }]),
      );
    });
    const reorderColumns = vi.fn(() => reorderSubject);

    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: { board, reorderColumns, listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
 listFilter: () => of({ query: '', statusIds: [] }),
 putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();

    const getHandles = () =>
      Array.from(
        f.nativeElement.querySelectorAll('.column-drag-handle') as NodeListOf<HTMLButtonElement>,
      );

    // 500 error: rollback + alert with dismiss button + board stays visible + handle focus retained
    getHandles()[3].focus();
    getHandles()[3].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }),
    );
    f.detectChanges();
    expect(f.componentInstance.data().columns.map((c) => c.id)).toEqual([1, 2, 9, 3]);

    reorderSubject.error({ status: 500, error: { message: '保存失敗' } });
    f.detectChanges();
    await f.whenStable();
    expect(f.componentInstance.data().columns.map((c) => c.id)).toEqual([1, 2, 3, 9]);
    expect(document.activeElement).toBe(getHandles()[3]);
    expect(f.nativeElement.querySelectorAll('.kanban-column').length).toBe(4);
    const alert = f.nativeElement.querySelector('.reorder-alert') as HTMLElement;
    expect(alert.textContent).toContain('保存失敗');
    expect(alert.querySelector('.reorder-dismiss')).not.toBeNull();

    (alert.querySelector('.reorder-dismiss') as HTMLButtonElement).click();
    f.detectChanges();
    expect(f.nativeElement.querySelector('.reorder-alert')).toBeNull();

    // 409 conflict: rollback + reload button (no dismiss button) + handle focus retained -> reload clears alert
    const conflictSubject = new Subject<{ columns: Column[] }>();
    reorderColumns.mockReturnValueOnce(conflictSubject);
    getHandles()[3].focus();
    getHandles()[3].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }),
    );
    conflictSubject.error({
      status: 409,
      error: { message: '列の構成が変更されています。' },
    });
    f.detectChanges();
    await f.whenStable();

    expect(document.activeElement).toBe(getHandles()[3]);
    const conflictAlert = f.nativeElement.querySelector('.reorder-alert') as HTMLElement;
    expect(conflictAlert.textContent).toContain('列の構成が変更されています。');
    expect(conflictAlert.querySelector('.reorder-dismiss')).toBeNull();
    const reloadBtn = conflictAlert.querySelector('.reorder-reload') as HTMLButtonElement;
    expect(reloadBtn).not.toBeNull();

    reloadBtn.click();
    f.detectChanges();
    await f.whenStable();
    expect(board).toHaveBeenCalledTimes(2);
    expect(f.nativeElement.querySelector('.reorder-alert')).toBeNull();
    expect(f.componentInstance.data().columns.length).toBe(5);
  });

  it('handles non-element dragstart targets without throwing and does not steal focus when modal is open', async () => {
    const cols = makeColumns();
    const pending = new Subject<{ columns: Column[] }>();
    const reorderColumns = vi.fn(() => pending);
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(sampleBoard(cols)),
            reorderColumns,
            listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();

    // Text node inside <h2> bubbling dragstart must be prevented without TypeError
    const headingText = f.nativeElement.querySelector('.column-heading h2')?.firstChild as Text;
    const textDrag = dispatchDragEvent(headingText, 'dragstart', { clientX: 50 });
    expect(textDrag.defaultPrevented).toBe(true);
    expect(f.componentInstance.draggingColumnId()).toBeNull();

    // A column save is in flight when a modal appears -> settling must not steal focus from the modal.
    // (The add-card button is disabled while saving, so the modal state is set directly to build this case.)
    const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
      showModal?: () => void;
      close?: () => void;
    };
    const origShowModal = proto.showModal;
    const origClose = proto.close;
    proto.showModal = function () {
      this.open = true;
    };
    proto.close = function () {
      this.open = false;
    };
    try {
      const handles = f.nativeElement.querySelectorAll(
        '.column-drag-handle',
      ) as NodeListOf<HTMLButtonElement>;
      handles[3].focus();
      handles[3].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }),
      );
      expect(reorderColumns).toHaveBeenCalledTimes(1); // the save really is in flight
      f.componentInstance.modal.set('item');
      f.detectChanges();
      const titleInput = f.nativeElement.querySelector('#card-title') as HTMLInputElement;
      titleInput.focus();

      pending.next({ columns: [cols[0], cols[1], cols[3], cols[2]] });
      pending.complete();
      f.detectChanges();
      await f.whenStable();

      expect(document.activeElement).toBe(titleInput);
    } finally {
      f.componentInstance.close();
      f.detectChanges();
      proto.showModal = origShowModal;
      proto.close = origClose;
    }
  });
});

describe('Board card reordering', () => {
  function twoCardBoard(): BoardData {
    return {
      columns: makeColumns().slice(0, 2),
      items: [
        {
          id: 1,
          number: 1,
          columnId: 1,
          title: 'A',
          description: '',
          position: 0,
          backlogPosition: 0,
    offsetY: 0,
          prUrls: [],
          relatedItems: [],
          assignee: '',
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 2,
          number: 2,
          columnId: 1,
          title: 'B',
          description: '',
          position: 1,
          backlogPosition: 1,
    offsetY: 0,
          prUrls: [],
          relatedItems: [],
          assignee: '',
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 3,
          number: 3,
          columnId: 2,
          title: 'C',
          description: '',
          position: 0,
          backlogPosition: 0,
    offsetY: 0,
          prUrls: [],
          relatedItems: [],
          assignee: '',
          createdAt: '',
          updatedAt: '',
        },
      ],
    };
  }

  it('reorders within a column via drop and persists', async () => {
    const reorderItems = vi.fn(() =>
      of({
        items: [
          { ...twoCardBoard().items[1], position: 0 },
          { ...twoCardBoard().items[0], position: 1 },
          twoCardBoard().items[2],
        ],
      }),
    );
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(twoCardBoard()),
            reorderItems,
            reorderColumns: vi.fn(),
            listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.onItemDrop(
      {
        previousContainer: { id: 'card-list-1' },
        container: { id: 'card-list-1' },
        previousIndex: 0,
        currentIndex: 1,
        item: { data: twoCardBoard().items[0] },
      } as never,
      1,
    );
    expect(reorderItems).toHaveBeenCalledWith([{ columnId: 1, itemIds: [2, 1] }]);
  });

  it('skips API for no-op drops and rolls back on failure', async () => {
    const err = Object.assign(new Error('conflict'), { status: 409 });
    const reorderItems = vi.fn(() => throwError(() => err));
    const initial = twoCardBoard();
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(initial),
            reorderItems,
            reorderColumns: vi.fn(),
            listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.onItemDrop(
      {
        previousContainer: { id: 'card-list-1' },
        container: { id: 'card-list-1' },
        previousIndex: 0,
        currentIndex: 0,
        item: { data: initial.items[0] },
      } as never,
      1,
    );
    expect(reorderItems).not.toHaveBeenCalled();

    f.componentInstance.onItemDrop(
      {
        previousContainer: { id: 'card-list-1' },
        container: { id: 'card-list-2' },
        previousIndex: 0,
        currentIndex: 0,
        item: { data: initial.items[0] },
      } as never,
      2,
    );
    expect(reorderItems).toHaveBeenCalled();
    expect(f.componentInstance.reorderConflict()).toBe(true);
    expect(f.componentInstance.data().items.map((c) => c.columnId)).toEqual(
      initial.items.map((c) => c.columnId),
    );
  });

  it('moves within a column with ArrowDown (focus is covered in board-card-reorder-state.spec.ts)', async () => {
    const reorderItems = vi.fn(() => of({ items: twoCardBoard().items }));
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(twoCardBoard()),
            reorderItems,
            reorderColumns: vi.fn(),
            listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.onItemKeydown(
      new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }),
      1,
      0,
    );
    expect(reorderItems).toHaveBeenCalledWith([{ columnId: 1, itemIds: [2, 1] }]);
  });

  it('drops into an empty column', async () => {
    const boardData: BoardData = {
      columns: makeColumns().slice(0, 2),
      items: [
        {
          id: 1,
          number: 1,
          columnId: 1,
          title: 'A',
          description: '',
          position: 0,
          backlogPosition: 0,
    offsetY: 0,
          prUrls: [],
          relatedItems: [],
          assignee: '',
          createdAt: '',
          updatedAt: '',
        },
      ],
    };
    const reorderItems = vi.fn(() =>
      of({ items: [{ ...boardData.items[0], columnId: 2, position: 0 }] }),
    );
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(boardData),
            reorderItems,
            reorderColumns: vi.fn(),
            listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.onItemDrop(
      {
        previousContainer: { id: 'card-list-1' },
        container: { id: 'card-list-2' },
        previousIndex: 0,
        currentIndex: 0,
        item: { data: boardData.items[0] },
      } as never,
      2,
    );
    expect(reorderItems).toHaveBeenCalledWith([
      { columnId: 1, itemIds: [] },
      { columnId: 2, itemIds: [1] },
    ]);
  });

  it('opens detail on a plain click', async () => {
    const navigate = vi.fn();
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(twoCardBoard()),
            reorderItems: vi.fn(),
            reorderColumns: vi.fn(),
            listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    const board = f.componentInstance;
    (board as unknown as { router: { navigate: typeof navigate } }).router = {
      navigate,
    } as never;
    board.onItemClick(new MouseEvent('click', { cancelable: true }), twoCardBoard().items[0]);
    expect(navigate).toHaveBeenCalledWith(['/items', 1]);
  });

  it('announces the new position so consecutive moves read differently', async () => {
    // The server answers with the order it was given, as the real API does.
    const reorderItems = vi.fn((columns: { columnId: number; itemIds: number[] }[]) => {
      const byId = new Map(twoCardBoard().items.map((c) => [c.id, c]));
      return of({
        items: columns.flatMap((col) =>
          col.itemIds.map((id, position) => ({
            ...byId.get(id)!,
            columnId: col.columnId,
            position,
            backlogPosition: position,
          })),
        ),
      });
    });
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(twoCardBoard()),
            reorderItems,
            reorderColumns: vi.fn(),
            listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    const board = f.componentInstance;
    const press = (key: string, index: number) =>
      board.onItemKeydown(new KeyboardEvent('keydown', { key, cancelable: true }), 1, index);
    press('ArrowDown', 0);
    const first = board.reorderAnnouncement();
    expect(first).toContain('2番目');
    press('ArrowUp', 1);
    const second = board.reorderAnnouncement();
    expect(second).toContain('1番目');
    expect(second).not.toBe(first);
  });

  it('announces the destination column and position after a cross-column drop', async () => {
    const boardData = twoCardBoard();
    const reorderItems = vi.fn(() =>
      of({
        items: boardData.items.map((c) => (c.id === 1 ? { ...c, columnId: 2, position: 0 } : c)),
      }),
    );
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(boardData),
            reorderItems,
            reorderColumns: vi.fn(),
            listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.onItemDrop(
      {
        previousContainer: { id: 'card-list-1' },
        container: { id: 'card-list-2' },
        previousIndex: 0,
        currentIndex: 0,
        item: { data: boardData.items[0] },
      } as never,
      2,
    );
    const name = boardData.columns.find((c) => c.id === 2)?.name;
    expect(f.componentInstance.reorderAnnouncement()).toBe(
      `${boardData.items[0].title}を${name}の1番目へ移動しました`,
    );
  });

  it('leaves modified and non-primary clicks to the browser', async () => {
    const navigate = vi.fn();
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(twoCardBoard()),
            reorderItems: vi.fn(),
            reorderColumns: vi.fn(),
            listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    const board = f.componentInstance;
    (board as unknown as { router: { navigate: typeof navigate } }).router = {
      navigate,
    } as never;
    const card = twoCardBoard().items[0];
    for (const init of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      const ev = new MouseEvent('click', { cancelable: true, ...init });
      board.onItemClick(ev, card);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(navigate).not.toHaveBeenCalled();

    const plain = new MouseEvent('click', { cancelable: true });
    board.onItemClick(plain, card);
    expect(plain.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith(['/items', 1]);
  });

  it('saves board scroll and returnTo before navigating to item', async () => {
    sessionStorage.clear();
    const navigate = vi.fn();
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(twoCardBoard()),
            reorderItems: vi.fn(),
            reorderColumns: vi.fn(),
            listCommandTemplates: () => of({ templates: [] }),
            listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    const board = f.componentInstance;
    (board as unknown as { router: { navigate: typeof navigate } }).router = {
      navigate,
    } as never;

    const page = pageScrollElement()!;
    const boardEl = f.nativeElement.querySelector('.board-scroll') as HTMLElement;
    page.scrollTop = 120;
    boardEl.scrollLeft = 40;

    const card = twoCardBoard().items[0];
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) {
      board.onItemClick(new MouseEvent('click', { cancelable: true, ...init }), card);
    }
    expect(readBoardScroll()).toBeNull();
    expect(readReturnTo()).toBeNull();

    board.onItemClick(new MouseEvent('click', { cancelable: true }), card);
    expect(readBoardScroll()).toEqual({ scrollY: 120, scrollLeft: 40 });
    expect(readReturnTo()).toBe('/');
    expect(navigate).toHaveBeenCalledWith(['/items', 1]);
  });

  it('restores board scroll once after render when saved', async () => {
    sessionStorage.clear();
    const page = pageScrollElement()!;
    page.scrollTop = 0;
    saveBoardScroll({ scrollY: 80, scrollLeft: 50 });
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(twoCardBoard()),
            reorderItems: vi.fn(),
            reorderColumns: vi.fn(),
            listCommandTemplates: () => of({ templates: [] }),
            listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    TestBed.inject(ApplicationRef).tick();
    f.detectChanges();
    await f.whenStable();

    expect(page.scrollTop).toBe(80);
    expect((f.nativeElement.querySelector('.board-scroll') as HTMLElement).scrollLeft).toBe(50);
    expect(readBoardScroll()).toBeNull();
  });

  it('does not re-restore board scroll after a second load', async () => {
    sessionStorage.clear();
    const page = pageScrollElement()!;
    page.scrollTop = 0;
    saveBoardScroll({ scrollY: 80, scrollLeft: 50 });
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(twoCardBoard()),
            reorderItems: vi.fn(),
            reorderColumns: vi.fn(),
            listCommandTemplates: () => of({ templates: [] }),
            listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    TestBed.inject(ApplicationRef).tick();
    f.detectChanges();
    await f.whenStable();

    const boardEl = f.nativeElement.querySelector('.board-scroll') as HTMLElement;
    expect(page.scrollTop).toBe(80);
    expect(boardEl.scrollLeft).toBe(50);

    // Prove once-only even if a scroll key is written again (e.g. failed clear).
    saveBoardScroll({ scrollY: 80, scrollLeft: 50 });
    page.scrollTop = 12;
    boardEl.scrollLeft = 3;
    f.componentInstance.load();
    f.detectChanges();
    await f.whenStable();
    TestBed.inject(ApplicationRef).tick();
    f.detectChanges();
    await f.whenStable();

    expect(page.scrollTop).toBe(12);
    expect(boardEl.scrollLeft).toBe(3);
  });

  it('skips board scroll restore when user scrolls before flush', async () => {
    sessionStorage.clear();
    const page = pageScrollElement()!;
    page.scrollTop = 0;
    saveBoardScroll({ scrollY: 80, scrollLeft: 50 });
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(twoCardBoard()),
            reorderItems: vi.fn(),
            reorderColumns: vi.fn(),
            listCommandTemplates: () => of({ templates: [] }),
            listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();

    const boardEl = f.nativeElement.querySelector('.board-scroll') as HTMLElement;
    page.scrollTop = 15;
    boardEl.scrollLeft = 8;
    TestBed.inject(ApplicationRef).tick();
    f.detectChanges();
    await f.whenStable();

    expect(page.scrollTop).toBe(15);
    expect(boardEl.scrollLeft).toBe(8);
    expect(readBoardScroll()).toBeNull();

    // Remount with cleared key must not reapply saved positions.
    f.destroy();
    const f2 = TestBed.createComponent(Board);
    f2.detectChanges();
    await f2.whenStable();
    TestBed.inject(ApplicationRef).tick();
    f2.detectChanges();
    await f2.whenStable();
    expect(page.scrollTop).toBe(15);
    expect((f2.nativeElement.querySelector('.board-scroll') as HTMLElement).scrollLeft).not.toBe(50);
  });

  it('does not apply stale board scroll restore after destroy', async () => {
    sessionStorage.clear();
    const page = pageScrollElement()!;
    page.scrollTop = 0;
    saveBoardScroll({ scrollY: 80, scrollLeft: 50 });
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(twoCardBoard()),
            reorderItems: vi.fn(),
            reorderColumns: vi.fn(),
            listCommandTemplates: () => of({ templates: [] }),
            listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    // Schedule restore without flushing afterNextRender, then destroy so generation advances.
    f.componentInstance.ngOnInit();
    f.destroy();
    TestBed.inject(ApplicationRef).tick();

    expect(page.scrollTop).not.toBe(80);
  });

  it('keeps browser and assistive shortcuts that use modifier keys', async () => {
    const reorderItems = vi.fn(() => of({ items: twoCardBoard().items }));
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(twoCardBoard()),
            reorderItems,
            reorderColumns: vi.fn(),
            listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    for (const init of [
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
    ]) {
      const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true, ...init });
      f.componentInstance.onItemKeydown(ev, 1, 0);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(reorderItems).not.toHaveBeenCalled();

    const plain = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
    f.componentInstance.onItemKeydown(plain, 1, 0);
    expect(plain.defaultPrevented).toBe(true);
    expect(reorderItems).toHaveBeenCalledTimes(1);
  });

  it('ignores keys other than the up and down arrows, and arrows that have nowhere to go', async () => {
    const reorderItems = vi.fn(() => of({ items: twoCardBoard().items }));
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(twoCardBoard()),
            reorderItems,
            reorderColumns: vi.fn(),
            listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    const press = (key: string, columnId: number, index: number) => {
      const ev = new KeyboardEvent('keydown', { key, cancelable: true });
      f.componentInstance.onItemKeydown(ev, columnId, index);
      return ev;
    };

    // Enter and Tab belong to the link and the browser; the others are not card moves either.
    for (const key of ['Enter', 'Tab', ' ', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape']) {
      for (const index of [0, 1]) {
        expect(press(key, 1, index).defaultPrevented, `${key} on card ${index}`).toBe(false);
      }
    }
    // The first card cannot go up and the last cannot go down: the key stays the browser's (page scroll).
    expect(press('ArrowUp', 1, 0).defaultPrevented).toBe(false);
    expect(press('ArrowDown', 1, 1).defaultPrevented).toBe(false);
    // A column of one card has no neighbours at all.
    expect(press('ArrowUp', 2, 0).defaultPrevented).toBe(false);
    expect(press('ArrowDown', 2, 0).defaultPrevented).toBe(false);
    expect(reorderItems).not.toHaveBeenCalled();

    // The same keys on a card that can move are taken and saved.
    expect(press('ArrowUp', 1, 1).defaultPrevented).toBe(true);
    expect(reorderItems).toHaveBeenCalledTimes(1);
  });

  it('describes card dragging differently while reordering is unavailable', async () => {
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(twoCardBoard()),
            reorderItems: () => new Subject(),
            reorderColumns: vi.fn(),
            listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    const help = () =>
      f.nativeElement.querySelector(
        '#' + f.nativeElement.querySelector('.card-drag-handle').getAttribute('aria-describedby'),
      )?.textContent as string;
    expect(help()).toContain('上下矢印');
    f.componentInstance.onItemKeydown(
      new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }),
      1,
      0,
    );
    f.detectChanges();
    expect(f.componentInstance.canReorderItems()).toBe(false);
    expect(help()).toContain('保存中');
  });
});

// Fixtures elsewhere give every card number === id, which cannot tell the two apart. Here they differ and
// even cross over: card 1 is ITEM-002, card 2 is ITEM-003 and card 3 is ITEM-001.
describe('Board card identity', () => {
  const crossed = (): BoardData => {
    const base = {
      description: '',
      backlogPosition: 0,
    offsetY: 0,
      prUrls: [] as string[],
      relatedItems: [],
      assignee: '',
      createdAt: '',
      updatedAt: '',
    };
    return {
      columns: makeColumns().slice(0, 2),
      items: [
        { ...base, id: 1, number: 2, columnId: 1, title: 'A', position: 0 },
        { ...base, id: 2, number: 3, columnId: 1, title: 'B', position: 1 },
        { ...base, id: 3, number: 1, columnId: 2, title: 'C', position: 0 },
      ],
    };
  };

  async function render(reorderItems: ReturnType<typeof vi.fn> = vi.fn()) {
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(crossed()),
            reorderItems,
            listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    const links = (): HTMLAnchorElement[] =>
      Array.from(f.nativeElement.querySelectorAll('.task-card-body'));
    const handles = (): HTMLButtonElement[] =>
      Array.from(f.nativeElement.querySelectorAll('.card-drag-handle'));
    return { f, links, handles };
  }

  it('opens the card by its public number when its link is clicked, and links to that number', async () => {
    const { f, links } = await render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    expect(links().map((a) => a.getAttribute('href'))).toEqual([
      '/items/2',
      '/items/3',
      '/items/1',
    ]);
    expect(links().map((a) => a.textContent)).toEqual([
      expect.stringContaining('ITEM-002'),
      expect.stringContaining('ITEM-003'),
      expect.stringContaining('ITEM-001'),
    ]);

    const [a, b, c] = links();
    for (const link of [a, b, c]) {
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      link.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    }
    expect(navigate.mock.calls.map(([commands]) => commands)).toEqual([
      ['/items', 2],
      ['/items', 3],
      ['/items', 1],
    ]);
    f.destroy();
  });

  it('puts focus back on the moved card by its row id, not by its public number', async () => {
    const answer = [
      { ...crossed().items[0], position: 1 },
      { ...crossed().items[1], position: 0 },
      crossed().items[2],
    ];
    const { f, handles } = await render(vi.fn(() => of({ items: answer })));

    // Item A (id 1, ITEM-002) moves down. Number 2 is card B's id, so a lookup by number lands on B.
    handles()[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    f.detectChanges();
    await f.whenStable();
    const active = document.activeElement as HTMLElement;
    expect(active.classList.contains('card-drag-handle')).toBe(true);
    expect(active.closest('[data-card-id]')?.getAttribute('data-card-id')).toBe('1');
    expect(active.getAttribute('aria-label')).toContain('ITEM-002');
    f.destroy();
  });
});

describe('Board live refresh', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('applies silent board poll without toggling loading', async () => {
    vi.useFakeTimers();
    const initial = sampleBoard([{ id: 1, name: 'Todo', position: 0 }]);
    const api = {
      board: vi.fn(() => of(initial)),
      listCommandTemplates: () => of({ templates: [] }),
      listItemCommandTemplatesByNumber: () => of({ templates: [] }),
      listFilter: () => of({ query: '', statusIds: [] }),
      putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
    };
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [provideRouter([]), { provide: Api, useValue: api }],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    expect(f.componentInstance.loading()).toBe(false);
    expect(f.componentInstance.data().items).toHaveLength(1);

    const polled = normalizeBoardData({
      columns: initial.columns,
      items: [
        ...initial.items,
        {
          id: 99,
          number: 99,
          columnId: 1,
          title: 'From poll',
          description: '',
          position: 1,
          backlogPosition: 1,
    offsetY: 0,
          prUrls: [],
          relatedItems: [],
          assignee: '',
          createdAt: '',
          updatedAt: '',
        },
      ],
    });
    api.board.mockReturnValue(of(polled));
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.componentInstance.loading()).toBe(false);
    expect(f.componentInstance.error()).toBe('');
    expect(f.componentInstance.data().items.map((c) => c.number)).toContain(99);
    f.destroy();
  });

  it('does not apply poll while reordering', async () => {
    vi.useFakeTimers();
    const initial = sampleBoard([{ id: 1, name: 'Todo', position: 0 }]);
    const api = {
      board: vi.fn(() => of(initial)),
      listCommandTemplates: () => of({ templates: [] }),
      listItemCommandTemplatesByNumber: () => of({ templates: [] }),
      listFilter: () => of({ query: '', statusIds: [] }),
      putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
    };
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [provideRouter([]), { provide: Api, useValue: api }],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    f.componentInstance.reordering.set(true);
    const before = f.componentInstance.data().items.length;
    api.board.mockReturnValue(of({ ...initial, items: [] }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.componentInstance.data().items).toHaveLength(before);
    f.destroy();
  });

  it('clears a prior load error when a poll applies', async () => {
    vi.useFakeTimers();
    const initial = sampleBoard([{ id: 1, name: 'Todo', position: 0 }]);
    let boardImpl: () => Observable<BoardData> = () =>
      throwError(() => ({ status: 500, error: { message: '失敗' } }));
    const board = vi.fn(() => boardImpl());
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        { provide: Api, useValue: { board, listCommandTemplates: () => of({ templates: [] }), listItemCommandTemplatesByNumber: () => of({ templates: [] }),
 listFilter: () => of({ query: '', statusIds: [] }),
 putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        } },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    expect(f.componentInstance.error()).toContain('失敗');
    boardImpl = () => of(initial);
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.componentInstance.error()).toBe('');
    expect(f.componentInstance.data().items).toHaveLength(1);
    f.destroy();
  });

  it('does not apply poll while dragging a column', async () => {
    vi.useFakeTimers();
    const initial = sampleBoard([{ id: 1, name: 'Todo', position: 0 }]);
    const api = {
      board: vi.fn(() => of(initial)),
      listCommandTemplates: () => of({ templates: [] }),
      listItemCommandTemplatesByNumber: () => of({ templates: [] }),
      listFilter: () => of({ query: '', statusIds: [] }),
      putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
    };
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [provideRouter([]), { provide: Api, useValue: api }],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    f.componentInstance.draggingColumnId.set(1);
    const before = f.componentInstance.data().items.length;
    api.board.mockReturnValue(of(normalizeBoardData({ ...initial, items: [] })));
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.componentInstance.data().items).toHaveLength(before);
    f.destroy();
  });

  it('does not apply an in-flight poll after reordering starts', async () => {
    vi.useFakeTimers();
    const initial = sampleBoard([{ id: 1, name: 'Todo', position: 0 }]);
    const slow = new Subject<ReturnType<typeof sampleBoard>>();
    const api = {
      board: vi.fn(() => of(initial)),
      listCommandTemplates: () => of({ templates: [] }),
      listItemCommandTemplatesByNumber: () => of({ templates: [] }),
      listFilter: () => of({ query: '', statusIds: [] }),
      putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
    };
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [provideRouter([]), { provide: Api, useValue: api }],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    api.board.mockReturnValue(slow.asObservable());
    await vi.advanceTimersByTimeAsync(5000);
    f.componentInstance.reordering.set(true);
    const before = f.componentInstance.data().items.length;
    slow.next(normalizeBoardData({ ...initial, items: [] }));
    slow.complete();
    expect(f.componentInstance.data().items).toHaveLength(before);
    f.destroy();
  });
});

describe('Board add dialog accidental close', () => {
  afterEach(() => TestBed.resetTestingModule());

  function stubDialog() {
    const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
      showModal?: () => void;
      close?: () => void;
    };
    const origShowModal = proto.showModal;
    const origClose = proto.close;
    proto.showModal = function () {
      this.open = true;
    };
    proto.close = function () {
      this.open = false;
    };
    return () => {
      proto.showModal = origShowModal;
      proto.close = origClose;
    };
  }

  async function mountBoard() {
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () =>
              of({
                columns: [
                  { id: 1, name: 'Todo', position: 0 },
                  { id: 2, name: 'Doing', position: 1 },
                ],
                items: [],
              }),
            listCommandTemplates: () => of({ templates: [] }),
            listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    return f;
  }

  it('keeps the card add dialog open on backdrop click, omits cancel, and closes via ×', async () => {
    const restore = stubDialog();
    try {
      const f = await mountBoard();
      f.componentInstance.openItem(1);
      f.detectChanges();
      expect(f.componentInstance.modal()).toBe('item');
      f.componentInstance.itemForm.setValue({ title: '下書き', description: '残る' });
      const dialog = f.nativeElement.querySelector('dialog.modal-backdrop') as HTMLElement;
      expect(dialog).not.toBeNull();
      dialog.click();
      f.detectChanges();
      expect(f.componentInstance.modal()).toBe('item');
      expect(f.componentInstance.itemForm.getRawValue()).toEqual({
        title: '下書き',
        description: '残る',
      });
      const cancel = Array.from(dialog.querySelectorAll('button')).find((b) =>
        (b.textContent ?? '').includes('キャンセル'),
      );
      expect(cancel).toBeUndefined();
      dialog.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }));
      f.detectChanges();
      expect(f.componentInstance.modal()).toBeNull();
      f.componentInstance.openItem(1);
      f.detectChanges();
      (f.nativeElement.querySelector('button[aria-label="閉じる"]') as HTMLButtonElement).click();
      f.detectChanges();
      expect(f.componentInstance.modal()).toBeNull();
    } finally {
      restore();
    }
  });

  it('keeps the column add dialog open on backdrop click and omits cancel', async () => {
    const restore = stubDialog();
    try {
      const f = await mountBoard();
      f.componentInstance.openColumn();
      f.detectChanges();
      expect(f.componentInstance.modal()).toBe('column');
      const dialog = f.nativeElement.querySelector('dialog.modal-backdrop') as HTMLElement;
      dialog.click();
      f.detectChanges();
      expect(f.componentInstance.modal()).toBe('column');
      const cancel = Array.from(dialog.querySelectorAll('button')).find((b) =>
        (b.textContent ?? '').includes('キャンセル'),
      );
      expect(cancel).toBeUndefined();
      f.componentInstance.close();
      f.detectChanges();
      f.destroy();
    } finally {
      restore();
    }
  });
});

describe('Board list filter', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('hides non-matching cards and clear restores them; DnD stays available when inactive', async () => {
    const cols: Column[] = [
      { id: 1, name: 'Todo', position: 0 },
      { id: 2, name: 'Doing', position: 1 },
    ];
    const boardData: BoardData = {
      columns: cols,
      settings: { cardLayout: 'pack' },
      items: [
        {
          id: 1,
          number: 1,
          columnId: 1,
          title: 'Alpha',
          description: 'one',
          position: 0,
          backlogPosition: 0,
          offsetY: 0,
          prUrls: [],
          relatedItems: [],
          assignee: '',
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 2,
          number: 2,
          columnId: 1,
          title: 'Beta',
          description: 'two',
          position: 1,
          backlogPosition: 1,
          offsetY: 0,
          prUrls: [],
          relatedItems: [],
          assignee: '',
          createdAt: '',
          updatedAt: '',
        },
      ],
    };
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(boardData),
            listCommandTemplates: () => of({ templates: [] }),
            listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.querySelector('.list-filter')).not.toBeNull();
    expect(f.componentInstance.filteredItemCount()).toBe(2);
    expect(f.componentInstance.canReorderItems()).toBe(true);
    f.componentInstance.listFilter.setQuery('alpha');
    f.detectChanges();
    expect(f.componentInstance.filteredItemCount()).toBe(1);
    expect(f.nativeElement.textContent).toContain('Alpha');
    expect(f.nativeElement.textContent).not.toContain('Beta');
    expect(f.componentInstance.canReorderItems()).toBe(false);
    f.componentInstance.listFilter.clear();
    f.detectChanges();
    expect(f.componentInstance.filteredItemCount()).toBe(2);
    expect(f.componentInstance.canReorderItems()).toBe(true);

    f.componentInstance.listFilter.toggleStatus(2);
    f.detectChanges();
    expect(f.componentInstance.filteredItemCount()).toBe(0);
    f.componentInstance.listFilter.clear();
    f.componentInstance.listFilter.setQuery('Beta');
    f.componentInstance.listFilter.toggleStatus(1);
    f.detectChanges();
    expect(f.componentInstance.filteredItemCount()).toBe(1);
    expect(f.nativeElement.textContent).toContain('Beta');
    expect(f.componentInstance.canReorderItems()).toBe(false);
  });
});
