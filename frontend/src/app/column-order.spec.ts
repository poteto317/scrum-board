import { describe, it, expect } from 'vitest';
import {
  computeAutoScrollDelta,
  computeDropSlot,
  moveColumn,
  targetColumnIndex,
} from './column-order';
import { Column } from './models';

const cols: Column[] = [
  { id: 1, name: 'Todo', position: 0 },
  { id: 2, name: 'Doing', position: 1 },
  { id: 3, name: 'Done', position: 2 },
  { id: 9, name: 'Review', position: 3 },
];

describe('column-order helpers', () => {
  it('computes insertion boundary slot relative to column midpoints', () => {
    const bounds = [
      { left: 0, width: 300 }, // midpoint 150
      { left: 320, width: 300 }, // midpoint 470
      { left: 640, width: 300 }, // midpoint 790
    ];
    expect(computeDropSlot(50, bounds)).toBe(0);
    expect(computeDropSlot(149, bounds)).toBe(0);
    expect(computeDropSlot(151, bounds)).toBe(1);
    expect(computeDropSlot(310, bounds)).toBe(1); // inside 20px gap between col 0 and 1
    expect(computeDropSlot(469, bounds)).toBe(1);
    expect(computeDropSlot(471, bounds)).toBe(2);
    expect(computeDropSlot(950, bounds)).toBe(3);
    expect(computeDropSlot(100, [])).toBe(0);
  });

  it('guards bounds and detects no-op drop slots', () => {
    expect(targetColumnIndex(-1, 2, 4)).toBeNull();
    expect(targetColumnIndex(4, 2, 4)).toBeNull();
    expect(targetColumnIndex(1, -1, 4)).toBeNull();
    expect(targetColumnIndex(1, 5, 4)).toBeNull();
    // Moving column 1 to slot 1 or slot 2 stays at index 1 (no-op)
    expect(targetColumnIndex(1, 1, 4)).toBeNull();
    expect(targetColumnIndex(1, 2, 4)).toBeNull();
    // Moving column 3 (Review) before column 2 (Done, slot 2) -> index 2
    expect(targetColumnIndex(3, 2, 4)).toBe(2);
    // Moving column 0 (Todo) after column 2 (Done, slot 3) -> index 2
    expect(targetColumnIndex(0, 3, 4)).toBe(2);
  });

  it('moves column immutably and reassigns contiguous positions', () => {
    const moved = moveColumn(cols, 3, 2);
    expect(moved.map((c) => c.id)).toEqual([1, 2, 9, 3]);
    expect(moved.map((c) => c.position)).toEqual([0, 1, 2, 3]);
    // Original array remains untouched
    expect(cols.map((c) => c.id)).toEqual([1, 2, 3, 9]);
    // Invalid indices return original order without mutation
    expect(moveColumn(cols, 1, 1)).toBe(cols);
    expect(moveColumn(cols, -1, 2)).toBe(cols);
    expect(moveColumn(cols, 1, 4)).toBe(cols);
  });

  it('computes horizontal auto-scroll deltas only within 48px container edges', () => {
    expect(computeAutoScrollDelta(110, 100, 900)).toBeLessThan(0);
    expect(computeAutoScrollDelta(147, 100, 900)).toBeLessThan(0);
    expect(computeAutoScrollDelta(148, 100, 900)).toBe(0);
    expect(computeAutoScrollDelta(500, 100, 900)).toBe(0);
    expect(computeAutoScrollDelta(852, 100, 900)).toBe(0);
    expect(computeAutoScrollDelta(853, 100, 900)).toBeGreaterThan(0);
    expect(computeAutoScrollDelta(895, 100, 900)).toBeGreaterThan(0);
  });
});
