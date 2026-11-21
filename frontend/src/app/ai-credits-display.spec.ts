import { describe, expect, it } from 'vitest';
import {
  displayLimit,
  displayPeriod,
  displayRemaining,
  type CreditsDisplayView,
} from './ai-credits-display';

function credits(partial: Partial<CreditsDisplayView> = {}): CreditsDisplayView {
  return {
    limitTokens: 1000,
    remainingTokens: 900,
    unlimited: false,
    period: 'cumulative',
    ...partial,
  };
}

describe('ai-credits-display', () => {
  it('formats remaining and limit for unlimited and null', () => {
    expect(displayRemaining(credits({ unlimited: true }))).toBe('上限なし');
    expect(displayLimit(credits({ unlimited: true }))).toBe('上限なし');
    expect(displayRemaining(credits({ remainingTokens: null }))).toBe('—');
    expect(displayLimit(credits({ limitTokens: null }))).toBe('—');
    expect(displayRemaining(credits({ remainingTokens: 42 }))).toBe('42');
  });

  it('maps cumulative period to 累計', () => {
    expect(displayPeriod(credits({ period: 'cumulative' }))).toBe('累計');
    expect(displayPeriod(credits({ period: 'monthly' }))).toBe('monthly');
  });
});
