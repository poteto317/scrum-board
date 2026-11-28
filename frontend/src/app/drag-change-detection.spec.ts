import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { Api } from './api';
import { Backlog } from './backlog';
import { Board } from './board';
import { BoardData, Column, Item } from './models';

// Dragging must not re-evaluate the bindings of every card on each pointer move (#127). A template
// output such as (cdkDragMoved) or (dragover) marks the view dirty on every event, so the whole
// board is checked again at pointer-move rate. These tests count calls of a function the card
// templates call (formatItemNumber): it must not be called while the pointer only moves.

function card(id: number): Item {
  return {
    id,
    projectId: 1,
    number: id,
    columnId: 1,
    title: `card ${id}`,
    description: '',
    position: id - 1,
    backlogPosition: id - 1,
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

const columns: Column[] = [
  { id: 1, name: 'Todo', position: 0 },
  { id: 2, name: 'Doing', position: 1 },
];

const filterApi = {
  listLabels: () => of({ labels: [] }),
  listFilter: () =>
    of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
  putListFilter: (f: unknown) => of(f),
};

/** Counts how often the templates call formatItemNumber, which every card binds. */
function countCalls(component: object): { calls: () => number } {
  const target = component as { formatItemNumber: (n: number) => string };
  const original = target.formatItemNumber;
  let n = 0;
  target.formatItemNumber = (num: number) => {
    n += 1;
    return original(num);
  };
  return { calls: () => n };
}

function dragEvent(type: string, clientY: number): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    clientX: number;
    clientY: number;
    relatedTarget: null;
    dataTransfer: object;
  };
  ev.clientX = 0;
  ev.clientY = clientY;
  ev.relatedTarget = null;
  ev.dataTransfer = {
    setData: vi.fn(),
    getData: vi.fn(),
    effectAllowed: '',
    dropEffect: '',
    setDragImage: vi.fn(),
  };
  return ev;
}

/** Rows 60px high, 70px apart, from top 0. */
function rowRect(i: number): DOMRect {
  return {
    top: i * 70,
    height: 60,
    left: 0,
    right: 100,
    bottom: i * 70 + 60,
    width: 100,
  } as DOMRect;
}

/** Mounts the backlog with `count` cards whose rows report fixed positions (see rowRect). */
async function mountBacklogWithRows(count = 4) {
  const cards = Array.from({ length: count }, (_, i) => card(i + 1));
  TestBed.configureTestingModule({
    imports: [Backlog],
    providers: [
      provideRouter([]),
      {
        provide: Api,
        useValue: {
          backlog: () => of({ items: cards }),
          board: () =>
            of({ columns, items: cards, settings: { cardLayout: 'pack', activeProjectId: 1 } }),
          reorderBacklog: vi.fn(),
          ...filterApi,
        },
      },
    ],
  });
  const f = TestBed.createComponent(Backlog);
  f.detectChanges();
  await f.whenStable();
  mockRowRects(f.nativeElement);
  return {
    f,
    scroll: f.nativeElement.querySelector('.backlog-scroll') as HTMLElement,
    zone: (n: number) => f.nativeElement.querySelectorAll('.backlog-drag-zone')[n] as HTMLElement,
  };
}

function mockRowRects(root: HTMLElement, onMeasure?: () => void) {
  const rows = Array.from(root.querySelectorAll('.backlog-row')) as HTMLElement[];
  rows.forEach((row, i) => {
    vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => {
      onMeasure?.();
      return rowRect(i);
    });
  });
}

describe('Board drag does not re-check every card per pointer move', () => {
  it('runs no change detection while a real mouse drag only moves', async () => {
    const board: BoardData = {
      columns,
      items: [card(1), card(2), card(3), card(4)],
      settings: { cardLayout: 'pack', activeProjectId: 1 },
    };
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(board),
            reorderItems: vi.fn(),
            listCommandTemplates: () => of({ templates: [] }),
            ...filterApi,
          },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    onTestFinished(() => f.destroy());
    f.detectChanges();
    await f.whenStable();
    const scroller = f.nativeElement.querySelector('.board-scroll') as HTMLElement;
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 600,
      width: 1000,
      height: 600,
    } as DOMRect);
    const counter = countCalls(f.componentInstance);
    const handle = f.nativeElement.querySelector('.card-drag-handle') as HTMLElement;
    handle.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        detail: 1,
        clientX: 300,
        clientY: 300,
      }),
    );
    const move = (x: number, y: number) =>
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
      );
    move(320, 320); // past the threshold: the drag starts
    move(325, 325);
    await f.whenStable();
    expect(f.componentInstance.draggingItemId()).not.toBeNull();
    const before = counter.calls();
    for (let i = 0; i < 20; i++) move(330 + i, 330 + i);
    await f.whenStable();
    expect(counter.calls() - before).toBe(0);
    document.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: 350, clientY: 350 }),
    );
    await f.whenStable();
    f.destroy();
  });
});

describe('Backlog drag does not re-check every row per dragover', () => {
  it('runs no change detection, and measures the rows once, while dragover repeats', async () => {
    const { f, scroll, zone } = await mountBacklogWithRows();
    onTestFinished(() => f.destroy());
    let measured = 0;
    mockRowRects(f.nativeElement, () => (measured += 1));
    zone(0).dispatchEvent(dragEvent('dragstart', 10));
    await f.whenStable();
    const counter = countCalls(f.componentInstance);
    const measuredAtStart = measured;
    expect(measuredAtStart).toBeGreaterThan(0); // measured at the start of the drag
    scroll.dispatchEvent(dragEvent('dragover', 100)); // the first dragover may set the drop slot
    await f.whenStable();
    const before = counter.calls();
    for (let i = 0; i < 20; i++) scroll.dispatchEvent(dragEvent('dragover', 100)); // the same slot
    await f.whenStable();
    expect(counter.calls() - before).toBe(0);
    expect(measured).toBe(measuredAtStart); // the dragovers did not measure again
  });

  it('shows the drop slot in the view', async () => {
    const { f, scroll, zone } = await mountBacklogWithRows();
    onTestFinished(() => f.destroy());
    zone(3).dispatchEvent(dragEvent('dragstart', 10));
    scroll.dispatchEvent(dragEvent('dragover', 99));
    await f.whenStable();
    expect(f.componentInstance.dropSlot()).not.toBeNull();
    expect(f.nativeElement.querySelector('.backlog-row.drop-before')).not.toBeNull();
  });

  it('follows the list when it scrolls down during the drag, using the rows measured at the start', async () => {
    const { f, scroll, zone } = await mountBacklogWithRows();
    onTestFinished(() => f.destroy());
    scroll.scrollTop = 0;
    zone(3).dispatchEvent(dragEvent('dragstart', 10));
    // Scrolled down by 70, row 1 sits where row 0 was measured: row 0's middle is -40 and row 1's is 30,
    // so y=29 is after row 0 and before row 1: slot 1 (with the unscrolled rows it would be slot 0).
    Object.defineProperty(scroll, 'scrollTop', { configurable: true, value: 70, writable: true });
    scroll.dispatchEvent(dragEvent('dragover', 29));
    expect(f.componentInstance.dropSlot()).toBe(1);
  });

  it('follows the list when it scrolls back up during the drag', async () => {
    const { f, scroll, zone } = await mountBacklogWithRows();
    onTestFinished(() => f.destroy());
    Object.defineProperty(scroll, 'scrollTop', { configurable: true, value: 140, writable: true });
    zone(3).dispatchEvent(dragEvent('dragstart', 10));
    // Scrolled back up by 70, every row is 70px lower than measured: row 0's middle is 100,
    // so y=99 is before row 0: slot 0.
    (scroll as unknown as { scrollTop: number }).scrollTop = 70;
    scroll.dispatchEvent(dragEvent('dragover', 99));
    expect(f.componentInstance.dropSlot()).toBe(0);
  });

  it('measures again when the list has more rows than were measured at the start', async () => {
    const { f, scroll, zone } = await mountBacklogWithRows(4);
    onTestFinished(() => f.destroy());
    zone(3).dispatchEvent(dragEvent('dragstart', 10));
    f.componentInstance.items.update((list) => [...list, card(99)]); // a refresh adds a fifth row
    f.detectChanges();
    mockRowRects(f.nativeElement);
    // y=320 is below the fifth row's middle (280 + 30), so the slot after it is 5. With only the four
    // rows measured at the start it would be after row 3, the dragged row itself: no move, null.
    scroll.dispatchEvent(dragEvent('dragover', 320));
    expect(f.componentInstance.dropSlot()).toBe(5);
  });

  it('stops listening when the drag ends', async () => {
    const { f, scroll, zone } = await mountBacklogWithRows();
    onTestFinished(() => f.destroy());
    const removed = vi.spyOn(document, 'removeEventListener');
    zone(3).dispatchEvent(dragEvent('dragstart', 10));
    scroll.dispatchEvent(dragEvent('dragover', 99));
    expect(f.componentInstance.dropSlot()).not.toBeNull();
    zone(3).dispatchEvent(dragEvent('dragend', 0));
    expect(removed).toHaveBeenCalledWith('dragover', expect.any(Function));
    scroll.dispatchEvent(dragEvent('dragover', 99));
    const handler = vi.spyOn(
      f.componentInstance as unknown as { onListDragOver(e: Event): void },
      'onListDragOver',
    );
    scroll.dispatchEvent(dragEvent('dragover', 99));
    expect(handler).not.toHaveBeenCalled(); // nothing listens any more
  });

  it('stops listening when the page is destroyed in the middle of a drag', async () => {
    const { f, zone } = await mountBacklogWithRows();
    const removed = vi.spyOn(document, 'removeEventListener');
    zone(3).dispatchEvent(dragEvent('dragstart', 10));
    removed.mockClear();
    f.destroy();
    expect(removed).toHaveBeenCalledWith('dragover', expect.any(Function));
  });
  it('measures again when the same number of rows are re-ordered during the drag', async () => {
    const { f, scroll, zone } = await mountBacklogWithRows(4);
    onTestFinished(() => f.destroy());
    zone(3).dispatchEvent(dragEvent('dragstart', 10));
    // A refresh re-orders the rows (same count): the dragged card (4) is now the first row, and
    // that row is tall (200px), so the rows are not where they were measured.
    f.componentInstance.items.update((list) => [list[3], list[0], list[1], list[2]]);
    f.detectChanges();
    const rows = Array.from(f.nativeElement.querySelectorAll('.backlog-row')) as HTMLElement[];
    rows.forEach((row, i) => {
      const top = i === 0 ? 0 : 140 + i * 70;
      vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
        ...rowRect(i),
        top,
        height: i === 0 ? 200 : 60,
      } as DOMRect);
    });
    // y=150 is below the dragged row's middle (100) and above the next one's (210 + 30): the slot is
    // right after the dragged row itself, so there is nothing to move: null. The rows measured at the
    // start (all 60px high) would give the slot 2, between the second and third rows.
    scroll.dispatchEvent(dragEvent('dragover', 150));
    expect(f.componentInstance.dropSlot()).toBeNull();
  });

  it('measures again when the window is resized during the drag', async () => {
    const { f, scroll, zone } = await mountBacklogWithRows(4);
    onTestFinished(() => f.destroy());
    zone(3).dispatchEvent(dragEvent('dragstart', 10));
    // The rows moved down by 200px (e.g. the viewport width changed and a banner wrapped).
    (Array.from(f.nativeElement.querySelectorAll('.backlog-row')) as HTMLElement[]).forEach(
      (row, i) => {
        vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({
          ...rowRect(i),
          top: i * 70 + 200,
        } as DOMRect);
      },
    );
    window.dispatchEvent(new Event('resize'));
    scroll.dispatchEvent(dragEvent('dragover', 299)); // before row 1's new middle (270 + 30 = 300): slot 1
    expect(f.componentInstance.dropSlot()).toBe(1);
  });

  it('follows the page when it scrolls (window.scrollY) during the drag', async () => {
    const { f, scroll, zone } = await mountBacklogWithRows();
    onTestFinished(() => f.destroy());
    zone(3).dispatchEvent(dragEvent('dragstart', 10));
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(70);
    scroll.dispatchEvent(dragEvent('dragover', 29)); // as when the list itself scrolls by 70: slot 1
    expect(f.componentInstance.dropSlot()).toBe(1);
  });

  it('leaves a dragover outside the list alone', async () => {
    const { f, zone } = await mountBacklogWithRows();
    onTestFinished(() => f.destroy());
    zone(3).dispatchEvent(dragEvent('dragstart', 10));
    const outside = dragEvent('dragover', 99);
    document.body.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(false);
    expect(f.componentInstance.dropSlot()).toBeNull();
  });

  it('ends the drag when the dragged row disappears and no dragend can come', async () => {
    const { f, zone } = await mountBacklogWithRows();
    onTestFinished(() => f.destroy());
    const removed = vi.spyOn(document, 'removeEventListener');
    zone(3).dispatchEvent(dragEvent('dragstart', 10));
    expect(f.componentInstance.draggingItemId()).not.toBeNull();
    f.componentInstance.items.update((list) => list.slice(0, 3)); // a refresh removes the dragged card
    f.detectChanges();
    expect(f.componentInstance.draggingItemId()).toBeNull();
    expect(removed).toHaveBeenCalledWith('dragover', expect.any(Function));
  });
});
