import type { Item } from './models';

/** Match backend NormalizeCloseReason / maxCloseReasonLen. */
export const MAX_CLOSE_REASON_LEN = 2000;

/** Trim and accept empty; null when over Unicode length limit. */
export function normalizeCloseReason(raw: string): string | null {
  const value = raw.trim();
  if ([...value].length > MAX_CLOSE_REASON_LEN) return null;
  return value;
}

/** Merge Close transition PATCH response into local detail item (keep side fields). */
export function mergeCloseTransitionItem(local: Item | null, updated: Item): Item {
  return {
    ...(local ?? updated),
    ...updated,
    prUrls: updated.prUrls ?? local?.prUrls ?? [],
    relatedItems: updated.relatedItems ?? local?.relatedItems ?? [],
    assignee: updated.assignee ?? local?.assignee ?? '',
    closeReason: updated.closeReason ?? '',
  };
}
