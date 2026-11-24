import { describe, expect, it, vi } from 'vitest';
import { applyBoardDataWithActiveSync } from './board-active-sync';
import { normalizeBoardData, normalizeBoardMeta } from './board-data';

describe('applyBoardDataWithActiveSync', () => {
  it('syncs active project then applies board', () => {
    const syncActiveFromBoard = vi.fn();
    const apply = vi.fn();
    const board = normalizeBoardData({
      columns: [],
      items: [],
      settings: { cardLayout: 'pack', activeProjectId: 3 },
    });
    applyBoardDataWithActiveSync({ syncActiveFromBoard }, board, apply);
    expect(syncActiveFromBoard).toHaveBeenCalledWith(3, false);
    expect(apply).toHaveBeenCalledWith(board);
    expect(syncActiveFromBoard.mock.invocationCallOrder[0]).toBeLessThan(
      apply.mock.invocationCallOrder[0],
    );
  });

  it('also accepts a board meta (no items) and syncs the active project', () => {
    const syncActiveFromBoard = vi.fn();
    const apply = vi.fn();
    const meta = normalizeBoardMeta({
      columns: [{ id: 1, name: 'Todo', position: 0 }],
      settings: { cardLayout: 'pack', activeProjectId: 5 },
    });
    applyBoardDataWithActiveSync({ syncActiveFromBoard }, meta, apply);
    expect(syncActiveFromBoard).toHaveBeenCalledWith(5, false);
    expect(apply).toHaveBeenCalledWith(meta);
  });
});
