import { describe, expect, it } from 'vitest';
import { effectivePublicOrigin, normalizePublicOrigin } from './public-origin';

describe('normalizePublicOrigin', () => {
  it('trims space and all trailing slashes', () => {
    expect(normalizePublicOrigin(' https://board.example/ ')).toBe('https://board.example');
    expect(normalizePublicOrigin('https://board.example///')).toBe('https://board.example');
  });

  it('keeps empty strings empty', () => {
    expect(normalizePublicOrigin('')).toBe('');
    expect(normalizePublicOrigin('   ')).toBe('');
  });
});

describe('effectivePublicOrigin', () => {
  it('prefers configured origin over location', () => {
    expect(effectivePublicOrigin('https://cfg', 'http://local')).toBe('https://cfg');
  });

  it('falls back when configured is empty', () => {
    expect(effectivePublicOrigin('', 'http://local')).toBe('http://local');
  });
});