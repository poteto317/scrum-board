import { describe, expect, it } from 'vitest';
import {
  affectedColumnIds,
  applyCardDrop,
  buildCardOrderPayload,
  CARD_DRAG_THRESHOLD_PX,
  columnIdFromDropListId,
  dragExceededThreshold,
  dropListIdForColumn,
} from './card-order';
import { Card } from './models';

function card(id: number, columnId: number, position: number): Card {
  return {
    id,
    number: id,
    columnId,
    title: `c${id}`,
    description: '',
    position,
    prUrl: '',
    createdAt: '',
    updatedAt: '',
  };
}

describe('card-order helpers', () => {
  it('detects drag distance against the 8px threshold', () => {
    expect(dragExceededThreshold(0, 0)).toBe(false);
    expect(dragExceededThreshold(7, 0)).toBe(false);
    expect(dragExceededThreshold(8, 0)).toBe(true);
    expect(dragExceededThreshold(0, CARD_DRAG_THRESHOLD_PX)).toBe(true);
  });

  it('round-trips drop list ids and affected columns', () => {
    expect(dropListIdForColumn(9)).toBe('card-list-9');
    expect(columnIdFromDropListId('card-list-9')).toBe(9);
    expect(columnIdFromDropListId('other')).toBeNull();
    expect(affectedColumnIds(1, 1)).toEqual([1]);
    expect(affectedColumnIds(1, 2)).toEqual([1, 2]);
  });

  it('reorders within a column and builds a single-column payload', () => {
    const cards = [card(1, 1, 0), card(2, 1, 1), card(3, 2, 0)];
    const next = applyCardDrop(cards, 1, 1, 0, 1);
    expect(next?.map((c) => [c.id, c.columnId, c.position])).toEqual([
      [3, 2, 0],
      [2, 1, 0],
      [1, 1, 1],
    ]);
    expect(buildCardOrderPayload(next!, [1])).toEqual([{ columnId: 1, cardIds: [2, 1] }]);
  });

  it('moves across columns and returns null for no-op / bad indexes', () => {
    const cards = [card(1, 1, 0), card(2, 1, 1), card(3, 2, 0)];
    const next = applyCardDrop(cards, 1, 2, 0, 1);
    expect(next?.filter((c) => c.columnId === 1).map((c) => c.id)).toEqual([2]);
    expect(next?.filter((c) => c.columnId === 2).map((c) => c.id)).toEqual([3, 1]);
    expect(buildCardOrderPayload(next!, [1, 2])).toEqual([
      { columnId: 1, cardIds: [2] },
      { columnId: 2, cardIds: [3, 1] },
    ]);
    expect(applyCardDrop(cards, 1, 1, 0, 0)).toBeNull();
    expect(applyCardDrop(cards, 1, 1, -1, 0)).toBeNull();
    expect(applyCardDrop(cards, 1, 2, 0, 99)).toBeNull();
  });
});
