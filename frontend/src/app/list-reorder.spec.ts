import { describe, expect, it } from 'vitest';
import { moveIndex } from './list-reorder';

describe('moveIndex', () => {
  it('returns the same reference when from === to', () => {
    const items = ['a', 'b', 'c'];
    expect(moveIndex(items, 1, 1)).toBe(items);
  });

  it('returns the same reference when indexes are out of range', () => {
    const items = ['a', 'b'];
    expect(moveIndex(items, -1, 0)).toBe(items);
    expect(moveIndex(items, 0, 2)).toBe(items);
    expect(moveIndex(items, 2, 0)).toBe(items);
  });

  it('moves an item without mutating the source', () => {
    const items = ['a', 'b', 'c'];
    expect(moveIndex(items, 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveIndex(items, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(items).toEqual(['a', 'b', 'c']);
  });
});
