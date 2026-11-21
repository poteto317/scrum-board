/** 表示に必要な最小形（API 型に依存しない） */
export type CreditsDisplayView = {
  limitTokens: number | null;
  remainingTokens: number | null;
  unlimited: boolean;
  period: string;
};

export function displayRemaining(c: CreditsDisplayView): string {
  if (c.unlimited) return '上限なし';
  if (c.remainingTokens == null) return '—';
  return String(c.remainingTokens);
}

export function displayLimit(c: CreditsDisplayView): string {
  if (c.unlimited) return '上限なし';
  if (c.limitTokens == null) return '—';
  return String(c.limitTokens);
}

export function displayPeriod(c: CreditsDisplayView): string {
  return c.period === 'cumulative' ? '累計' : c.period;
}
