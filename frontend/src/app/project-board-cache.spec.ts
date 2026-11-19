import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { Item } from './models';
import { ProjectBoardCache } from './project-board-cache';

function item(id: number, projectId: number): Item {
  return {
    id,
    number: id,
    projectId,
    columnId: 1,
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

describe('ProjectBoardCache', () => {
  it('putIfAbsent does not clobber existing board cache', () => {
    const cache = new ProjectBoardCache();
    cache.putBoard(2, [item(1, 2)]);
    cache.putBoardIfAbsent(2, [item(9, 2)]);
    expect(cache.getBoard(2)?.map((i) => i.id)).toEqual([1]);
  });

  it('put overwrites board cache', () => {
    const cache = new ProjectBoardCache();
    cache.putBoard(2, [item(1, 2)]);
    cache.putBoard(2, [item(3, 2)]);
    expect(cache.getBoard(2)?.map((i) => i.id)).toEqual([3]);
  });

  it('keeps board and backlog caches separate', () => {
    const cache = new ProjectBoardCache();
    cache.putBoard(2, [item(1, 2)]);
    cache.putBacklog(2, [item(2, 2)]);
    expect(cache.getBoard(2)?.map((i) => i.id)).toEqual([1]);
    expect(cache.getBacklog(2)?.map((i) => i.id)).toEqual([2]);
  });

  it('dedupes same-kind prefetch and allows other kind while in flight', () => {
    const cache = new ProjectBoardCache();
    const boardHeld = new Subject<{ items: Item[] }>();
    const backlogHeld = new Subject<{ items: Item[] }>();
    const board = vi.fn(() => boardHeld.asObservable());
    const backlog = vi.fn(() => backlogHeld.asObservable());
    const api = { board, backlog } as unknown as Api;

    cache.prefetchBoard(api, 2);
    cache.prefetchBoard(api, 2);
    cache.prefetchBacklog(api, 2);

    expect(board).toHaveBeenCalledTimes(1);
    expect(backlog).toHaveBeenCalledTimes(1);

    boardHeld.next({ items: [item(1, 2)] });
    boardHeld.complete();
    backlogHeld.next({ items: [item(2, 2)] });
    backlogHeld.complete();

    expect(cache.getBoard(2)?.[0]?.id).toBe(1);
    expect(cache.getBacklog(2)?.[0]?.id).toBe(2);
  });

  it('skips prefetch when cache already warm', () => {
    const cache = new ProjectBoardCache();
    cache.putBoard(2, [item(1, 2)]);
    const board = vi.fn(() => of({ items: [item(9, 2)] }));
    cache.prefetchBoard({ board } as unknown as Api, 2);
    expect(board).not.toHaveBeenCalled();
  });

  it('prefetchOthers skips active id', () => {
    const cache = new ProjectBoardCache();
    const board = vi.fn(() => of({ items: [item(1, 3)], columns: [], settings: { cardLayout: 'pack' as const } }));
    cache.prefetchOthers({ board, backlog: vi.fn() } as unknown as Api, 1, [1, 3], false);
    expect(board).toHaveBeenCalledTimes(1);
    expect(board).toHaveBeenCalledWith(3);
  });

  it('releases in-flight after HTTP error so another prefetch can run', () => {
    const cache = new ProjectBoardCache();
    const board = vi
      .fn()
      .mockReturnValueOnce(throwError(() => new Error('fail')))
      .mockReturnValueOnce(of({ items: [item(1, 2)] }));
    const api = { board } as unknown as Api;
    cache.prefetchBoard(api, 2);
    expect(board).toHaveBeenCalledTimes(1);
    cache.prefetchBoard(api, 2);
    expect(board).toHaveBeenCalledTimes(2);
    expect(cache.getBoard(2)?.[0]?.id).toBe(1);
  });

  it('does not let a late prefetch overwrite a fresher put', () => {
    const cache = new ProjectBoardCache();
    const held = new Subject<{ items: Item[] }>();
    const board = vi.fn(() => held.asObservable());
    cache.prefetchBoard({ board } as unknown as Api, 2);
    cache.putBoard(2, [item(5, 2)]);
    held.next({ items: [item(1, 2)] });
    held.complete();
    expect(cache.getBoard(2)?.map((i) => i.id)).toEqual([5]);
  });
});
