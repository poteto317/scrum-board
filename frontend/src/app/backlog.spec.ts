import { ApplicationRef } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { AiChatContext } from './ai-chat-context';
import { Api } from './api';
import { Backlog } from './backlog';
import {
  readBacklogScroll,
  readReturnTo,
  saveBacklogScroll,
} from './list-scroll-session';
import { BoardMeta, Item, Column } from './models';
import type { ConditionalGetResult } from './conditional-get';
import { TODO_COLUMN_MISSING } from './todo-column';
import {
  COMMAND_ITEM_MENU_EMPTY,
  COPY_COMMAND_FAILURE,
  COPY_COMMAND_SUCCESS,
  resolveCommand,
} from './command-template';
import { COPY_LINK_SUCCESS } from './copy-link-feedback';
import { itemDetailUrl } from './item-link';
import { ProjectSession } from './project-session';

function makeCards(): Item[] {
  return [
    {
      id: 1,
      projectId: 1,
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
      closeReason: '',
      solution: '',
      favorite: false,
      dueAt: null,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 2,
      projectId: 1,
      number: 2,
      columnId: 2,
      title: 'B',
      description: '',
      position: 1,
      backlogPosition: 1,
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
    },
    {
      id: 3,
      projectId: 1,
      number: 3,
      columnId: 3,
      title: 'C',
      description: '',
      position: 2,
      backlogPosition: 2,
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
    },
    {
      id: 9,
      projectId: 1,
      number: 9,
      columnId: 1,
      title: 'D',
      description: '',
      position: 3,
      backlogPosition: 3,
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
    },
  ];
}

function makeColumns(): Column[] {
  return [
    { id: 1, name: 'Todo', position: 0 },
    { id: 2, name: 'Doing', position: 1 },
    { id: 3, name: 'Done', position: 2 },
  ];
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
      setDragImage?: ReturnType<typeof vi.fn>;
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
      setDragImage: vi.fn(),
    },
  });
  target.dispatchEvent(ev);
  return ev;
}

function mockRowRects(root: HTMLElement, bounds: { top: number; height: number }[]) {
  const rows = root.querySelectorAll('.backlog-row') as NodeListOf<HTMLElement>;
  rows.forEach((el, i) => {
    const b = bounds[i] ?? { top: 0, height: 60 };
    el.getBoundingClientRect = () =>
      ({
        top: b.top,
        bottom: b.top + b.height,
        height: b.height,
        left: 0,
        right: 800,
        width: 800,
        x: 0,
        y: b.top,
        toJSON() {
          return {};
        },
      }) as DOMRect;
  });
}

describe('Backlog reordering', () => {
  it('renders the project switcher inside the page topbar', async () => {
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog: () => of({ items: makeCards() }),
            board: () => of({ columns: makeColumns(), items: makeCards(), settings: { cardLayout: 'pack' } }),
            reorderBacklog: () => of({ items: makeCards() }),
            listCommandTemplates: () => of({ templates: [] }),
            listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
          },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    const topbar = f.nativeElement.querySelector('.page-topbar') as HTMLElement;
    expect(topbar).toBeTruthy();
    expect(topbar.children.length).toBe(2);
    expect(topbar.children[1]?.tagName).toBe('APP-PROJECT-SWITCHER');
  });

  it('does not show comment UI on backlog rows', async () => {
    const cards = makeCards();
    const columns = makeColumns();
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog: () => of({ items: cards }),
            board: () => of({ columns, items: cards, settings: { cardLayout: 'pack' } }),
            reorderBacklog: () => of({ items: cards }),
            listCommandTemplates: () => of({ templates: [] }),
            listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
          },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    expect(f.nativeElement.querySelector('app-item-comments')).toBeNull();
    expect(f.nativeElement.textContent).not.toMatch(/コメント/);
  });

  it('shows status names for all columns including Done', async () => {
    const cards = makeCards();
    const columns = makeColumns();
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog: () => of({ items: cards }),
            board: () => of({ columns, items: cards , settings: { cardLayout: 'pack', activeProjectId: 1 } }),
            listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    const statuses = Array.from(
      f.nativeElement.querySelectorAll('.backlog-status') as NodeListOf<HTMLElement>,
    ).map((el) => el.textContent?.trim());
    expect(statuses).toEqual(['Todo', 'Doing', 'Done', 'Todo']);
  });

  it('reorders cards via drag-and-drop and persists via API', async () => {
    const cards = makeCards();
    const columns = makeColumns();
    const reorderBacklog = vi.fn((ids: number[]) =>
      of({
        items: ids.map((id, backlogPosition) => ({
          ...cards.find((c) => c.id === id)!,
          backlogPosition,
        })),
      }),
    );
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog: () => of({ items: cards }),
            board: () => of({ columns, items: cards , settings: { cardLayout: 'pack', activeProjectId: 1 } }),
            reorderBacklog,
            listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    mockRowRects(f.nativeElement, [
      { top: 0, height: 60 },
      { top: 70, height: 60 },
      { top: 140, height: 60 },
      { top: 210, height: 60 },
    ]);
    const scrollRegion = f.nativeElement.querySelector('.backlog-scroll') as HTMLElement;
    const zones = f.nativeElement.querySelectorAll('.backlog-drag-zone') as NodeListOf<HTMLElement>;
    dispatchDragEvent(zones[3], 'dragstart', { clientY: 230 });
    f.detectChanges();
    expect(f.componentInstance.draggingItemId()).toBe(9);
    // row1 midpoint is 100; below midpoint keeps insertion slot 1
    dispatchDragEvent(scrollRegion, 'dragover', { clientY: 99 });
    f.detectChanges();
    expect(f.componentInstance.dropSlot()).toBe(1);
    dispatchDragEvent(scrollRegion, 'drop', { clientY: 99 });
    dispatchDragEvent(zones[3], 'dragend');
    f.detectChanges();
    expect(reorderBacklog).toHaveBeenCalledWith([1, 9, 2, 3]);
  });

  it('moves cards with ArrowUp/ArrowDown and disables reorder when only one card', async () => {
    const cards = makeCards();
    const columns = makeColumns();
    const reorderBacklog = vi.fn((ids: number[]) =>
      of({
        items: ids.map((id, backlogPosition) => ({
          ...cards.find((c) => c.id === id)!,
          backlogPosition,
        })),
      }),
    );
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog: () => of({ items: cards }),
            board: () => of({ columns, items: cards , settings: { cardLayout: 'pack', activeProjectId: 1 } }),
            reorderBacklog,
            listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    expect(f.nativeElement.textContent).not.toContain('⋮⋮');
    expect(f.nativeElement.querySelector('.backlog-drag-handle')).toBeNull();
    const getRanks = () =>
      Array.from(
        f.nativeElement.querySelectorAll('.backlog-rank') as NodeListOf<HTMLButtonElement>,
      );
    expect(getRanks()[2].tagName).toBe('BUTTON');
    getRanks()[2].focus();
    getRanks()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }));
    f.detectChanges();
    await f.whenStable();
    expect(reorderBacklog).toHaveBeenCalledWith([1, 3, 2, 9]);
    expect(document.activeElement).toBe(getRanks()[1]);
    const footerText = f.nativeElement.querySelector('.backlog-footer')?.textContent ?? '';
    expect(footerText).toContain('行をドラッグ');
    expect(footerText).not.toContain('ハンドル');

    f.componentInstance.items.set([cards[0]]);
    f.detectChanges();
    expect(f.componentInstance.canReorder()).toBe(false);
    const singleZone = f.nativeElement.querySelector('.backlog-drag-zone') as HTMLElement;
    const singleRank = f.nativeElement.querySelector('.backlog-rank') as HTMLButtonElement;
    expect(singleZone.getAttribute('draggable')).toBeNull();
    expect(singleRank.getAttribute('aria-disabled')).toBe('true');
  });

  it('rolls back optimistic order on save failure and shows reload on conflict', async () => {
    const cards = makeCards();
    const columns = makeColumns();
    const fail = new Subject<{ items: Item[] }>();
    const reorderBacklog = vi.fn(() => fail);
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog: () => of({ items: cards }),
            board: () => of({ columns, items: cards , settings: { cardLayout: 'pack', activeProjectId: 1 } }),
            reorderBacklog,
            listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    const getRanks = () =>
      Array.from(
        f.nativeElement.querySelectorAll('.backlog-rank') as NodeListOf<HTMLButtonElement>,
      );
    getRanks()[0].focus();
    getRanks()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    f.detectChanges();
    await f.whenStable();
    expect(f.componentInstance.items().map((c) => c.id)).toEqual([2, 1, 3, 9]);
    expect(document.activeElement).toBe(getRanks()[1]);
    fail.error({ status: 409, error: { message: '構成が変更されています' } });
    f.detectChanges();
    await f.whenStable();
    expect(f.componentInstance.items().map((c) => c.id)).toEqual([1, 2, 3, 9]);
    expect(f.componentInstance.reorderConflict()).toBe(true);
    expect(f.nativeElement.querySelector('.reorder-reload')).not.toBeNull();
    expect(f.nativeElement.querySelector('.reorder-dismiss')).toBeNull();
    expect(document.activeElement).toBe(getRanks()[0]);
  });

  it('creates a card from the backlog modal always in Todo without a status select', async () => {
    const cards = makeCards().slice(0, 1);
    const columns = makeColumns();
    const created: Item = {
      id: 10,
      projectId: 1,
      number: 10,
      columnId: 1,
      title: 'New',
      description: 'd',
      position: 1,
      backlogPosition: 1,
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
    const createItem = vi.fn(() => of(created));
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog: () => of({ items: cards }),
            board: () => of({ columns, items: cards , settings: { cardLayout: 'pack', activeProjectId: 1 } }),
            createItem,
            listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
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
      f.componentInstance.openItem();
      f.detectChanges();
      expect(f.nativeElement.querySelector('#backlog-card-status')).toBeNull();
      f.componentInstance.itemForm.setValue({
        title: 'New',
        description: 'd',
      });
      f.componentInstance.addItem();
      f.detectChanges();
      expect(createItem).toHaveBeenCalledWith({ title: 'New', description: 'd', columnId: 1 });
      expect(f.componentInstance.items().at(-1)?.id).toBe(10);
      expect(f.componentInstance.modal()).toBeNull();
    } finally {
      proto.showModal = origShowModal;
      proto.close = origClose;
    }
  });

  it('does not create from the backlog when Todo column is missing', async () => {
    const createItem = vi.fn();
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog: () => of({ items: [] }),
            board: () => of({ columns: [{ id: 2, name: 'Doing', position: 0 }], items: [] }),
            createItem,
            listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.openItem();
    f.componentInstance.itemForm.setValue({ title: 'x', description: '' });
    f.componentInstance.addItem();
    expect(createItem).not.toHaveBeenCalled();
    expect(f.componentInstance.formError()).toBe(TODO_COLUMN_MISSING);
  });

  it('disables the add-card button and blocks openItem when initial load fails or columns are empty', async () => {
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog: () => throwError(() => ({ status: 500, error: { message: '失敗' } })),
            board: () => throwError(() => ({ status: 500, error: { message: '失敗' } })),
            listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    const addButton = f.nativeElement.querySelector(
      '.page-heading button.primary',
    ) as HTMLButtonElement;
    expect(addButton.disabled).toBe(true);
    f.componentInstance.openItem();
    expect(f.componentInstance.modal()).toBeNull();

    f.componentInstance.error.set('');
    f.detectChanges();
    expect(addButton.disabled).toBe(true);
    f.componentInstance.openItem();
    expect(f.componentInstance.modal()).toBeNull();
  });
});

describe('Backlog live refresh', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('applies silent backlog poll without setting loading', async () => {
    vi.useFakeTimers();
    const cards = makeCards();
    const columns = makeColumns();
    const api = {
      backlog: vi.fn(() => of({ items: cards })),
      board: vi.fn(() => of({ columns, items: [] })),
      createItem: vi.fn(),
      reorderBacklog: vi.fn(),
      listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
      putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
    };
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [provideRouter([]), { provide: Api, useValue: api }],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    expect(f.componentInstance.loading()).toBe(false);

    const next = [...cards, { ...cards[0], id: 50, number: 50, title: 'Polled' }];
    api.backlog.mockReturnValue(of({ items: next }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.componentInstance.loading()).toBe(false);
    expect(f.componentInstance.error()).toBe('');
    expect(f.componentInstance.items().some((c) => c.number === 50)).toBe(true);
    f.destroy();
  });

  it('does not apply while reordering', async () => {
    vi.useFakeTimers();
    const cards = makeCards();
    const columns = makeColumns();
    const api = {
      backlog: vi.fn(() => of({ items: cards })),
      board: vi.fn(() => of({ columns, items: [] })),
      createItem: vi.fn(),
      reorderBacklog: vi.fn(),
      listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
      putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
    };
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [provideRouter([]), { provide: Api, useValue: api }],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    f.componentInstance.reordering.set(true);
    const before = f.componentInstance.items().length;
    api.backlog.mockReturnValue(of({ items: [] }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.componentInstance.items()).toHaveLength(before);
    f.destroy();
  });
});

describe('Backlog board meta wiring (#118)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function setup() {
    const cards = makeCards();
    const columns = makeColumns();
    const api = {
      backlog: vi.fn(() => of({ items: cards })),
      // The full board must never be requested: backlog needs columns and settings only (L-060).
      board: vi.fn(() => {
        throw new Error('GET /api/board must not be used by backlog');
      }),
      boardConditional: vi.fn(() => {
        throw new Error('GET /api/board must not be used by backlog');
      }),
      boardMetaConditional: vi.fn(
        (_etag?: string | null): Observable<ConditionalGetResult<BoardMeta>> =>
          of({
            status: 'ok' as const,
            etag: '"m1"',
            body: { columns, settings: { cardLayout: 'pack' as const, activeProjectId: 1 } },
          }),
      ),
      patchBoardSettings: vi.fn(() =>
        of({ settings: { cardLayout: 'pack' as const, activeProjectId: 2 } }),
      ),
      createItem: vi.fn(),
      reorderBacklog: vi.fn(),
      listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
      putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
    };
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [provideRouter([]), { provide: Api, useValue: api }],
    });
    return { api, columns };
  }

  it('load() reads columns and settings from boardMetaConditional, not board', () => {
    vi.useFakeTimers();
    const { api, columns } = setup();
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    expect(api.boardMetaConditional).toHaveBeenCalledTimes(1);
    expect(api.boardMetaConditional.mock.calls[0][0]).toBeUndefined();
    expect(api.board).not.toHaveBeenCalled();
    expect(api.boardConditional).not.toHaveBeenCalled();
    expect(f.componentInstance.columns()).toEqual(columns);
    f.destroy();
  });

  it('polling sends the remembered meta ETag and never requests the full board', async () => {
    vi.useFakeTimers();
    const { api } = setup();
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.boardMetaConditional.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(api.boardMetaConditional.mock.calls[1][0]).toBe('"m1"');
    expect(api.board).not.toHaveBeenCalled();
    expect(api.boardConditional).not.toHaveBeenCalled();
    f.destroy();
  });

  it('keeps the previous columns when only the meta poll is 304 and the backlog changed', async () => {
    vi.useFakeTimers();
    const { api, columns } = setup();
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    expect(f.componentInstance.columns()).toEqual(columns);
    api.boardMetaConditional.mockReturnValue(of({ status: 'notModified' as const, etag: '"m1"' }));
    const next = [...makeCards(), { ...makeCards()[0], id: 70, number: 70, title: 'Polled while 304' }];
    api.backlog.mockReturnValue(of({ items: next }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.componentInstance.items().some((c) => c.number === 70)).toBe(true);
    expect(f.componentInstance.columns()).toEqual(columns);
    f.destroy();
  });

  it('survives a meta response without columns (normalized to an empty list)', () => {
    vi.useFakeTimers();
    const { api } = setup();
    api.boardMetaConditional.mockReturnValue(
      of({
        status: 'ok' as const,
        etag: '"m2"',
        body: { settings: { cardLayout: 'pack' as const } } as unknown as BoardMeta,
      }),
    );
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    expect(f.componentInstance.columns()).toEqual([]);
    expect(f.componentInstance.error()).toBe('');
    f.destroy();
  });

  it('reload after a project switch reads boardMetaConditional without an ETag', async () => {
    vi.useFakeTimers();
    const { api } = setup();
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    const session = TestBed.inject(ProjectSession);
    session.activeId.set(1);
    const before = api.boardMetaConditional.mock.calls.length;
    session.switchTo(2).subscribe({ error: () => undefined });
    await vi.advanceTimersByTimeAsync(0);
    expect(api.boardMetaConditional.mock.calls.length).toBe(before + 1);
    expect(api.boardMetaConditional.mock.calls[before][0]).toBeUndefined();
    expect(api.board).not.toHaveBeenCalled();
    expect(api.boardConditional).not.toHaveBeenCalled();
    f.destroy();
  });
});

describe('Backlog scroll save and restore', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    sessionStorage.clear();
  });

  it('saves backlog scroll and returnTo on detail click', async () => {
    sessionStorage.clear();
    const cards = makeCards();
    const columns = makeColumns();
    const navigate = vi.fn();
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog: () => of({ items: cards }),
            board: () => of({ columns, items: cards , settings: { cardLayout: 'pack', activeProjectId: 1 } }),
            listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    const backlog = f.componentInstance;
    (backlog as unknown as { router: { navigate: typeof navigate } }).router = {
      navigate,
    } as never;

    const scrollEl = f.nativeElement.querySelector('.backlog-scroll') as HTMLElement;
    scrollEl.scrollTop = 90;
    scrollEl.scrollLeft = 12;

    const card = cards[0];
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) {
      backlog.onDetailClick(new MouseEvent('click', { cancelable: true, ...init }), card);
    }
    expect(readBacklogScroll()).toBeNull();
    expect(readReturnTo()).toBeNull();

    backlog.onDetailClick(new MouseEvent('click', { cancelable: true }), card);
    expect(readBacklogScroll()).toEqual({ scrollTop: 90, scrollLeft: 12 });
    expect(readReturnTo()).toBe('/backlog');
    expect(navigate).toHaveBeenCalledWith(['/items', 1], { queryParams: { project: 1 } });
  });

  it('restores backlog scroll once after render when saved', async () => {
    sessionStorage.clear();
    saveBacklogScroll({ scrollTop: 70, scrollLeft: 25 });
    const cards = makeCards();
    const columns = makeColumns();
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog: () => of({ items: cards }),
            board: () => of({ columns, items: cards , settings: { cardLayout: 'pack', activeProjectId: 1 } }),
            listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    TestBed.inject(ApplicationRef).tick();
    f.detectChanges();
    await f.whenStable();

    const scrollEl = f.nativeElement.querySelector('.backlog-scroll') as HTMLElement;
    expect(scrollEl.scrollTop).toBe(70);
    expect(scrollEl.scrollLeft).toBe(25);
    expect(readBacklogScroll()).toBeNull();
  });

  it('does not re-restore backlog scroll after a second load', async () => {
    sessionStorage.clear();
    saveBacklogScroll({ scrollTop: 70, scrollLeft: 25 });
    const cards = makeCards();
    const columns = makeColumns();
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog: () => of({ items: cards }),
            board: () => of({ columns, items: cards , settings: { cardLayout: 'pack', activeProjectId: 1 } }),
            listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    TestBed.inject(ApplicationRef).tick();
    f.detectChanges();
    await f.whenStable();

    const scrollEl = f.nativeElement.querySelector('.backlog-scroll') as HTMLElement;
    expect(scrollEl.scrollTop).toBe(70);

    saveBacklogScroll({ scrollTop: 70, scrollLeft: 25 });
    scrollEl.scrollTop = 18;
    scrollEl.scrollLeft = 4;
    f.componentInstance.load();
    f.detectChanges();
    await f.whenStable();
    TestBed.inject(ApplicationRef).tick();
    f.detectChanges();
    await f.whenStable();

    expect(scrollEl.scrollTop).toBe(18);
    expect(scrollEl.scrollLeft).toBe(4);
  });

  it('skips backlog scroll restore when user scrolls before flush', async () => {
    sessionStorage.clear();
    saveBacklogScroll({ scrollTop: 70, scrollLeft: 25 });
    const cards = makeCards();
    const columns = makeColumns();
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog: () => of({ items: cards }),
            board: () => of({ columns, items: cards , settings: { cardLayout: 'pack', activeProjectId: 1 } }),
            listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();

    const scrollEl = f.nativeElement.querySelector('.backlog-scroll') as HTMLElement;
    scrollEl.scrollTop = 22;
    scrollEl.scrollLeft = 6;
    TestBed.inject(ApplicationRef).tick();
    f.detectChanges();
    await f.whenStable();

    expect(scrollEl.scrollTop).toBe(22);
    expect(scrollEl.scrollLeft).toBe(6);
    expect(readBacklogScroll()).toBeNull();

    // Remount with cleared key must not reapply saved positions.
    f.destroy();
    const f2 = TestBed.createComponent(Backlog);
    f2.detectChanges();
    await f2.whenStable();
    TestBed.inject(ApplicationRef).tick();
    f2.detectChanges();
    await f2.whenStable();
    const scrollEl2 = f2.nativeElement.querySelector('.backlog-scroll') as HTMLElement;
    expect(scrollEl2.scrollTop).toBe(0);
    expect(scrollEl2.scrollLeft).toBe(0);
  });

  it('does not apply stale backlog scroll restore after destroy', async () => {
    sessionStorage.clear();
    saveBacklogScroll({ scrollTop: 70, scrollLeft: 25 });
    const cards = makeCards();
    const columns = makeColumns();
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog: () => of({ items: cards }),
            board: () => of({ columns, items: cards , settings: { cardLayout: 'pack', activeProjectId: 1 } }),
            listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
    // Schedule restore without flushing afterNextRender, then destroy so generation advances.
    f.componentInstance.ngOnInit();
    f.destroy();
    TestBed.inject(ApplicationRef).tick();

    // Host never painted .backlog-scroll; restore must no-op (not throw).
    expect(f.nativeElement.querySelector('.backlog-scroll')).toBeNull();
  });
});

describe('Backlog add dialog accidental close', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('keeps the add dialog open on backdrop click, omits cancel, and closes via ×', async () => {
    const cards = makeCards();
    const columns = makeColumns();
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog: () => of({ items: cards }),
            board: () => of({ columns, items: cards , settings: { cardLayout: 'pack', activeProjectId: 1 } }),
            createItem: vi.fn(),
            listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
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
      f.componentInstance.openItem();
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
      f.componentInstance.openItem();
      f.detectChanges();
      (f.nativeElement.querySelector('button[aria-label="閉じる"]') as HTMLButtonElement).click();
      f.detectChanges();
      expect(f.componentInstance.modal()).toBeNull();
    } finally {
      proto.showModal = origShowModal;
      proto.close = origClose;
    }
  });
});

describe('Backlog copy card link', () => {
  const originalClipboard = navigator.clipboard;

  function apiMocks(cards = makeCards(), columns = makeColumns()) {
    return {
      backlog: () => of({ items: cards }),
      board: () => of({ columns, items: cards, settings: { cardLayout: 'pack', activeProjectId: 1 } }),
      listItemCommandTemplatesByNumber: () => of({ templates: [] }),
      listFilter: () =>
        of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
      putListFilter: (f: {
        board: { query: string; statusIds: number[] };
        backlog: { query: string; statusIds: number[] };
      }) => of(f),
    };
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [provideRouter([]), { provide: Api, useValue: apiMocks() }],
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
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return f;
  };

  it('renders copy buttons outside the drag zone with expected a11y', async () => {
    const f = await create();
    const zone = f.nativeElement.querySelector('.backlog-drag-zone') as HTMLElement;
    const copyBtn = f.nativeElement.querySelector('.copy-card-link') as HTMLButtonElement;
    const cmdBtn = f.nativeElement.querySelector('.copy-command-button') as HTMLButtonElement;
    expect(copyBtn).not.toBeNull();
    expect(cmdBtn).not.toBeNull();
    expect(zone.contains(copyBtn)).toBe(false);
    expect(zone.contains(cmdBtn)).toBe(false);
    expect(copyBtn.getAttribute('draggable')).toBe('false');
    expect(cmdBtn.getAttribute('draggable')).toBe('false');
    expect(copyBtn.getAttribute('aria-label')).toBe('ITEM-001 のリンクをコピー');
    expect(cmdBtn.getAttribute('aria-haspopup')).toBe('menu');
    expect(cmdBtn.getAttribute('aria-expanded')).toBe('false');
  });

  it('copies the public item detail URL on success without navigating', async () => {
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
    expect(writeText).toHaveBeenCalledWith(itemDetailUrl(window.location.origin, 1, 1));
    expect(navigateSpy).not.toHaveBeenCalled();
    const live = f.nativeElement.querySelector('.copy-feedback-banner') as HTMLElement;
    expect(live).not.toBeNull();
    expect(live.classList.contains('copy-feedback-banner--ok')).toBe(true);
    expect(live.textContent).toContain('リンクをコピーしました');
  });
});

describe('Backlog copy command menu', () => {
  const originalClipboard = navigator.clipboard;
  const template = {
    id: 4,
    name: 'gh pr',
    template: 'gh pr view {{url}} extra',
    position: 0,
  };

  function apiMocks(
    cards = makeCards(),
    columns = makeColumns(),
    listItemCommandTemplatesByNumber = vi.fn(() => of({ templates: [] as typeof template[] })),
  ) {
    return {
      backlog: () => of({ items: cards }),
      board: () => of({ columns, items: cards, settings: { cardLayout: 'pack', activeProjectId: 1 } }),
      listItemCommandTemplatesByNumber,
      listFilter: () =>
        of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
      putListFilter: (f: {
        board: { query: string; statusIds: number[] };
        backlog: { query: string; statusIds: number[] };
      }) => of(f),
    };
  }

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  const create = async (
    templates: typeof template[] = [],
    listItemCommandTemplatesByNumber = vi.fn(() => of({ templates })),
  ) => {
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        { provide: Api, useValue: apiMocks(makeCards(), makeColumns(), listItemCommandTemplatesByNumber) },
      ],
    });
    const f = TestBed.createComponent(Backlog);
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
    const button = f.nativeElement.querySelector('.copy-command-button') as HTMLButtonElement;
    expect(button).not.toBeNull();
    button.click();
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    const menu = f.nativeElement.querySelector('.copy-command-menu') as HTMLElement;
    expect(menu).not.toBeNull();
    expect(menu.getAttribute('role')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    return { button, menu };
  };

  it('copies immediately when only one template is linked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const { f, listItemCommandTemplatesByNumber } = await create([template]);
    const button = f.nativeElement.querySelector('.copy-command-button') as HTMLButtonElement;
    button.click();
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
      resolveCommand(template.template, itemDetailUrl(window.location.origin, 1, 1)),
    );
    expect(f.nativeElement.querySelector('.copy-command-menu')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the menu open for multiple templates and copies the chosen item', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const second = { id: 8, name: 'echo', template: 'echo {{url}}', position: 1 };
    const { f } = await create([template, second]);
    const { menu } = await openMenu(f);
    const item = menu.querySelector('[role="menuitem"]') as HTMLButtonElement;
    expect(item).not.toBeNull();
    item.click();
    await vi.waitUntil(() => {
      f.detectChanges();
      return (f.nativeElement.querySelector('.copy-feedback-banner')?.textContent ?? '').includes(
        COPY_COMMAND_SUCCESS,
      );
    });
    expect(writeText).toHaveBeenCalledWith(
      resolveCommand(template.template, itemDetailUrl(window.location.origin, 1, 1)),
    );
  });

  it('closes the menu when the command button is clicked again', async () => {
    const second = { id: 8, name: 'echo', template: 'echo {{url}}', position: 1 };
    const { f } = await create([template, second]);
    const { button } = await openMenu(f);
    button.click();
    f.detectChanges();
    expect(f.nativeElement.querySelector('.copy-command-menu')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape, outside click, or backlog scroll', async () => {
    const second = { id: 8, name: 'echo', template: 'echo {{url}}', position: 1 };
    const { f } = await create([template, second]);
    await openMenu(f);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.detectChanges();
    expect(f.nativeElement.querySelector('.copy-command-menu')).toBeNull();

    await openMenu(f);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    f.detectChanges();
    expect(f.nativeElement.querySelector('.copy-command-menu')).toBeNull();

    await openMenu(f);
    const scrollEl = f.nativeElement.querySelector('.backlog-scroll') as HTMLElement;
    scrollEl.dispatchEvent(new Event('scroll', { bubbles: true }));
    f.detectChanges();
    expect(f.nativeElement.querySelector('.copy-command-menu')).toBeNull();
  });

  it('does not auto-copy a single template after the menu was closed before the response', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const delayed = new Subject<{ templates: typeof template[] }>();
    const { f } = await create([template], vi.fn(() => delayed.asObservable()));
    const button = f.nativeElement.querySelector('.copy-command-button') as HTMLButtonElement;
    button.click();
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

  it('closes the menu when load is called', async () => {
    const delayed = new Subject<{ templates: typeof template[] }>();
    const { f } = await create([template], vi.fn(() => delayed.asObservable()));
    const button = f.nativeElement.querySelector('.copy-command-button') as HTMLButtonElement;
    button.click();
    f.detectChanges();
    expect(f.componentInstance.openCommandItemId()).not.toBeNull();
    f.componentInstance.load();
    f.detectChanges();
    expect(f.componentInstance.openCommandItemId()).toBeNull();
    delayed.next({ templates: [template] });
    delayed.complete();
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.querySelector('.copy-command-menu')).toBeNull();
  });

  it('closes the menu when the open row leaves the filtered list', async () => {
    const delayed = new Subject<{ templates: typeof template[] }>();
    const { f } = await create(
      [
        { ...template, id: 1 },
        { id: 2, name: 'other', template: 'y', position: 1 },
      ],
      vi.fn(() => delayed.asObservable()),
    );
    const button = f.nativeElement.querySelector('.copy-command-button') as HTMLButtonElement;
    button.click();
    f.detectChanges();
    expect(f.componentInstance.openCommandItemId()).not.toBeNull();
    f.componentInstance.listFilter.setQuery('backlog', 'no-such-title');
    f.detectChanges();
    expect(f.componentInstance.filteredItems().length).toBe(0);
    expect(f.componentInstance.openCommandItemId()).toBeNull();
    delayed.next({
      templates: [
        { ...template, id: 1 },
        { id: 2, name: 'other', template: 'y', position: 1 },
      ],
    });
    delayed.complete();
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.querySelector('.copy-command-menu')).toBeNull();
  });

  it('closes the menu when a project switch reload starts', async () => {
    const cards = makeCards();
    const columns = makeColumns();
    const patch = new Subject<{ settings: { cardLayout: 'pack'; activeProjectId: number } }>();
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog: () => of({ items: cards }),
            board: () => of({ columns, items: cards, settings: { cardLayout: 'pack', activeProjectId: 1 } }),
            patchBoardSettings: vi.fn(() => patch.asObservable()),
            listItemCommandTemplatesByNumber: vi.fn(() =>
              of({ templates: [{ ...template }, { id: 5, name: 'b', template: 'x', position: 1 }] }),
            ),
            listFilter: () =>
              of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: {
              board: { query: string; statusIds: number[] };
              backlog: { query: string; statusIds: number[] };
            }) => of(f),
          },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    await openMenu(f);
    const session = TestBed.inject(ProjectSession);
    session.activeId.set(1);
    session.switchTo(2).subscribe({ error: () => undefined });
    patch.next({ settings: { cardLayout: 'pack', activeProjectId: 2 } });
    patch.complete();
    f.detectChanges();
    expect(f.nativeElement.querySelector('.copy-command-menu')).toBeNull();
    expect(f.componentInstance.openCommandItemId()).toBeNull();
    f.destroy();
  });

  it('does not start row drag when dragstart originates on copy controls', async () => {
    const cards = makeCards();
    const columns = makeColumns();
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog: () => of({ items: cards }),
            board: () => of({ columns, items: cards, settings: { cardLayout: 'pack', activeProjectId: 1 } }),
            reorderBacklog: () => of({ items: cards }),
            listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () =>
              of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: {
              board: { query: string; statusIds: number[] };
              backlog: { query: string; statusIds: number[] };
            }) => of(f),
          },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    const zone = f.nativeElement.querySelector('.backlog-drag-zone') as HTMLElement;
    const copyBtn = f.nativeElement.querySelector('.copy-card-link') as HTMLButtonElement;
    const ev = dispatchDragEvent(copyBtn, 'dragstart', { clientY: 40 });
    expect(ev.defaultPrevented).toBe(true);
    expect(f.componentInstance.draggingItemId()).toBeNull();
    const cmdBtn = f.nativeElement.querySelector('.copy-command-button') as HTMLButtonElement;
    const ev2 = dispatchDragEvent(cmdBtn, 'dragstart', { clientY: 40 });
    expect(ev2.defaultPrevented).toBe(true);
    dispatchDragEvent(zone, 'dragstart', { clientY: 40 });
    expect(f.componentInstance.draggingItemId()).toBe(1);
  });

  it('shows empty notice when no templates exist', async () => {
    const { f } = await create([]);
    const { menu } = await openMenu(f);
    expect(menu.textContent).toContain(COMMAND_ITEM_MENU_EMPTY);
    expect(menu.querySelector('[role="menuitem"]')).toBeNull();
  });

  it('shows only the latest copy feedback when a link copy follows a command copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const { f } = await create([template]);
    const button = f.nativeElement.querySelector('.copy-command-button') as HTMLButtonElement;
    button.click();
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
    const live = f.nativeElement.querySelector('.copy-feedback-banner')?.textContent ?? '';
    expect(live).toContain(COPY_LINK_SUCCESS);
    expect(live).not.toContain(COPY_COMMAND_SUCCESS);
  });
});

describe('Backlog list filter', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('filters rows and clear restores; reorder disabled while active', async () => {
    const cards = makeCards();
    const columns = makeColumns();
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog: () => of({ items: cards }),
            board: () => of({ columns, items: cards , settings: { cardLayout: 'pack', activeProjectId: 1 } }),
            listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
        },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.querySelector('.list-filter')).not.toBeNull();
    expect(f.componentInstance.filteredItems().length).toBe(4);
    expect(f.componentInstance.canReorder()).toBe(true);
    f.componentInstance.listFilter.setQuery('backlog', 'A');
    f.detectChanges();
    expect(f.componentInstance.filteredItems().map((c) => c.title)).toEqual(['A']);
    expect(f.componentInstance.canReorder()).toBe(false);
    f.componentInstance.listFilter.clear('backlog');
    f.detectChanges();
    expect(f.componentInstance.filteredItems().length).toBe(4);
    expect(f.componentInstance.canReorder()).toBe(true);
  });
});
describe('Backlog AI chat context', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('tells the AI chat it is the backlog, and clears on destroy', async () => {
    const cards = makeCards();
    const columns = makeColumns();
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog: () => of({ items: cards }),
            board: () => of({ columns, items: cards, settings: { cardLayout: 'pack' } }),
            reorderBacklog: () => of({ items: cards }),
            listCommandTemplates: () => of({ templates: [] }),
            listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: unknown) => of(f),
          },
        },
      ],
    });
    const ctx = TestBed.inject(AiChatContext);
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    expect(ctx.pageKind()).toBe('backlog');
    expect(ctx.focusItem()).toBeNull();
    f.destroy();
    expect(ctx.pageKind()).toBe('other');
  });
});
