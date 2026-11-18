import { describe, expect, it } from 'vitest';
import {
  CARD_LIST_MIN_HEIGHT_PX,
  computeFreeOffsetY,
  freeListMinHeightPx,
  measureCardOffsetY,
} from './board-layout-y';
import { Item } from './models';

function card(id: number, columnId: number, position: number, offsetY = 0): Item {
  return {
    id,
    projectId: 1,
    number: id,
    columnId,
    title: `c${id}`,
    description: '',
    position,
    backlogPosition: position,
    offsetY,
    prUrls: [],
    relatedItems: [],
    assignee: '',
    closeReason: '',
    solution: '',
    favorite: false,
    dueAt: null,
    createdAt: '',
    updatedAt: '',
  };
}

describe('computeFreeOffsetY', () => {
  it('returns the card top Y from pointer, grab offset, list top and scroll', () => {
    expect(
      computeFreeOffsetY({
        listTop: 100,
        pointerY: 250,
        grabOffsetY: 20,
        scrollTop: 0,
      }),
    ).toBe(130);
  });

  it('includes list scrollTop', () => {
    expect(
      computeFreeOffsetY({
        listTop: 100,
        pointerY: 250,
        grabOffsetY: 20,
        scrollTop: 40,
      }),
    ).toBe(170);
  });

  it('rounds to an integer', () => {
    expect(
      computeFreeOffsetY({
        listTop: 100.2,
        pointerY: 250.6,
        grabOffsetY: 20.1,
        scrollTop: 0,
      }),
    ).toBe(130);
  });

  it('clamps negative results to 0', () => {
    expect(
      computeFreeOffsetY({
        listTop: 200,
        pointerY: 150,
        grabOffsetY: 30,
        scrollTop: 0,
      }),
    ).toBe(0);
  });
});

describe('measureCardOffsetY', () => {
  it('measures pack layout tops relative to the list', () => {
    expect(measureCardOffsetY(80, 120, 0)).toBe(40);
    expect(measureCardOffsetY(80, 120, 10)).toBe(50);
  });

  it('clamps below the list top to 0', () => {
    expect(measureCardOffsetY(100, 90, 0)).toBe(0);
  });
});

describe('freeListMinHeightPx', () => {
  it('computes free list min-height from bottoms and the 72px floor', () => {
    const heights = new Map<number, number>([
      [1, 50],
      [2, 40],
    ]);
    expect(freeListMinHeightPx([card(1, 1, 0, 10), card(2, 1, 1, 100)], heights)).toBe(140);
    expect(freeListMinHeightPx([], heights)).toBe(CARD_LIST_MIN_HEIGHT_PX);
  });
});
