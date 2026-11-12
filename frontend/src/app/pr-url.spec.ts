import { describe, it, expect } from 'vitest';
import { validPrUrl } from './pr-url';

describe('GitHub PR URL', () => {
  it('accepts an optional canonical PR URL and trims surrounding whitespace', () => {
    for (const value of [
      '',
      '  ',
      'https://github.com/poteto317/scrum-board/pull/2',
      '  https://github.com/a/b.c_d-e/pull/123  ',
    ]) {
      expect(validPrUrl(value), value).toBe(true);
    }
  });
  it('rejects alternate targets and malformed PR paths', () => {
    for (const value of [
      'javascript:alert(1)',
      'http://github.com/a/b/pull/1',
      'https://github.com.evil/a/b/pull/1',
      'https://user@github.com/a/b/pull/1',
      'https://github.com:443/a/b/pull/1',
      'https://github.com/a/b/pull/0',
      'https://github.com/a/b/pull/01',
      'https://github.com/a/b/pull/1/',
      'https://github.com/a/b/pull/1?x=1',
      'https://github.com/a/b/pull/1#x',
      'https://github.com/a/../pull/1',
      'https://github.com/./b/pull/1',
      'https://github.com/a/b/pull/1\nextra',
      'https://github.com/a/\\b/pull/1',
      'https://github.com/a/b/pull/1\tmore',
      'https://github.com/a/%62/pull/1',
      'x'.repeat(2049),
    ])
      expect(validPrUrl(value), value).toBe(false);
  });
});
