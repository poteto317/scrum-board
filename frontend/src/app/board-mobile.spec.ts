import {
  applyBoardMobileSettings,
  BOARD_MOBILE_MAX_PX,
  boardMobileMediaQuery,
  fallbackMobileColumnId,
  resolveMobileColumnId,
  visibleMobileColumns,
  withResolvedMobileColumnId,
} from './board-mobile';

describe('board-mobile', () => {
  const cols = [
    { id: 2, name: 'Doing', position: 0 },
    { id: 1, name: 'Todo', position: 1 },
  ];

  it('exposes 700px media query', () => {
    expect(BOARD_MOBILE_MAX_PX).toBe(700);
    expect(boardMobileMediaQuery()).toBe('(max-width: 700px)');
  });

  it('falls back to Todo then position/id', () => {
    expect(fallbackMobileColumnId(cols)).toBe(1);
    expect(
      fallbackMobileColumnId([
        { id: 5, name: 'A', position: 1 },
        { id: 3, name: 'B', position: 1 },
        { id: 4, name: 'C', position: 2 },
      ]),
    ).toBe(3);
    expect(fallbackMobileColumnId([])).toBe(0);
  });

  it('resolves saved id or falls back', () => {
    expect(resolveMobileColumnId(2, cols)).toBe(2);
    expect(resolveMobileColumnId(99, cols)).toBe(1);
    expect(resolveMobileColumnId(undefined, cols)).toBe(1);
    expect(resolveMobileColumnId(0, cols)).toBe(1);
  });

  it('applyBoardMobileSettings resolves invalid saved id', () => {
    const board = applyBoardMobileSettings({
      columns: cols,
      items: [],
      settings: { cardLayout: 'pack', mobileBoardColumnId: 99 },
    });
    expect(board.settings.mobileBoardColumnId).toBe(1);
  });

  it('withResolvedMobileColumnId and visibleMobileColumns', () => {
    const data = applyBoardMobileSettings({
      columns: cols,
      items: [],
      settings: { cardLayout: 'pack', mobileBoardColumnId: 2 },
    });
    expect(withResolvedMobileColumnId(data)).toBe(data);
    expect(visibleMobileColumns(cols, false, 2)).toEqual(cols);
    expect(visibleMobileColumns(cols, true, 2)).toEqual([cols[0]]);
    expect(visibleMobileColumns(cols, true, 99)).toEqual([]);
  });
});

