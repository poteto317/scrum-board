import { describe, expect, it } from 'vitest';
import {
  collectUpdatePatch,
  findColumnId,
  patchedItemMatches,
  resolveColumnIdFromBoard,
  resolvedItemId,
} from './item-helpers.js';

describe('collectUpdatePatch', () => {
  it('returns null when only lookup projectId is set', () => {
    expect(collectUpdatePatch({ number: 8, projectId: 1 })).toBeNull();
  });

  it('omits projectId from patch body', () => {
    expect(collectUpdatePatch({ number: 8, projectId: 1, title: 't' })).toEqual({
      title: 't',
    });
  });

  it('includes dueAt null', () => {
    expect(collectUpdatePatch({ number: 8, dueAt: null })).toEqual({ dueAt: null });
  });
});

describe('resolvedItemId', () => {
  it('returns id when number and projectId match', () => {
    expect(resolvedItemId({ id: 99, number: 8, projectId: 1 }, 8, 1)).toBe(99);
  });

  it('returns null when id missing', () => {
    expect(resolvedItemId({ number: 8, projectId: 1 }, 8)).toBeNull();
  });

  it('returns null when data is null', () => {
    expect(resolvedItemId(null, 8)).toBeNull();
  });

  it('returns null when projectId mismatches', () => {
    expect(resolvedItemId({ id: 99, number: 8, projectId: 2 }, 8, 1)).toBeNull();
  });

  it('returns null for non-positive or non-integer ids', () => {
    expect(resolvedItemId({ id: 0, number: 8, projectId: 1 }, 8, 1)).toBeNull();
    expect(resolvedItemId({ id: -1, number: 8, projectId: 1 }, 8, 1)).toBeNull();
    expect(resolvedItemId({ id: 1.5, number: 8, projectId: 1 }, 8, 1)).toBeNull();
    expect(resolvedItemId({ id: Number.NaN, number: 8, projectId: 1 }, 8, 1)).toBeNull();
    expect(resolvedItemId({ id: Number.POSITIVE_INFINITY, number: 8, projectId: 1 }, 8, 1)).toBeNull();
  });
});

describe('patchedItemMatches', () => {
  it('requires same id and number', () => {
    expect(patchedItemMatches({ id: 99, number: 8 }, 99, 8)).toBe(true);
    expect(patchedItemMatches({ id: 100, number: 8 }, 99, 8)).toBe(false);
    expect(patchedItemMatches({ id: 99, number: 9 }, 99, 8)).toBe(false);
    expect(patchedItemMatches(null, 99, 8)).toBe(false);
  });
});

describe('findColumnId', () => {
  it('resolves by exact name', () => {
    expect(findColumnId([{ id: 1, name: 'Todo' }, { id: 2, name: 'Doing' }], 'Doing')).toBe(2);
  });

  it('returns null when missing', () => {
    expect(findColumnId([{ id: 1, name: 'Todo' }], 'Review')).toBeNull();
    expect(findColumnId(undefined, 'Todo')).toBeNull();
  });

  it('ignores non-positive or non-integer column ids', () => {
    expect(findColumnId([{ id: 0, name: 'Todo' }], 'Todo')).toBeNull();
    expect(findColumnId([{ id: -1, name: 'Todo' }], 'Todo')).toBeNull();
    expect(findColumnId([{ id: 1.5, name: 'Todo' }], 'Todo')).toBeNull();
    expect(findColumnId([{ id: Number.NaN, name: 'Todo' }], 'Todo')).toBeNull();
    expect(findColumnId([{ id: Number.POSITIVE_INFINITY, name: 'Todo' }], 'Todo')).toBeNull();
  });
});

describe('resolveColumnIdFromBoard', () => {
  it('reads columns from board body', () => {
    expect(
      resolveColumnIdFromBoard({ columns: [{ id: 2, name: 'Doing' }] }, 'Doing'),
    ).toBe(2);
  });

  it('returns null for null board', () => {
    expect(resolveColumnIdFromBoard(null, 'Todo')).toBeNull();
  });
});
