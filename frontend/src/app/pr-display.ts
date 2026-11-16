import { validPrUrl } from './pr-url';

/** Short label owner/repo#n. Never returns the full URL. */
export function fallbackPrLabel(url: string): string {
  const value = url.trim();
  if (!validPrUrl(value) || !value) return '#';
  const match =
    /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)$/.exec(
      value,
    );
  if (!match || match[0] !== value) return '#';
  return `${match[1]}/${match[2]}#${match[3]}`;
}

/** Prefer API title at index; otherwise fallback. */
export function prDisplayLabel(url: string, titles: string[] | undefined | null, index: number): string {
  const fromApi = titles?.[index]?.trim();
  if (fromApi) return fromApi;
  return fallbackPrLabel(url);
}

/** Keep prTitles aligned with a new prUrls order (by URL). Unknown URLs get fallback. */
export function alignPrTitles(
  prevUrls: string[],
  prevTitles: string[] | undefined | null,
  nextUrls: string[],
): string[] {
  const byUrl = new Map<string, string>();
  prevUrls.forEach((url, i) => {
    const title = prevTitles?.[i]?.trim();
    if (title) byUrl.set(url, title);
  });
  return nextUrls.map((url) => byUrl.get(url) || fallbackPrLabel(url));
}
