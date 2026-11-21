/** GET /api/ai/credits 応答のうちゲート判定に使う形（API 層に依存しない） */
export type CreditsGateView = {
  limitTokens: number | null;
  remainingTokens: number | null;
  unlimited: boolean;
  configured: boolean;
};

export type BlockedReason = 'unconfigured' | 'exhausted';

export function isComposeBlocked(c: CreditsGateView | null): boolean {
  return blockedReason(c) !== null;
}

export function blockedReason(c: CreditsGateView | null): BlockedReason | null {
  if (!c) return null;
  if (!c.configured) return 'unconfigured';
  if (!c.unlimited && c.remainingTokens === 0) return 'exhausted';
  return null;
}

export function isLowRemaining(c: CreditsGateView | null): boolean {
  if (!c || isComposeBlocked(c)) return false;
  if (c.unlimited || c.limitTokens == null || c.remainingTokens == null) return false;
  if (c.remainingTokens <= 0) return false;
  return c.remainingTokens < c.limitTokens * 0.1;
}
