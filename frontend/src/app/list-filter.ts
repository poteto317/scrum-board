export type ListFilter = { query: string; statusIds: number[] };

export function emptyListFilter(): ListFilter {
  return { query: '', statusIds: [] };
}

/** Draft filter with statusIds limited to currently known columns (for UI + match). */
export function appliedListFilter(draft: ListFilter, knownColumnIds: number[]): ListFilter {
  return {
    query: draft.query,
    statusIds: normalizeStatusIds(draft.statusIds, knownColumnIds),
  };
}

/** True when the filter hides at least one item relative to known columns (DnD should pause). */
export function listFilterActive(filter: ListFilter, knownColumnIds: number[] = []): boolean {
  if (filter.query.trim() !== '') return true;
  if (filter.statusIds.length === 0) return false;
  if (knownColumnIds.length === 0) return true;
  return !knownColumnIds.every((id) => filter.statusIds.includes(id));
}

/** Keep only ids present in knownColumnIds; preserve first-seen order; drop duplicates. */
export function normalizeStatusIds(ids: number[], knownColumnIds: number[]): number[] {
  const known = new Set(knownColumnIds);
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function itemMatchesFilter(
  item: { title: string; description: string; columnId: number },
  filter: ListFilter,
): boolean {
  const q = filter.query.trim().toLowerCase();
  if (q) {
    const title = (item.title ?? '').toLowerCase();
    const description = (item.description ?? '').toLowerCase();
    if (!title.includes(q) && !description.includes(q)) return false;
  }
  if (filter.statusIds.length === 0) return true;
  return filter.statusIds.includes(item.columnId);
}
