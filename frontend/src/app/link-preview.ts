import { Observable, catchError, forkJoin, map, of } from 'rxjs';
import { hostnameFallback, normalizeDescriptionLinkUrl } from './description-link';

export { hostnameFallback };

type LinkPreviewApi = {
  linkPreviews(urls: string[]): Observable<{
    previews: Record<string, { ok: boolean; title?: string }>;
  }>;
};

const CHUNK = 20;

/** Stale discard stays with the caller (compare generation after subscribe). */
export function loadLinkPreviews(
  api: LinkPreviewApi,
  urls: string[],
): Observable<Record<string, string>> {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const n = normalizeDescriptionLinkUrl(raw);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    normalized.push(n);
  }
  if (normalized.length === 0) return of({});

  const chunks: string[][] = [];
  for (let i = 0; i < normalized.length; i += CHUNK) {
    chunks.push(normalized.slice(i, i + CHUNK));
  }

  const requests = chunks.map((chunk) =>
    api.linkPreviews(chunk).pipe(
      map((res) => {
        const out: Record<string, string> = {};
        for (const url of chunk) {
          const entry = res.previews?.[url];
          out[url] =
            entry?.ok && entry.title && entry.title.trim()
              ? entry.title.trim()
              : hostnameFallback(url);
        }
        return out;
      }),
      catchError(() => {
        const out: Record<string, string> = {};
        for (const url of chunk) out[url] = hostnameFallback(url);
        return of(out);
      }),
    ),
  );

  return forkJoin(requests).pipe(
    map((parts) => Object.assign({}, ...parts) as Record<string, string>),
  );
}
