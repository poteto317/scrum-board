import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { Backlog } from './backlog';
import { Item } from './models';
import { ProjectSession } from './project-session';

const POLL_MS = 5000;

function card(id: number, title: string, projectId: number): Item {
  return {
    id,
    number: id,
    projectId,
    columnId: 1,
    title,
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

const columns = [
  { id: 1, name: 'Todo', position: 0 },
  { id: 2, name: 'Doing', position: 1 },
];

describe('Backlog project switch', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('blocks reorder and live refresh until the post-switch reload finishes', async () => {
    vi.useFakeTimers();
    const initialItems = [card(1, 'A', 1), card(2, 'B', 1)];
    const nextItems = [card(3, 'C', 2), card(4, 'D', 2)];
    const heldBacklog = new Subject<{ items: Item[] }>();
    const heldBoard = new Subject<{ columns: typeof columns; items: Item[] }>();
    let phase: 'init' | 'held' | 'after' = 'init';
    const backlog = vi.fn(() => {
      if (phase === 'init') return of({ items: initialItems });
      if (phase === 'held') return heldBacklog.asObservable();
      return of({ items: nextItems });
    });
    const board = vi.fn(() => {
      if (phase === 'init') return of({ columns, items: initialItems });
      if (phase === 'held') return heldBoard.asObservable();
      return of({ columns, items: nextItems });
    });
    const patch = new Subject<{ settings: { cardLayout: 'pack'; activeProjectId: number } }>();
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog,
            board,
            patchBoardSettings: vi.fn(() => patch.asObservable()),
            listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
          },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    const session = TestBed.inject(ProjectSession);
    session.activeId.set(1);
    expect(f.componentInstance.canReorder()).toBe(true);
    expect(backlog).toHaveBeenCalledTimes(1);

    phase = 'held';
    session.switchTo(2).subscribe({ error: () => undefined });
    expect(session.switching()).toBe(true);
    expect(f.componentInstance.canReorder()).toBe(false);

    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(backlog).toHaveBeenCalledTimes(1);
    expect(board).toHaveBeenCalledTimes(1);

    patch.next({ settings: { cardLayout: 'pack', activeProjectId: 2 } });
    patch.complete();
    expect(backlog).toHaveBeenCalledTimes(2);
    expect(board).toHaveBeenCalledTimes(2);
    expect(session.switching()).toBe(true);

    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(backlog).toHaveBeenCalledTimes(2);

    heldBacklog.next({ items: nextItems });
    heldBacklog.complete();
    heldBoard.next({ columns, items: nextItems });
    heldBoard.complete();
    expect(session.switching()).toBe(false);
    expect(f.componentInstance.items().map((item) => item.title)).toEqual(['C', 'D']);
    expect(f.componentInstance.canReorder()).toBe(true);

    phase = 'after';
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(backlog).toHaveBeenCalledTimes(3);
    f.destroy();
  });

  it('restores the select id and does not reload when the switch PATCH fails', async () => {
    const backlog = vi.fn(() => of({ items: [card(1, 'A', 1), card(2, 'B', 1)] }));
    const board = vi.fn(() =>
      of({ columns, items: [card(1, 'A', 1), card(2, 'B', 1)] }),
    );
    const patch = new Subject<never>();
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog,
            board,
            patchBoardSettings: vi.fn(() => patch.asObservable()),
            listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
          },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    const session = TestBed.inject(ProjectSession);
    session.activeId.set(1);
    session.switchTo(2).subscribe({ error: () => undefined });
    patch.error({ error: { message: '切替失敗' } });
    expect(session.activeId()).toBe(1);
    expect(session.switching()).toBe(false);
    expect(session.error()).toContain('切替失敗');
    expect(backlog).toHaveBeenCalledTimes(1);
    expect(f.componentInstance.items().map((item) => item.title)).toEqual(['A', 'B']);
    f.destroy();
  });

  it('hides previous-project cards while activeId has switched and reload is in flight', async () => {
    const initialItems = [card(1, 'A', 1), card(2, 'B', 1)];
    const heldBacklog = new Subject<{ items: Item[] }>();
    const heldBoard = new Subject<{ columns: typeof columns; items: Item[] }>();
    let phase: 'init' | 'held' = 'init';
    const backlog = vi.fn(() => {
      if (phase === 'init') return of({ items: initialItems });
      return heldBacklog.asObservable();
    });
    const board = vi.fn(() => {
      if (phase === 'init') return of({ columns, items: initialItems });
      return heldBoard.asObservable();
    });
    const patch = new Subject<{ settings: { cardLayout: 'pack'; activeProjectId: number } }>();
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog,
            board,
            patchBoardSettings: vi.fn(() => patch.asObservable()),
            listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
          },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    const session = TestBed.inject(ProjectSession);
    session.activeId.set(1);
    expect(f.componentInstance.filteredItems().map((c) => c.title)).toEqual(['A', 'B']);

    phase = 'held';
    session.switchTo(2).subscribe({ error: () => undefined });
    patch.next({ settings: { cardLayout: 'pack', activeProjectId: 2 } });
    patch.complete();
    expect(session.activeId()).toBe(2);
    expect(f.componentInstance.items().map((c) => c.projectId)).toEqual([1, 1]);
    expect(f.componentInstance.activeItems()).toEqual([]);
    expect(f.componentInstance.filteredItems()).toEqual([]);

    heldBacklog.next({ items: [card(3, 'C', 2)] });
    heldBacklog.complete();
    heldBoard.next({ columns, items: [card(3, 'C', 2)] });
    heldBoard.complete();
    expect(f.componentInstance.filteredItems().map((c) => c.title)).toEqual(['C']);
    f.destroy();
  });

  it('keeps previous-project cards hidden after post-switch reload fails', async () => {
    const initialItems = [card(1, 'A', 1), card(2, 'B', 1)];
    const heldBacklog = new Subject<{ items: Item[] }>();
    const heldBoard = new Subject<{ columns: typeof columns; items: Item[] }>();
    let phase: 'init' | 'held' = 'init';
    const backlog = vi.fn(() => {
      if (phase === 'init') return of({ items: initialItems });
      return heldBacklog.asObservable();
    });
    const board = vi.fn(() => {
      if (phase === 'init') return of({ columns, items: initialItems });
      return heldBoard.asObservable();
    });
    const patch = new Subject<{ settings: { cardLayout: 'pack'; activeProjectId: number } }>();
    TestBed.configureTestingModule({
      imports: [Backlog],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            backlog,
            board,
            patchBoardSettings: vi.fn(() => patch.asObservable()),
            listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
          },
        },
      ],
    });
    const f = TestBed.createComponent(Backlog);
    f.detectChanges();
    await f.whenStable();
    const session = TestBed.inject(ProjectSession);
    session.activeId.set(1);
    phase = 'held';
    session.switchTo(2).subscribe({ error: () => undefined });
    patch.next({ settings: { cardLayout: 'pack', activeProjectId: 2 } });
    patch.complete();
    heldBacklog.error({ error: { message: '再取得失敗' } });
    heldBoard.error({ error: { message: '再取得失敗' } });
    expect(session.activeId()).toBe(2);
    expect(session.switching()).toBe(false);
    expect(f.componentInstance.items().map((c) => c.projectId)).toEqual([1, 1]);
    expect(f.componentInstance.activeItems()).toEqual([]);
    expect(f.componentInstance.filteredItems()).toEqual([]);
    f.destroy();
  });
});
