import { describe, expect, it } from 'vitest';
import {
  affectedColumnIds,
  applyCardDrop,
  buildCardOrderPayload,
  columnIdFromDropListId,
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
    backlogPosition: position,
    prUrls: [],
    assignee: '',
    createdAt: '',
    updatedAt: '',
  };
}

describe('card-order helpers', () => {
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

  // Ids are creation order and positions are the board order; they only differ once cards have been
  // moved, so a sort by id (or no sort) must not pass for the sort by position.
  it('orders a column by position, not by id, when moving within it', () => {
    const cards = [card(1, 1, 20), card(2, 1, 10), card(3, 1, 0), card(4, 2, 0)];
    // Board order of column 1 is 3, 2, 1.
    const next = applyCardDrop(cards, 1, 1, 0, 1);
    expect(next?.filter((c) => c.columnId === 1).map((c) => [c.id, c.position])).toEqual([
      [2, 0],
      [3, 1],
      [1, 2],
    ]);
    expect(buildCardOrderPayload(next!, [1])).toEqual([{ columnId: 1, cardIds: [2, 3, 1] }]);
  });

  it('orders both columns by position, not by id, when moving across them', () => {
    const cards = [
      card(1, 1, 20), // column 1 reads 3, 2, 1
      card(2, 1, 10),
      card(3, 1, 0),
      card(4, 2, 50), // column 2 reads 6, 5, 4
      card(5, 2, 30),
      card(6, 2, 7),
    ];
    // Card 3 is first in column 1; dropped second in column 2 it lands between 6 and 5.
    const next = applyCardDrop(cards, 1, 2, 0, 1);
    expect(next?.filter((c) => c.columnId === 1).map((c) => c.id)).toEqual([2, 1]);
    expect(next?.filter((c) => c.columnId === 2).map((c) => c.id)).toEqual([6, 3, 5, 4]);
    expect(buildCardOrderPayload(next!, [1, 2])).toEqual([
      { columnId: 1, cardIds: [2, 1] },
      { columnId: 2, cardIds: [6, 3, 5, 4] },
    ]);
    // The index is a place in the position order: index 1 of column 1 is card 2, not card 2 by id.
    const second = applyCardDrop(cards, 1, 2, 1, 0);
    expect(second?.filter((c) => c.columnId === 2).map((c) => c.id)).toEqual([2, 6, 5, 4]);
    expect(second?.filter((c) => c.columnId === 1).map((c) => c.id)).toEqual([3, 1]);
  });

  it('builds the payload in position order even when it differs from id order', () => {
    const cards = [card(1, 1, 9), card(2, 1, 4), card(3, 1, 6)];
    expect(buildCardOrderPayload(cards, [1])).toEqual([{ columnId: 1, cardIds: [2, 3, 1] }]);
  });
});
