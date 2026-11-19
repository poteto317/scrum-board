import { describe, expect, it } from 'vitest';
import { isUnauthorized, safeReturnUrl } from './auth';

describe('safeReturnUrl', () => {
  it('allows same-origin relative paths only', () => {
    expect(safeReturnUrl('/')).toBe('/');
    expect(safeReturnUrl('/backlog')).toBe('/backlog');
    expect(safeReturnUrl('/items/1?x=1')).toBe('/items/1?x=1');
    expect(safeReturnUrl('//evil.com')).toBeNull();
    expect(safeReturnUrl('https://evil.com')).toBeNull();
    expect(safeReturnUrl('/login')).toBeNull();
    expect(safeReturnUrl(null)).toBeNull();
  });
});

describe('isUnauthorized', () => {
  it('detects 401 only', () => {
    expect(isUnauthorized({ status: 401 })).toBe(true);
    expect(isUnauthorized({ status: 500 })).toBe(false);
    expect(isUnauthorized(null)).toBe(false);
  });
});
