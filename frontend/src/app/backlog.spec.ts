import { ApplicationRef } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { Api } from './api';
import { Backlog } from './backlog';
import {
  readBacklogScroll,
  readReturnTo,
  saveBacklogScroll,
} from './list-scroll-session';
import { Item, Column } from './models';
import { TODO_COLUMN_MISSING } from './todo-column';

function makeCards(): Item[] {
  return [
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
      closeReason: '',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 2,
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
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 3,
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
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 9,
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
            board: () => of({ columns, items: cards }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
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
            board: () => of({ columns, items: cards }),
            reorderBacklog,
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
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
            board: () => of({ columns, items: cards }),
            reorderBacklog,
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
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
            board: () => of({ columns, items: cards }),
            reorderBacklog,
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
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
            board: () => of({ columns, items: cards }),
            createItem,
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
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
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
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
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
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
      listFilter: () => of({ query: '', statusIds: [] }),
      putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
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
      listFilter: () => of({ query: '', statusIds: [] }),
      putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
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
            board: () => of({ columns, items: cards }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
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
    expect(navigate).toHaveBeenCalledWith(['/items', 1]);
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
            board: () => of({ columns, items: cards }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
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
            board: () => of({ columns, items: cards }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
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
            board: () => of({ columns, items: cards }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
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
            board: () => of({ columns, items: cards }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
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
            board: () => of({ columns, items: cards }),
            createItem: vi.fn(),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
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
            board: () => of({ columns, items: cards }),
            listFilter: () => of({ query: '', statusIds: [] }),
            putListFilter: (f: { query: string; statusIds: number[] }) => of(f),
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
    f.componentInstance.listFilter.setQuery('A');
    f.detectChanges();
    expect(f.componentInstance.filteredItems().map((c) => c.title)).toEqual(['A']);
    expect(f.componentInstance.canReorder()).toBe(false);
    f.componentInstance.listFilter.clear();
    f.detectChanges();
    expect(f.componentInstance.filteredItems().length).toBe(4);
    expect(f.componentInstance.canReorder()).toBe(true);
  });
});
