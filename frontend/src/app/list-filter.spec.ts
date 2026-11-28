import {
  appliedListFilter,
  emptyListFilter,
  itemMatchesFilter,
  listFilterActive,
  normalizeStatusIds,
} from './list-filter';

describe('appliedListFilter / listFilterActive', () => {
  it('normalizes status ids against known columns and keeps labelIds until knownLabelIds loads', () => {
    expect(appliedListFilter({ query: 'x', statusIds: [1, 9], labelIds: [5, 5, 6] }, [1, 2])).toEqual({
      query: 'x',
      statusIds: [1],
      labelIds: [5, 6],
    });
    expect(appliedListFilter({ query: 'x', statusIds: [1], labelIds: [5, 9] }, [1, 2], [5])).toEqual({
      query: 'x',
      statusIds: [1],
      labelIds: [5],
    });
  });
  it('detects active filter including labelIds', () => {
    expect(listFilterActive(emptyListFilter(), [1, 2])).toBe(false);
    expect(listFilterActive({ query: 'a', statusIds: [], labelIds: [] }, [1, 2])).toBe(true);
    expect(listFilterActive({ query: '', statusIds: [1], labelIds: [] }, [1, 2])).toBe(true);
    expect(listFilterActive({ query: '', statusIds: [1, 2], labelIds: [] }, [1, 2])).toBe(false);
    expect(listFilterActive({ query: '', statusIds: [1, 2], labelIds: [10] }, [1, 2])).toBe(true);
    expect(listFilterActive({ query: '', statusIds: [1, 2], labelIds: [999] }, [1, 2], [10])).toBe(false);
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
  const item = {
    title: 'Hello World',
    description: 'Fix Bug',
    columnId: 2,
    labels: [
      { id: 10, name: 'bug', color: '#ef4444' },
      { id: 20, name: 'api', color: '#3b82f6' },
    ],
  };

  it('matches title case-insensitively', () => {
    expect(itemMatchesFilter(item, { query: 'hello', statusIds: [], labelIds: [] })).toBe(true);
  });
  it('matches description', () => {
    expect(itemMatchesFilter(item, { query: 'bug', statusIds: [], labelIds: [] })).toBe(true);
  });
  it('rejects when neither title nor description hits', () => {
    expect(itemMatchesFilter(item, { query: 'zzz', statusIds: [], labelIds: [] })).toBe(false);
  });
  it('empty query is no text constraint', () => {
    expect(itemMatchesFilter(item, emptyListFilter())).toBe(true);
  });
  it('statusIds filters by columnId; empty means all', () => {
    expect(itemMatchesFilter(item, { query: '', statusIds: [2], labelIds: [] })).toBe(true);
    expect(itemMatchesFilter(item, { query: '', statusIds: [1], labelIds: [] })).toBe(false);
    expect(itemMatchesFilter(item, { query: '', statusIds: [], labelIds: [] })).toBe(true);
  });
  it('AND of text, status, and multiple labels', () => {
    expect(itemMatchesFilter(item, { query: 'hello', statusIds: [2], labelIds: [10, 20] })).toBe(true);
    expect(itemMatchesFilter(item, { query: 'hello', statusIds: [2], labelIds: [10, 30] })).toBe(false);
    expect(itemMatchesFilter(item, { query: 'hello', statusIds: [1], labelIds: [10] })).toBe(false);
    expect(itemMatchesFilter(item, { query: 'zzz', statusIds: [2], labelIds: [10] })).toBe(false);
  });
});
