import { describe, expect, it, vi } from 'vitest';
import { applyBoardDataWithActiveSync } from './board-active-sync';
import { normalizeBoardData } from './board-data';

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
});
