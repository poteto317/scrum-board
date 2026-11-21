import { describe, expect, it } from 'vitest';
import { parseLimitTokens } from './ai-credits-limit-parse';

describe('parseLimitTokens', () => {
  it('parses non-negative integers only', () => {
    expect(parseLimitTokens('0')).toBe(0);
    expect(parseLimitTokens('5000')).toBe(5000);
    expect(parseLimitTokens('')).toBeNull();
    expect(parseLimitTokens('  ')).toBeNull();
    expect(parseLimitTokens('-1')).toBeNull();
    expect(parseLimitTokens('1.5')).toBeNull();
    expect(parseLimitTokens('01')).toBeNull();
  });
});
