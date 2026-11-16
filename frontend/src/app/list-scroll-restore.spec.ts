import { describe, expect, it } from 'vitest';
import {
  clampNonNegative,
  scrollPositionsDiffer,
  scrollRestoreBaselineMoved,
} from './list-scroll-restore';

describe('scrollPositionsDiffer', () => {
  it('uses epsilon of 1 by default', () => {
    expect(scrollPositionsDiffer(10, 10.4)).toBe(false);
    expect(scrollPositionsDiffer(10, 12)).toBe(true);
  });
});

describe('clampNonNegative', () => {
  it('clamps negatives to 0', () => {
    expect(clampNonNegative(-3)).toBe(0);
    expect(clampNonNegative(5)).toBe(5);
  });
});

describe('scrollRestoreBaselineMoved', () => {
  it('is false when present currents match baseline within epsilon', () => {
    expect(scrollRestoreBaselineMoved([0, 0], [0, 0.4])).toBe(false);
  });

  it('is true when a present current differs', () => {
    expect(scrollRestoreBaselineMoved([0, 0], [10, 0])).toBe(true);
  });

  it('skips null current slots', () => {
    expect(scrollRestoreBaselineMoved([0, 0], [null, 0])).toBe(false);
    expect(scrollRestoreBaselineMoved([0, 0], [null, 5])).toBe(true);
  });
});
