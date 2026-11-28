import { describe, expect, it } from 'vitest';
import { MAX_CLOSE_REASON_LEN, mergeCloseTransitionItem, normalizeCloseReason } from './close-reason';
import { Item } from './models';

const base: Item = {
  id: 1,
  projectId: 0,
  number: 1,
  columnId: 1,
  title: 't',
  description: '',
  position: 0,
  backlogPosition: 0,
  offsetY: 0,
  prUrls: ['https://github.com/a/b/pull/1'],
  relatedItems: [],
  assignee: 'Cursor',
  closeReason: '',
  solution: '',
  favorite: false,
  dueAt: null,
  createdAt: '',
  updatedAt: '',
};

describe('normalizeCloseReason', () => {
  it('trims and allows empty', () => {
    expect(normalizeCloseReason('  x  ')).toBe('x');
    expect(normalizeCloseReason('')).toBe('');
    expect(normalizeCloseReason('   ')).toBe('');
  });
  it('rejects over max Unicode length', () => {
    expect(normalizeCloseReason('あ'.repeat(MAX_CLOSE_REASON_LEN))).toBe('あ'.repeat(MAX_CLOSE_REASON_LEN));
    expect(normalizeCloseReason('あ'.repeat(MAX_CLOSE_REASON_LEN + 1))).toBeNull();
  });
});

describe('mergeCloseTransitionItem', () => {
  it('keeps local side fields when response omits them', () => {
    const updated = {
      ...base,
      columnId: 3,
      closeReason: 'done',
      solution: '',
      favorite: false,
      dueAt: null,
      prUrls: undefined as unknown as string[],
      assignee: undefined as unknown as string,
    };
    const merged = mergeCloseTransitionItem(
      { ...base, labels: [{ id: 1, name: 'Bug', color: '#ef4444' }] },
      updated as Item,
    );
    expect(merged.columnId).toBe(3);
    expect(merged.closeReason).toBe('done');
    expect(merged.prUrls).toEqual(base.prUrls);
    expect(merged.assignee).toBe('Cursor');
    expect(merged.labels).toEqual([{ id: 1, name: 'Bug', color: '#ef4444' }]);
  });
});
