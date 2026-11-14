import { describe, expect, it } from 'vitest';
import { autoScrollPageVertically, pageScrollElement } from './page-scroll';

describe('pageScrollElement', () => {
  it('prefers scrollingElement over documentElement', () => {
    const scrolling = document.createElement('div');
    const doc = {
      scrollingElement: scrolling,
      documentElement: document.documentElement,
    };
    expect(pageScrollElement(doc)).toBe(scrolling);
  });

  it('falls back to documentElement when scrollingElement is null', () => {
    const doc = {
      scrollingElement: null,
      documentElement: document.documentElement,
    };
    expect(pageScrollElement(doc)).toBe(document.documentElement);
  });
});

describe('autoScrollPageVertically', () => {
  it('increases scrollTop near the bottom edge', () => {
    const page = { scrollTop: 10 };
    autoScrollPageVertically(page, 995, 1000);
    expect(page.scrollTop).toBeGreaterThan(10);
  });

  it('decreases scrollTop near the top edge', () => {
    const page = { scrollTop: 40 };
    autoScrollPageVertically(page, 5, 1000);
    expect(page.scrollTop).toBeLessThan(40);
  });

  it('does nothing away from the edges or without a page', () => {
    const page = { scrollTop: 20 };
    autoScrollPageVertically(page, 500, 1000);
    expect(page.scrollTop).toBe(20);
    autoScrollPageVertically(null, 5, 1000);
  });
});
