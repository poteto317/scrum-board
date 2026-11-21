import { describe, expect, it } from 'vitest';
import {
  blockedReason,
  CreditsGateView,
  isComposeBlocked,
  isLowRemaining,
} from './ai-credits-state';

function credits(partial: Partial<CreditsGateView>): CreditsGateView {
  return {
    limitTokens: 1000,
    remainingTokens: 1000,
    unlimited: false,
    configured: true,
    ...partial,
  };
}

describe('ai-credits-state', () => {
  it('null credits is not blocked and not low', () => {
    expect(isComposeBlocked(null)).toBe(false);
    expect(isLowRemaining(null)).toBe(false);
    expect(blockedReason(null)).toBeNull();
  });

  it('unlimited is not blocked and not low', () => {
    const c = credits({
      unlimited: true,
      limitTokens: null,
      remainingTokens: null,
    });
    expect(isComposeBlocked(c)).toBe(false);
    expect(isLowRemaining(c)).toBe(false);
  });

  it('limitTokens null is not low even when unlimited is false', () => {
    expect(
      isLowRemaining(
        credits({
          unlimited: false,
          limitTokens: null,
          remainingTokens: 50,
        }),
      ),
    ).toBe(false);
  });

  it('exactly 10% remaining is not low; below is low', () => {
    expect(isLowRemaining(credits({ limitTokens: 1000, remainingTokens: 100 }))).toBe(false);
    expect(isLowRemaining(credits({ limitTokens: 1000, remainingTokens: 99 }))).toBe(true);
  });

  it('remaining 0 with configured is exhausted', () => {
    const c = credits({ remainingTokens: 0 });
    expect(blockedReason(c)).toBe('exhausted');
    expect(isComposeBlocked(c)).toBe(true);
    expect(isLowRemaining(c)).toBe(false);
  });

  it('remaining null with unlimited false is exhausted (fail-closed)', () => {
    expect(
      blockedReason(
        credits({ unlimited: false, remainingTokens: null, limitTokens: 100 }),
      ),
    ).toBe('exhausted');
  });

  it('unconfigured wins over exhausted remaining', () => {
    const c = credits({ configured: false, remainingTokens: 0 });
    expect(blockedReason(c)).toBe('unconfigured');
    expect(isLowRemaining(c)).toBe(false);
  });
});
