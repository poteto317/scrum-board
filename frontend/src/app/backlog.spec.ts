import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { Api } from './api';
import { Backlog } from './backlog';
import { Card, Column } from './models';

function makeCards(): Card[] {
  return [
    {
      id: 1,
      number: 1,
      columnId: 1,
      title: 'A',
      description: '',
      position: 0,
      backlogPosition: 0,
      prUrls: [],
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
      prUrls: [],
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
      prUrls: [],
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
      prUrls: [],
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
            backlog: () => of({ cards }),
            board: () => of({ columns, cards }),
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
        cards: ids.map((id, backlogPosition) => ({
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
            backlog: () => of({ cards }),
            board: () => of({ columns, cards }),
            reorderBacklog,
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
    expect(f.componentInstance.draggingCardId()).toBe(9);
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
        cards: ids.map((id, backlogPosition) => ({
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
            backlog: () => of({ cards }),
            board: () => of({ columns, cards }),
            reorderBacklog,
          },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    const handles = Array.from(
      f.nativeElement.querySelectorAll('.backlog-drag-handle') as NodeListOf<HTMLButtonElement>,
    );
    handles[2].focus();
    handles[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }));
    f.detectChanges();
    expect(reorderBacklog).toHaveBeenCalledWith([1, 3, 2, 9]);

    f.componentInstance.cards.set([cards[0]]);
    f.detectChanges();
    expect(f.componentInstance.canReorder()).toBe(false);
    const singleZone = f.nativeElement.querySelector('.backlog-drag-zone') as HTMLElement;
    const singleHandle = f.nativeElement.querySelector('.backlog-drag-handle') as HTMLButtonElement;
    expect(singleZone.getAttribute('draggable')).toBeNull();
    expect(singleHandle.getAttribute('aria-disabled')).toBe('true');
  });

  it('rolls back optimistic order on save failure and shows reload on conflict', async () => {
    const cards = makeCards();
    const columns = makeColumns();
    const fail = new Subject<{ cards: Card[] }>();
    const reorderBacklog = vi.fn(() => fail);
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog: () => of({ cards }),
            board: () => of({ columns, cards }),
            reorderBacklog,
          },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    const handles = Array.from(
      f.nativeElement.querySelectorAll('.backlog-drag-handle') as NodeListOf<HTMLButtonElement>,
    );
    handles[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    f.detectChanges();
    expect(f.componentInstance.cards().map((c) => c.id)).toEqual([2, 1, 3, 9]);
    fail.error({ status: 409, error: { message: '構成が変更されています' } });
    f.detectChanges();
    expect(f.componentInstance.cards().map((c) => c.id)).toEqual([1, 2, 3, 9]);
    expect(f.componentInstance.reorderConflict()).toBe(true);
    expect(f.nativeElement.querySelector('.reorder-reload')).not.toBeNull();
    expect(f.nativeElement.querySelector('.reorder-dismiss')).toBeNull();
  });

  it('creates a card from the backlog modal with selected status', async () => {
    const cards = makeCards().slice(0, 1);
    const columns = makeColumns();
    const created: Card = {
      id: 10,
      number: 10,
      columnId: 2,
      title: 'New',
      description: 'd',
      position: 1,
      backlogPosition: 1,
      prUrls: [],
      createdAt: '',
      updatedAt: '',
    };
    const createCard = vi.fn(() => of(created));
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog: () => of({ cards }),
            board: () => of({ columns, cards }),
            createCard,
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
      f.componentInstance.openCard();
      f.detectChanges();
      f.componentInstance.cardForm.setValue({
        title: 'New',
        description: 'd',
        columnId: 2,
      });
      f.componentInstance.addCard();
      f.detectChanges();
      expect(createCard).toHaveBeenCalledWith({ title: 'New', description: 'd', columnId: 2 });
      expect(f.componentInstance.cards().at(-1)?.id).toBe(10);
      expect(f.componentInstance.modal()).toBeNull();
    } finally {
      proto.showModal = origShowModal;
      proto.close = origClose;
    }
  });

  it('disables the add-card button and blocks openCard when initial load fails or columns are empty', async () => {
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog: () => throwError(() => ({ status: 500, error: { message: '失敗' } })),
            board: () => throwError(() => ({ status: 500, error: { message: '失敗' } })),
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
    f.componentInstance.openCard();
    expect(f.componentInstance.modal()).toBeNull();

    f.componentInstance.error.set('');
    f.detectChanges();
    expect(addButton.disabled).toBe(true);
    f.componentInstance.openCard();
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
      backlog: vi.fn(() => of({ cards })),
      board: vi.fn(() => of({ columns, cards: [] })),
      createCard: vi.fn(),
      reorderBacklog: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [provideRouter([]), { provide: Api, useValue: api }],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    expect(f.componentInstance.loading()).toBe(false);

    const next = [...cards, { ...cards[0], id: 50, number: 50, title: 'Polled' }];
    api.backlog.mockReturnValue(of({ cards: next }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.componentInstance.loading()).toBe(false);
    expect(f.componentInstance.error()).toBe('');
    expect(f.componentInstance.cards().some((c) => c.number === 50)).toBe(true);
    f.destroy();
  });

  it('does not apply while reordering', async () => {
    vi.useFakeTimers();
    const cards = makeCards();
    const columns = makeColumns();
    const api = {
      backlog: vi.fn(() => of({ cards })),
      board: vi.fn(() => of({ columns, cards: [] })),
      createCard: vi.fn(),
      reorderBacklog: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [provideRouter([]), { provide: Api, useValue: api }],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    f.componentInstance.reordering.set(true);
    const before = f.componentInstance.cards().length;
    api.backlog.mockReturnValue(of({ cards: [] }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.componentInstance.cards()).toHaveLength(before);
    f.destroy();
  });
});
