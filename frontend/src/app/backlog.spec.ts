import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';
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
      backlogPosition: 0,
      prUrl: '',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 2,
      number: 2,
      columnId: 2,
      title: 'B',
      description: '',
      backlogPosition: 1,
      prUrl: '',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 3,
      number: 3,
      columnId: 3,
      title: 'C',
      description: '',
      backlogPosition: 2,
      prUrl: '',
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 9,
      number: 9,
      columnId: 1,
      title: 'D',
      description: '',
      backlogPosition: 3,
      prUrl: '',
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
      backlogPosition: 1,
      prUrl: '',
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
});
