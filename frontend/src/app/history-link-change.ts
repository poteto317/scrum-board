import { RelatedItem } from './models';
import { validPrUrl } from './pr-url';

export type LinkChangeBlock =
  | { kind: 'pr'; urls: string[] }
  | { kind: 'related'; items: RelatedItem[] };

export function prUrlList(value: string): string[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function relatedList(value: string): RelatedItem[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const out: RelatedItem[] = [];
    for (const raw of parsed) {
      if (!raw || typeof raw !== 'object') return null;
      const item = raw as RelatedItem;
      if (item.kind !== 'item' && item.kind !== 'url') return null;
      out.push(item);
    }
    return out;
  } catch {
    return null;
  }
}

/** Parse a history change field into a typed link block, or null for plain text. */
export function renderLinkChange(field: string, value: string): LinkChangeBlock | null {
  if (field === 'prUrls') {
    const urls = prUrlList(value);
    if (urls === null) return null;
    return { kind: 'pr', urls };
  }
  if (field === 'prUrl') {
    const text = (value ?? '').trim();
    if (!text) return { kind: 'pr', urls: [] };
    if (validPrUrl(text) && text === value.trim()) return { kind: 'pr', urls: [text] };
    return null;
  }
  if (field === 'relatedItems') {
    const items = relatedList(value);
    if (items === null) return null;
    return { kind: 'related', items };
  }
  return null;
}

export function collectPrUrlsFromEvents(
  events: { changes: { field: string; before: string; after: string }[] }[],
): string[] {
  const urls = new Set<string>();
  for (const event of events) {
    for (const change of event.changes) {
      for (const raw of [change.before, change.after]) {
        const block = renderLinkChange(change.field, raw);
        if (block?.kind !== 'pr') continue;
        for (const u of block.urls) {
          if (u && validPrUrl(u) && u === u.trim()) urls.add(u);
        }
      }
    }
  }
  return [...urls];
}

/** URLs that still need a batch title lookup. */
export function missingPrTitleUrls(
  events: { changes: { field: string; before: string; after: string }[] }[],
  known: Record<string, string>,
): string[] {
  return collectPrUrlsFromEvents(events).filter((u) => !known[u]);
}

/** Merge batch API titles into the existing map (pure). */
export function mergePrTitleMap(
  prev: Record<string, string>,
  titles: Record<string, string> | null | undefined,
): Record<string, string> {
  return { ...prev, ...(titles ?? {}) };
}
