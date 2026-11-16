import { describe, expect, it } from 'vitest';
import { alignPrTitles, fallbackPrLabel, prDisplayLabel } from './pr-display';

describe('fallbackPrLabel', () => {
  it('returns owner/repo#n for valid PR URLs', () => {
    expect(fallbackPrLabel('https://github.com/a/b/pull/12')).toBe('a/b#12');
  });

  it('does not return the full URL for invalid input', () => {
    const bad = 'https://example.com/x';
    expect(fallbackPrLabel(bad)).toBe('#');
    expect(fallbackPrLabel(bad)).not.toBe(bad);
  });
});

describe('prDisplayLabel', () => {
  it('prefers API title then fallback', () => {
    const url = 'https://github.com/a/b/pull/1';
    expect(prDisplayLabel(url, ['Feat'], 0)).toBe('Feat');
    expect(prDisplayLabel(url, ['  '], 0)).toBe('a/b#1');
    expect(prDisplayLabel(url, undefined, 0)).toBe('a/b#1');
  });
});

describe('alignPrTitles', () => {
  it('keeps titles with reordered urls', () => {
    const u1 = 'https://github.com/a/b/pull/1';
    const u2 = 'https://github.com/a/b/pull/2';
    expect(alignPrTitles([u1, u2], ['One', 'Two'], [u2, u1])).toEqual(['Two', 'One']);
  });

  it('falls back for newly added urls', () => {
    const u1 = 'https://github.com/a/b/pull/1';
    const u2 = 'https://github.com/a/b/pull/2';
    expect(alignPrTitles([u1], ['One'], [u1, u2])).toEqual(['One', 'a/b#2']);
  });
});
