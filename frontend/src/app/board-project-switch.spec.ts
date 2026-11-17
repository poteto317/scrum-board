import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { Board } from './board';
import { normalizeBoardData } from './board-data';
import { BoardData, Item } from './models';
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
    dueAt: null,
    createdAt: '',
    updatedAt: '',
  };
}

function boardFor(projectId: number, title: string): BoardData {
  return {
    columns: [
      { id: 1, name: 'Todo', position: 0 },
      { id: 2, name: 'Doing', position: 1 },
    ],
    items: [card(1, title, projectId), card(2, title + '2', projectId)],
    settings: { cardLayout: 'pack', activeProjectId: projectId },
  };
}

describe('Board project switch', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('blocks reorder and live refresh until the post-switch reload finishes', async () => {
    vi.useFakeTimers();
    const initial = boardFor(1, 'A');
    const next = boardFor(2, 'B');
    const held = new Subject<BoardData>();
    let phase: 'init' | 'held' | 'after' = 'init';
    const board = vi.fn(() => {
      if (phase === 'init') return of(initial);
      if (phase === 'held') return held.asObservable();
      return of(next);
    });
    const patch = new Subject<{ settings: { cardLayout: 'pack'; activeProjectId: number } }>();
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board,
            patchBoardSettings: vi.fn(() => patch.asObservable()),
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
    const session = TestBed.inject(ProjectSession);
    session.activeId.set(1);
    expect(f.componentInstance.canReorderItems()).toBe(true);
    expect(board).toHaveBeenCalledTimes(1);

    phase = 'held';
    session.switchTo(2).subscribe({ error: () => undefined });
    expect(session.switching()).toBe(true);
    expect(session.activeId()).toBe(2);
    expect(f.componentInstance.canReorderItems()).toBe(false);

    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(board).toHaveBeenCalledTimes(1);

    patch.next({ settings: { cardLayout: 'pack', activeProjectId: 2 } });
    patch.complete();
    expect(board).toHaveBeenCalledTimes(2);
    expect(session.switching()).toBe(true);
    expect(f.componentInstance.canReorderItems()).toBe(false);

    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(board).toHaveBeenCalledTimes(2);

    held.next(next);
    held.complete();
    expect(session.switching()).toBe(false);
    expect(f.componentInstance.data().items.map((item) => item.title)).toEqual(['B', 'B2']);
    expect(f.componentInstance.canReorderItems()).toBe(true);

    phase = 'after';
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(board).toHaveBeenCalledTimes(3);
    f.destroy();
  });

  it('does not reload or keep switching when the settings PATCH fails', async () => {
    vi.useFakeTimers();
    const initial = boardFor(1, 'A');
    const board = vi.fn(() => of(initial));
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board,
            patchBoardSettings: vi.fn(() =>
              new Subject<{ settings: { activeProjectId: number } }>().asObservable(),
            ),
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
    const session = TestBed.inject(ProjectSession);
    session.activeId.set(1);
    const failed = new Subject<never>();
    const api = TestBed.inject(Api);
    vi.mocked(api.patchBoardSettings).mockReturnValue(failed.asObservable());

    session.switchTo(2).subscribe({ error: () => undefined });
    failed.error({ error: { message: '切替失敗' } });
    expect(session.activeId()).toBe(1);
    expect(session.switching()).toBe(false);
    expect(board).toHaveBeenCalledTimes(1);
    expect(f.componentInstance.data().items.map((item) => item.title)).toEqual(['A', 'A2']);
    expect(normalizeBoardData(initial).settings.activeProjectId).toBe(1);
    f.destroy();
  });

  it('ignores a stale board response that arrives after the switched project loads', async () => {
    const first = new Subject<BoardData>();
    const second = new Subject<BoardData>();
    const calls: Array<Subject<BoardData>> = [];
    const board = vi.fn(() => {
      const subject = calls.length === 0 ? first : second;
      calls.push(subject);
      return subject.asObservable();
    });
    const patch = new Subject<{ settings: { cardLayout: 'pack'; activeProjectId: number } }>();
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board,
            patchBoardSettings: vi.fn(() => patch.asObservable()),
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
    const session = TestBed.inject(ProjectSession);
    session.activeId.set(1);
    session.switchTo(2).subscribe({ error: () => undefined });
    patch.next({ settings: { cardLayout: 'pack', activeProjectId: 2 } });
    patch.complete();
    second.next(boardFor(2, 'B'));
    second.complete();
    expect(f.componentInstance.data().items[0].title).toBe('B');
    expect(session.switching()).toBe(false);

    first.next(boardFor(1, 'A'));
    first.complete();
    expect(f.componentInstance.data().items[0].title).toBe('B');
    f.destroy();
  });
});
