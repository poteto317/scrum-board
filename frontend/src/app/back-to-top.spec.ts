import { describe, expect, it } from 'vitest';
import { backToTopScrollBehavior, isBackToTopVisible } from './back-to-top';

describe('isBackToTopVisible', () => {
  const vh = 800;

  it('is hidden at the top of the page', () => {
    expect(isBackToTopVisible({ scrollY: 0, viewportHeight: vh, focused: false })).toBe(false);
  });

  it('is hidden at exactly half a viewport', () => {
    expect(isBackToTopVisible({ scrollY: 400, viewportHeight: vh, focused: false })).toBe(false);
  });

  it('is shown once scrolled past half a viewport', () => {
    expect(isBackToTopVisible({ scrollY: 401, viewportHeight: vh, focused: false })).toBe(true);
  });

  it('is hidden when the viewport height is unknown (0)', () => {
    expect(isBackToTopVisible({ scrollY: 1000, viewportHeight: 0, focused: false })).toBe(false);
  });

  it('stays shown while focused, even at the top', () => {
    expect(isBackToTopVisible({ scrollY: 0, viewportHeight: vh, focused: true })).toBe(true);
  });
});

describe('backToTopScrollBehavior', () => {
  it('scrolls smoothly by default', () => {
    expect(backToTopScrollBehavior(false)).toBe('smooth');
  });

  it('jumps instantly when reduced motion is preferred', () => {
    expect(backToTopScrollBehavior(true)).toBe('auto');
  });
});
