import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { Column, Item } from './models';
import { ProjectBoardCache } from './project-board-cache';

function item(id: number, projectId: number, columnId = 1): Item {
  return {
    id,
    number: id,
    projectId,
    columnId,
    title: `t${id}`,
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
  };
}

const cols: Column[] = [
  { id: 1, name: 'Todo', position: 0 },
  { id: 2, name: 'Doing', position: 1 },
];

describe('ProjectBoardCache', () => {
  it('putIfAbsent does not clobber existing board cache', () => {
    const cache = new ProjectBoardCache();
    cache.putBoard(2, [item(1, 2)], cols);
    cache.putBoardIfAbsent(2, [item(9, 2)], cols);
    expect(cache.getBoard(2)?.map((i) => i.id)).toEqual([1]);
  });

  it('put overwrites board cache', () => {
    const cache = new ProjectBoardCache();
    cache.putBoard(2, [item(1, 2)], cols);
    cache.putBoard(2, [item(3, 2)], cols);
    expect(cache.getBoard(2)?.map((i) => i.id)).toEqual([3]);
  });

  it('keeps board and backlog caches separate', () => {
    const cache = new ProjectBoardCache();
    cache.putBoard(2, [item(1, 2)], cols);
    cache.putBacklog(2, [item(2, 2)]);
    expect(cache.getBoard(2)?.map((i) => i.id)).toEqual([1]);
    expect(cache.getBacklog(2)?.map((i) => i.id)).toEqual([2]);
  });

  it('stores columns on snapshot and bumps revision', () => {
    const cache = new ProjectBoardCache();
    const before = cache.revision();
    cache.putBoard(2, [item(1, 2, 2)], cols);
    expect(cache.revision()).toBeGreaterThan(before);
    expect(cache.getBoardSnapshot(2)?.columns.map((c) => c.name)).toEqual([
      'Todo',
      'Doing',
    ]);
  });

  it('ignores put with empty columns (not warm)', () => {
    const cache = new ProjectBoardCache();
    cache.putBoard(2, [item(1, 2)], []);
    expect(cache.getBoard(2)).toBeUndefined();
    expect(cache.getBoardSnapshot(2)).toBeUndefined();
  });

  it('keeps warm snapshot when a later put has empty columns (no-op)', () => {
    const cache = new ProjectBoardCache();
    cache.putBoard(2, [item(1, 2)], cols);
    cache.putBoard(2, [item(9, 2)], []);
    expect(cache.getBoard(2)?.map((i) => i.id)).toEqual([1]);
  });

  it('dedupes same-kind prefetch and allows other kind while in flight', () => {
    const cache = new ProjectBoardCache();
    const boardHeld = new Subject<{ items: Item[]; columns: Column[] }>();
    const backlogHeld = new Subject<{ items: Item[] }>();
    const board = vi.fn(() => boardHeld.asObservable());
    const backlog = vi.fn(() => backlogHeld.asObservable());
    const api = { board, backlog } as unknown as Api;

    cache.prefetchBoard(api, 2);
    cache.prefetchBoard(api, 2);
    cache.prefetchBacklog(api, 2);

    expect(board).toHaveBeenCalledTimes(1);
    expect(backlog).toHaveBeenCalledTimes(1);

    boardHeld.next({ items: [item(1, 2)], columns: cols });
    boardHeld.complete();
    backlogHeld.next({ items: [item(2, 2)] });
    backlogHeld.complete();

    expect(cache.getBoard(2)?.[0]?.id).toBe(1);
    expect(cache.getBacklog(2)?.[0]?.id).toBe(2);
  });

  it('prefetchBoard persists columns from API response', () => {
    const cache = new ProjectBoardCache();
    const board = vi.fn(() =>
      of({ items: [item(1, 2, 2)], columns: cols, settings: { cardLayout: 'pack' as const } }),
    );
    cache.prefetchBoard({ board } as unknown as Api, 2);
    expect(cache.getBoardSnapshot(2)?.columns).toEqual(cols);
  });

  it('skips prefetch when cache already warm', () => {
    const cache = new ProjectBoardCache();
    cache.putBoard(2, [item(1, 2)], cols);
    const board = vi.fn(() => of({ items: [item(9, 2)], columns: cols }));
    cache.prefetchBoard({ board } as unknown as Api, 2);
    expect(board).not.toHaveBeenCalled();
  });

  it('re-prefetches when prior response had no columns', () => {
    const cache = new ProjectBoardCache();
    const board = vi
      .fn()
      .mockReturnValueOnce(of({ items: [item(1, 2)] }))
      .mockReturnValueOnce(of({ items: [item(2, 2)], columns: cols }));
    const api = { board } as unknown as Api;
    cache.prefetchBoard(api, 2);
    expect(cache.getBoardSnapshot(2)).toBeUndefined();
    cache.prefetchBoard(api, 2);
    expect(board).toHaveBeenCalledTimes(2);
    expect(cache.getBoardSnapshot(2)?.items[0]?.id).toBe(2);
  });

  it('prefetchOthers skips active id', () => {
    const cache = new ProjectBoardCache();
    const board = vi.fn(() =>
      of({ items: [item(1, 3)], columns: cols, settings: { cardLayout: 'pack' as const } }),
    );
    cache.prefetchOthers({ board, backlog: vi.fn() } as unknown as Api, 1, [1, 3], false);
    expect(board).toHaveBeenCalledTimes(1);
    expect(board).toHaveBeenCalledWith(3);
  });

  it('releases in-flight after HTTP error so another prefetch can run', () => {
    const cache = new ProjectBoardCache();
    const board = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('fail')))
      .mockReturnValueOnce(of({ items: [item(1, 2)], columns: cols }));
    const api = { board } as unknown as Api;
    cache.prefetchBoard(api, 2);
    expect(board).toHaveBeenCalledTimes(1);
    cache.prefetchBoard(api, 2);
    expect(board).toHaveBeenCalledTimes(2);
    expect(cache.getBoard(2)?.[0]?.id).toBe(1);
  });

  it('does not let a late prefetch overwrite a fresher put', () => {
    const cache = new ProjectBoardCache();
    const held = new Subject<{ items: Item[]; columns: Column[] }>();
    const board = vi.fn(() => held.asObservable());
    cache.prefetchBoard({ board } as unknown as Api, 2);
    cache.putBoard(2, [item(5, 2)], cols);
    held.next({ items: [item(1, 2)], columns: cols });
    held.complete();
    expect(cache.getBoard(2)?.map((i) => i.id)).toEqual([5]);
  });

  it('refreshOthers fetches warm boards and updates the snapshot', () => {
    const cache = new ProjectBoardCache();
    cache.putBoard(2, [item(1, 2)], cols);
    const board = vi.fn(() => of({ items: [item(9, 2, 2)], columns: cols }));
    cache.refreshOthers({ board } as unknown as Api, 1, [1, 2]);
    expect(board).toHaveBeenCalledTimes(1);
    expect(board).toHaveBeenCalledWith(2);
    expect(cache.getBoard(2)?.map((i) => i.id)).toEqual([9]);
  });

  it('refreshOthers skips active and non-positive ids', () => {
    const cache = new ProjectBoardCache();
    const board = vi.fn(() => of({ items: [item(1, 3)], columns: cols }));
    cache.refreshOthers({ board } as unknown as Api, 1, [1, 0, -2, Number.NaN, 3]);
    expect(board).toHaveBeenCalledTimes(1);
    expect(board).toHaveBeenCalledWith(3);
  });

  it('keeps the warm snapshot while refresh is in flight', () => {
    const cache = new ProjectBoardCache();
    cache.putBoard(2, [item(1, 2)], cols);
    const held = new Subject<{ items: Item[]; columns: Column[] }>();
    const board = vi.fn(() => held.asObservable());
    cache.refreshOthers({ board } as unknown as Api, 1, [2]);
    expect(cache.getBoard(2)?.map((i) => i.id)).toEqual([1]);
    held.next({ items: [item(9, 2)], columns: cols });
    held.complete();
    expect(cache.getBoard(2)?.map((i) => i.id)).toEqual([9]);
  });

  it('does not let a late refresh overwrite a fresher put', () => {
    const cache = new ProjectBoardCache();
    cache.putBoard(2, [item(1, 2)], cols);
    const held = new Subject<{ items: Item[]; columns: Column[] }>();
    const board = vi.fn(() => held.asObservable());
    cache.refreshOthers({ board } as unknown as Api, 1, [2]);
    cache.putBoard(2, [item(5, 2)], cols);
    held.next({ items: [item(9, 2)], columns: cols });
    held.complete();
    expect(cache.getBoard(2)?.map((i) => i.id)).toEqual([5]);
  });

  it('keeps the warm snapshot when refresh fails', () => {
    const cache = new ProjectBoardCache();
    cache.putBoard(2, [item(1, 2)], cols);
    const board = vi.fn(() => throwError(() => new Error('fail')));
    cache.refreshOthers({ board } as unknown as Api, 1, [2]);
    expect(board).toHaveBeenCalledWith(2);
    expect(cache.getBoard(2)?.map((i) => i.id)).toEqual([1]);
  });

  it('dedupes refreshOthers while the same board key is in flight', () => {
    const cache = new ProjectBoardCache();
    cache.putBoard(2, [item(1, 2)], cols);
    const held = new Subject<{ items: Item[]; columns: Column[] }>();
    const board = vi.fn(() => held.asObservable());
    const api = { board } as unknown as Api;
    cache.refreshOthers(api, 1, [2]);
    cache.refreshOthers(api, 1, [2]);
    expect(board).toHaveBeenCalledTimes(1);
    held.next({ items: [item(9, 2)], columns: cols });
    held.complete();
    expect(cache.getBoard(2)?.map((i) => i.id)).toEqual([9]);
  });

  it('allows refreshOthers again after a failed refresh releases in-flight', () => {
    const cache = new ProjectBoardCache();
    cache.putBoard(2, [item(1, 2)], cols);
    const board = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('fail')))
      .mockReturnValueOnce(of({ items: [item(9, 2)], columns: cols }));
    const api = { board } as unknown as Api;
    cache.refreshOthers(api, 1, [2]);
    expect(cache.getBoard(2)?.map((i) => i.id)).toEqual([1]);
    cache.refreshOthers(api, 1, [2]);
    expect(board).toHaveBeenCalledTimes(2);
    expect(cache.getBoard(2)?.map((i) => i.id)).toEqual([9]);
  });

  it('skips refreshOthers while soft prefetchBoard is in flight for the same id', () => {
    const cache = new ProjectBoardCache();
    const held = new Subject<{ items: Item[]; columns: Column[] }>();
    const board = vi.fn(() => held.asObservable());
    const api = { board } as unknown as Api;
    cache.prefetchBoard(api, 2);
    expect(board).toHaveBeenCalledTimes(1);
    cache.refreshOthers(api, 1, [2]);
    expect(board).toHaveBeenCalledTimes(1);
    held.next({ items: [item(1, 2)], columns: cols });
    held.complete();
    cache.refreshOthers(api, 1, [2]);
    expect(board).toHaveBeenCalledTimes(2);
  });

  it('keeps the warm snapshot when refresh returns empty columns', () => {
    const cache = new ProjectBoardCache();
    cache.putBoard(2, [item(1, 2)], cols);
    const before = cache.revision();
    const board = vi.fn(() => of({ items: [item(9, 2)], columns: [] }));
    cache.refreshOthers({ board } as unknown as Api, 1, [2]);
    expect(cache.getBoard(2)?.map((i) => i.id)).toEqual([1]);
    expect(cache.revision()).toBe(before);
  });

  it('clear drops board and backlog snapshots', () => {
    const cache = new ProjectBoardCache();
    cache.putBoard(2, [item(1, 2)], cols);
    cache.putBacklog(2, [item(2, 2)]);
    cache.clear();
    expect(cache.getBoard(2)).toBeUndefined();
    expect(cache.getBacklog(2)).toBeUndefined();
  });

  it('clear prevents a late prefetch response from repopulating', () => {
    const cache = new ProjectBoardCache();
    const held = new Subject<{ items: Item[]; columns: Column[] }>();
    const board = vi.fn(() => held.asObservable());
    const api = { board } as unknown as Api;
    cache.prefetchBoard(api, 2);
    cache.clear();
    held.next({ items: [item(9, 2)], columns: cols });
    held.complete();
    expect(cache.getBoard(2)).toBeUndefined();
  });
});
