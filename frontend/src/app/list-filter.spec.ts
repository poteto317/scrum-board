import {
  appliedListFilter,
  emptyListFilter,
  itemMatchesFilter,
  listFilterActive,
  normalizeStatusIds,
} from './list-filter';

describe('appliedListFilter / listFilterActive', () => {
  it('normalizes status ids against known columns', () => {
    expect(appliedListFilter({ query: 'x', statusIds: [1, 9] }, [1, 2])).toEqual({
      query: 'x',
      statusIds: [1],
    });
  });
  it('detects active filter', () => {
    expect(listFilterActive(emptyListFilter(), [1, 2])).toBe(false);
    expect(listFilterActive({ query: 'a', statusIds: [] }, [1, 2])).toBe(true);
    expect(listFilterActive({ query: '', statusIds: [1] }, [1, 2])).toBe(true);
    expect(listFilterActive({ query: '', statusIds: [1, 2] }, [1, 2])).toBe(false);
  });
});

describe('normalizeStatusIds', () => {
  it('keeps known ids, drops unknown and duplicates', () => {
    expect(normalizeStatusIds([1, 99, 2, 1], [1, 2, 3])).toEqual([1, 2]);
  });
  it('returns empty when all unknown', () => {
    expect(normalizeStatusIds([9, 8], [1, 2])).toEqual([]);
  });
});

describe('itemMatchesFilter', () => {
  const item = { title: 'Hello World', description: 'Fix Bug', columnId: 2 };

  it('matches title case-insensitively', () => {
    expect(itemMatchesFilter(item, { query: 'hello', statusIds: [] })).toBe(true);
  });
  it('matches description', () => {
    expect(itemMatchesFilter(item, { query: 'bug', statusIds: [] })).toBe(true);
  });
  it('rejects when neither title nor description hits', () => {
    expect(itemMatchesFilter(item, { query: 'zzz', statusIds: [] })).toBe(false);
  });
  it('empty query is no text constraint', () => {
    expect(itemMatchesFilter(item, emptyListFilter())).toBe(true);
  });
  it('statusIds filters by columnId; empty means all', () => {
    expect(itemMatchesFilter(item, { query: '', statusIds: [2] })).toBe(true);
    expect(itemMatchesFilter(item, { query: '', statusIds: [1] })).toBe(false);
    expect(itemMatchesFilter(item, { query: '', statusIds: [] })).toBe(true);
  });
  it('AND of text and status', () => {
    expect(itemMatchesFilter(item, { query: 'hello', statusIds: [2] })).toBe(true);
    expect(itemMatchesFilter(item, { query: 'hello', statusIds: [1] })).toBe(false);
    expect(itemMatchesFilter(item, { query: 'zzz', statusIds: [2] })).toBe(false);
  });
});
