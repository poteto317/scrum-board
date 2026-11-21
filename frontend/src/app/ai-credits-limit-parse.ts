/** 上限あり時の下書き文字列が非負整数か */
export function parseLimitTokens(raw: string): number | null {
  const trimmed = raw.trim();
  const n = Number.parseInt(trimmed, 10);
  if (trimmed === '' || !Number.isInteger(n) || String(n) !== trimmed || n < 0) {
    return null;
  }
  return n;
}
