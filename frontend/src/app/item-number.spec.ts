import { describe, expect, it } from 'vitest';
import { formatItemNumber } from './item-number';

describe('formatItemNumber', () => {
  it('pads to three digits with ITEM- prefix', () => {
    expect(formatItemNumber(3)).toBe('ITEM-003');
    expect(formatItemNumber(12)).toBe('ITEM-012');
    expect(formatItemNumber(100)).toBe('ITEM-100');
  });
});
