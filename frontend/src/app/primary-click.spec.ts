import { describe, expect, it } from 'vitest';
import { isUnmodifiedPrimaryClick } from './primary-click';

describe('isUnmodifiedPrimaryClick', () => {
  it('accepts unmodified primary clicks only', () => {
    expect(isUnmodifiedPrimaryClick(new MouseEvent('click', { button: 0 }))).toBe(true);
    expect(isUnmodifiedPrimaryClick(new MouseEvent('click', { button: 0, ctrlKey: true }))).toBe(
      false,
    );
    expect(isUnmodifiedPrimaryClick(new MouseEvent('click', { button: 0, metaKey: true }))).toBe(
      false,
    );
    expect(isUnmodifiedPrimaryClick(new MouseEvent('click', { button: 0, shiftKey: true }))).toBe(
      false,
    );
    expect(isUnmodifiedPrimaryClick(new MouseEvent('click', { button: 0, altKey: true }))).toBe(
      false,
    );
    expect(isUnmodifiedPrimaryClick(new MouseEvent('click', { button: 1 }))).toBe(false);
  });
});
