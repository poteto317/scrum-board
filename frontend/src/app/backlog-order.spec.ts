import { describe, it, expect } from 'vitest';
import { computeAutoScrollDelta, computeDropSlot, moveItem, targetIndex } from './backlog-order';
import { Item } from './models';

const items: Item[] = [
  {
    id: 1,
    number: 1,
    columnId: 1,
    title: 'A',
    description: '',
    prUrls: [],
    relatedItems: [],
        position: 0,
assignee: '',
closeReason: '',
    backlogPosition: 0,
    offsetY: 0,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 2,
    number: 2,
    columnId: 1,
    title: 'B',
    description: '',
    prUrls: [],
    relatedItems: [],
        position: 1,
assignee: '',
closeReason: '',
    backlogPosition: 1,
    offsetY: 0,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 3,
    number: 3,
    columnId: 2,
    title: 'C',
    description: '',
    prUrls: [],
    relatedItems: [],
        position: 2,
assignee: '',
closeReason: '',
    backlogPosition: 2,
    offsetY: 0,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 9,
    number: 9,
    columnId: 3,
    title: 'D',
    description: '',
    prUrls: [],
    relatedItems: [],
        position: 3,
assignee: '',
closeReason: '',
    backlogPosition: 3,
    offsetY: 0,
    createdAt: '',
    updatedAt: '',
  },
];

describe('backlog-order helpers', () => {
  it('computes insertion boundary slot relative to row midpoints', () => {
    const bounds = [
      { top: 0, height: 60 }, // midpoint 30
      { top: 70, height: 60 }, // midpoint 100
      { top: 140, height: 60 }, // midpoint 170
    ];
    expect(computeDropSlot(10, bounds)).toBe(0);
    expect(computeDropSlot(29, bounds)).toBe(0);
    expect(computeDropSlot(31, bounds)).toBe(1);
    expect(computeDropSlot(65, bounds)).toBe(1);
    expect(computeDropSlot(99, bounds)).toBe(1);
    expect(computeDropSlot(101, bounds)).toBe(2);
    expect(computeDropSlot(250, bounds)).toBe(3);
    expect(computeDropSlot(10, [])).toBe(0);
  });

  it('guards bounds and detects no-op drop slots', () => {
    expect(targetIndex(-1, 2, 4)).toBeNull();
    expect(targetIndex(4, 2, 4)).toBeNull();
    expect(targetIndex(1, -1, 4)).toBeNull();
    expect(targetIndex(1, 5, 4)).toBeNull();
    expect(targetIndex(1, 1, 4)).toBeNull();
    expect(targetIndex(1, 2, 4)).toBeNull();
    expect(targetIndex(3, 2, 4)).toBe(2);
    expect(targetIndex(0, 3, 4)).toBe(2);
  });

  it('moves card immutably and reassigns contiguous backlog positions', () => {
    const moved = moveItem(items, 3, 2);
    expect(moved.map((c) => c.id)).toEqual([1, 2, 9, 3]);
    expect(moved.map((c) => c.backlogPosition)).toEqual([0, 1, 2, 3]);
    expect(items.map((c) => c.id)).toEqual([1, 2, 3, 9]);
    expect(moveItem(items, 1, 1)).toBe(items);
    expect(moveItem(items, -1, 2)).toBe(items);
    expect(moveItem(items, 1, 4)).toBe(items);
  });

  it('computes vertical auto-scroll deltas only within 48px container edges', () => {
    expect(computeAutoScrollDelta(110, 100, 900)).toBeLessThan(0);
    expect(computeAutoScrollDelta(147, 100, 900)).toBeLessThan(0);
    expect(computeAutoScrollDelta(148, 100, 900)).toBe(0);
    expect(computeAutoScrollDelta(500, 100, 900)).toBe(0);
    expect(computeAutoScrollDelta(852, 100, 900)).toBe(0);
    expect(computeAutoScrollDelta(853, 100, 900)).toBeGreaterThan(0);
    expect(computeAutoScrollDelta(895, 100, 900)).toBeGreaterThan(0);
  });
});
