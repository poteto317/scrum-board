import { CdkDropList } from '@angular/cdk/drag-drop';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { Board } from './board';
import { BoardData, Item } from './models';

function card(id: number, columnId: number, position: number, offsetY = 0): Item {
  return {
    id,
    projectId: 1,
    number: id,
    columnId,
    title: `c${id}`,
    description: '',
    position,
    backlogPosition: position,
    offsetY,
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

function board(layout: 'pack' | 'free', items: Item[]): BoardData {
  return {
    columns: [
      { id: 1, name: 'Todo', position: 0 },
      { id: 2, name: 'Doing', position: 1 },
    ],
    items,
    settings: { cardLayout: layout, activeProjectId: 1 },
  };
}

async function setup(opts: {
  initial?: BoardData;
  reorderItems?: ReturnType<typeof vi.fn>;
  patchBoardSettings?: ReturnType<typeof vi.fn>;
  boardFn?: ReturnType<typeof vi.fn>;
}) {
  const initial = opts.initial ?? board('pack', [card(1, 1, 0, 40), card(2, 1, 1, 10), card(3, 2, 0, 0)]);
  const reorderItems = opts.reorderItems ?? vi.fn(() => of({ items: initial.items }));
  const patchBoardSettings =
    opts.patchBoardSettings ?? vi.fn(() => of({ settings: { cardLayout: 'free', activeProjectId: 1 } }));
  const boardFn = opts.boardFn ?? vi.fn(() => of(initial));
  TestBed.configureTestingModule({
    imports: [Board],
    providers: [
      provideRouter([]),
      {
        provide: Api,
        useValue: {
          board: boardFn,
          reorderItems,
          patchBoardSettings,
          listCommandTemplates: () => of({ templates: [] }),
          listLabels: () => of({ labels: [] }),
          listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
          putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
        },
      },
    ],
  });
  const f = TestBed.createComponent(Board);
  f.detectChanges();
  await f.whenStable();
  return { f, component: f.componentInstance, reorderItems, patchBoardSettings, boardFn };
}

describe('Board free card layout', () => {
  it('defaults to pack and disables the toggle while loading', async () => {
    const pending = new Subject<BoardData>();
    const { f, component } = await setup({
      boardFn: vi.fn(() => pending),
    });
    expect(component.loading()).toBe(true);
    expect(component.canToggleCardLayout()).toBe(false);
    expect(component.layoutToggleGate().reason.length).toBeGreaterThan(0);
    expect(f.nativeElement.querySelector('.layout-toggle input')?.disabled).toBe(true);
    pending.next(board('pack', [card(1, 1, 0)]));
    pending.complete();
    f.detectChanges();
    await f.whenStable();
    expect(component.cardLayout()).toBe('pack');
    expect(component.canToggleCardLayout()).toBe(true);
  });

  it('keeps offsetY on cross-column free drops and sends offsetYs', async () => {
    const reorderItems = vi.fn((columns: unknown) => {
      const next = [
        { ...card(2, 2, 0, 0), position: 0 },
        { ...card(1, 2, 1, 80), position: 1 },
      ];
      return of({ items: next, _echo: columns });
    });
    const { component } = await setup({
      initial: board('free', [card(1, 1, 0, 80), card(2, 2, 0, 0)]),
      reorderItems,
    });
    component.onItemDrop(
      {
        previousContainer: { id: 'card-list-1' },
        container: { id: 'card-list-2' },
        previousIndex: 0,
        currentIndex: 0,
        dropPoint: { x: 0, y: 0 },
        item: { data: card(1, 1, 0, 80) },
      } as never,
      2,
    );
    expect(reorderItems).toHaveBeenCalledWith([
      { columnId: 1, itemIds: [], offsetYs: [] },
      { columnId: 2, itemIds: [2, 1], offsetYs: [0, 80] },
    ]);
    expect(component.data().items.find((c) => c.id === 1)?.offsetY).toBe(80);
    expect(component.data().items.find((c) => c.id === 1)?.columnId).toBe(2);
  });

  it('updates same-column free drops via computeFreeOffsetY', async () => {
    const reorderItems = vi.fn(() => of({ items: [] }));
    const { f, component } = await setup({
      initial: board('free', [card(1, 1, 0, 40), card(2, 1, 1, 120)]),
      reorderItems,
    });
    const list = f.nativeElement.querySelector('#card-list-1') as HTMLElement;
    list.getBoundingClientRect = () =>
      ({
        top: 100,
        left: 0,
        right: 200,
        bottom: 400,
        width: 200,
        height: 300,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;
    Object.defineProperty(list, 'scrollTop', { configurable: true, value: 0 });
    // grabOffsetY captured on drag start; simulate pointer held 20px below card top.
    (component as unknown as { itemDragGrabOffsetY: number }).itemDragGrabOffsetY = 20;
    component.onItemDrop(
      {
        previousContainer: { id: 'card-list-1' },
        container: { id: 'card-list-1' },
        previousIndex: 0,
        currentIndex: 0,
        dropPoint: { x: 10, y: 250 },
        item: { data: card(1, 1, 0, 40) },
      } as never,
      1,
    );
    // pointer 250 - grab 20 - listTop 100 = 130
    expect(reorderItems).toHaveBeenCalledWith([
      { columnId: 1, itemIds: [2, 1], offsetYs: [120, 130] },
    ]);
  });

  it('disables CDK sorting in free mode but keeps connectedTo', async () => {
    const { f } = await setup({
      initial: board('free', [card(1, 1, 0, 0), card(2, 2, 0, 0)]),
    });
    const lists = f.debugElement
      .queryAll(By.directive(CdkDropList))
      .map((d) => d.injector.get(CdkDropList));
    expect(lists.every((l) => l.sortingDisabled)).toBe(true);
    expect(lists[0].connectedTo as string[]).toContain('card-list-2');
    expect(f.nativeElement.querySelector('.card-list-free')).toBeTruthy();
  });

  it('ignores keyboard arrow reorder while free', async () => {
    const reorderItems = vi.fn(() => of({ items: [] }));
    const { component } = await setup({
      initial: board('free', [card(1, 1, 0, 0), card(2, 1, 1, 40)]),
      reorderItems,
    });
    component.onItemKeydown(
      new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }),
      1,
      0,
    );
    expect(reorderItems).not.toHaveBeenCalled();
  });

  it('pack→free measures then orders then patches; reverts on order failure', async () => {
    const reorderItems = vi.fn(() => throwError(() => ({ status: 500, message: 'fail' })));
    const patchBoardSettings = vi.fn(() => of({ settings: { cardLayout: 'free', activeProjectId: 1 } }));
    const { f, component } = await setup({
      initial: board('pack', [card(1, 1, 0), card(2, 1, 1)]),
      reorderItems,
      patchBoardSettings,
    });
    const list = f.nativeElement.querySelector('#card-list-1') as HTMLElement;
    list.getBoundingClientRect = () =>
      ({ top: 50, left: 0, right: 100, bottom: 200, width: 100, height: 150, x: 0, y: 50, toJSON: () => ({}) }) as DOMRect;
    const cards = Array.from(list.querySelectorAll<HTMLElement>('.task-card'));
    cards.forEach((el, i) => {
      el.getBoundingClientRect = () =>
        ({
          top: 50 + i * 60,
          left: 0,
          right: 100,
          bottom: 100 + i * 60,
          width: 100,
          height: 50,
          x: 0,
          y: 50 + i * 60,
          toJSON: () => ({}),
        }) as DOMRect;
    });

    await component.onCardLayoutToggle(true);
    expect(reorderItems).toHaveBeenCalled();
    expect(patchBoardSettings).not.toHaveBeenCalled();
    expect(component.cardLayout()).toBe('pack');
    expect(component.reorderError().length).toBeGreaterThan(0);
  });

  it('free→pack patches settings and replaces items from the response', async () => {
    const packed = [card(2, 1, 0, 10), card(1, 1, 1, 40)];
    const patchBoardSettings = vi.fn(() =>
      of({ settings: { cardLayout: 'pack', activeProjectId: 1 }, items: packed }),
    );
    const { component } = await setup({
      initial: board('free', [card(1, 1, 0, 40), card(2, 1, 1, 10)]),
      patchBoardSettings,
    });
    await component.onCardLayoutToggle(false);
    expect(patchBoardSettings).toHaveBeenCalledWith({ cardLayout: 'pack' });
    expect(component.cardLayout()).toBe('pack');
    expect(component.data().items.map((c) => c.id)).toEqual([2, 1]);
  });

  it('keeps settings and offsetY when a live poll replaces the board', async () => {
    vi.useFakeTimers();
    try {
      const freeBoard = board('free', [card(1, 1, 0, 77)]);
      const boardFn = vi.fn(() => of(freeBoard));
      const { f, component } = await setup({ initial: freeBoard, boardFn });
      expect(component.cardLayout()).toBe('free');
      boardFn.mockReturnValueOnce(
        of({
          columns: freeBoard.columns,
          items: [{ ...card(1, 1, 0, 77), title: 'updated' }],
          settings: { cardLayout: 'free', activeProjectId: 1 },
        }),
      );
      await vi.advanceTimersByTimeAsync(5000);
      f.detectChanges();
      expect(component.cardLayout()).toBe('free');
      expect(component.data().items[0].offsetY).toBe(77);
      expect(component.data().items[0].title).toBe('updated');
    } finally {
      vi.useRealTimers();
    }
  });
});
