import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of, Subject } from 'rxjs';
import { Api } from './api';
import {
  FavoritesSession,
  displayFavoriteTitle,
  favoritesFromBoard,
  sortFavorites,
} from './favorites-session';
import { ProjectSession } from './project-session';

describe('favoritesFromBoard', () => {
  it('filters favorites and sorts without mutating inputs', () => {
    const board = {
      columns: [],
      items: [
        { id: 2, number: 2, title: 'び', projectId: 1, favorite: true, columnId: 1 },
        { id: 1, number: 1, title: 'あ', projectId: 1, favorite: false, columnId: 1 },
        { id: 3, number: 3, title: 'あ', projectId: 1, favorite: true, columnId: 1 },
      ],
      settings: { cardLayout: 'pack' as const, activeProjectId: 1 },
    };
    expect(favoritesFromBoard(board as never).map((i) => i.number)).toEqual([3, 2]);
  });
});

describe('sortFavorites', () => {
  it('sorts by trimmed title then number', () => {
    const sorted = sortFavorites([
      { id: 2, number: 2, title: 'び', projectId: 1, favorite: true },
      { id: 1, number: 1, title: 'あ', projectId: 1, favorite: true },
      { id: 3, number: 3, title: ' あ', projectId: 1, favorite: true },
    ]);
    expect(sorted.map((i) => i.number)).toEqual([1, 3, 2]);
  });
});

describe('displayFavoriteTitle', () => {
  it('uses （無題） for empty or whitespace titles', () => {
    expect(displayFavoriteTitle('')).toBe('（無題）');
    expect(displayFavoriteTitle('  ')).toBe('（無題）');
    expect(displayFavoriteTitle('メモ')).toBe('メモ');
  });
});

describe('FavoritesSession', () => {
  let api: { board: ReturnType<typeof vi.fn> };
  let projectSession: {
    switching: ReturnType<typeof vi.fn>;
    activeId: ReturnType<typeof vi.fn>;
  };
  let session: FavoritesSession;

  beforeEach(() => {
    api = { board: vi.fn() };
    projectSession = {
      switching: vi.fn(() => false),
      activeId: vi.fn(() => 1),
    };
    TestBed.configureTestingModule({
      providers: [
        FavoritesSession,
        { provide: Api, useValue: api },
        { provide: ProjectSession, useValue: projectSession },
      ],
    });
    session = TestBed.inject(FavoritesSession);
  });

  it('filters favorite items and ignores stale responses', () => {
    const slow = new Subject<unknown>();
    const fast = of({
      columns: [],
      items: [
        { id: 1, number: 1, title: 'keep', projectId: 1, favorite: true, columnId: 1 },
        { id: 2, number: 2, title: 'skip', projectId: 1, favorite: false, columnId: 1 },
      ],
      settings: { cardLayout: 'pack', activeProjectId: 1 },
    });
    api.board.mockReturnValueOnce(slow).mockReturnValueOnce(fast);
    session.loadForActiveProject();
    session.loadForActiveProject();
    slow.next({
      columns: [],
      items: [{ id: 9, number: 9, title: 'stale', projectId: 1, favorite: true, columnId: 1 }],
      settings: { cardLayout: 'pack', activeProjectId: 1 },
    });
    slow.complete();
    expect(session.items().map((i) => i.number)).toEqual([1]);
  });

  it('applyToggle adds and removes; revertToggle restores', () => {
    session.items.set([{ id: 1, number: 1, title: 'a', projectId: 1, favorite: true }]);
    const snap = session.items().map((i) => ({ ...i }));
    session.applyToggle({ id: 2, number: 2, title: 'b', projectId: 1, favorite: true });
    expect(session.items().map((i) => i.number)).toEqual([1, 2]);
    session.applyToggle({ id: 2, number: 2, title: 'b', projectId: 1, favorite: false });
    expect(session.items().map((i) => i.number)).toEqual([1]);
    session.revertToggle(snap);
    expect(session.items().map((i) => i.number)).toEqual([1]);
  });

  it('skips load when active project is unknown', () => {
    projectSession.activeId.mockReturnValue(null);
    session.loadForActiveProject();
    expect(api.board).not.toHaveBeenCalled();
  });

  it('skips load while project is switching (L-040)', () => {
    projectSession.switching.mockReturnValue(true);
    session.loadForActiveProject();
    expect(api.board).not.toHaveBeenCalled();
  });

  it('clears items when switching becomes true', async () => {
    const { TestBed } = await import('@angular/core/testing');
    session.items.set([{ id: 1, number: 1, title: 'a', projectId: 1, favorite: true }]);
    projectSession.switching.mockReturnValue(true);
    // Re-create so constructor effect re-reads switching.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        FavoritesSession,
        { provide: Api, useValue: api },
        { provide: ProjectSession, useValue: projectSession },
      ],
    });
    const next = TestBed.inject(FavoritesSession);
    expect(next.items()).toEqual([]);
  });
});
