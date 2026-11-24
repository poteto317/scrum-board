export type ListFilter = { query: string; statusIds: number[] };

export type ListFilterView = 'board' | 'backlog';

export type WorkspaceListFilters = {
  board: ListFilter;
  backlog: ListFilter;
};

export function emptyListFilter(): ListFilter {
  return { query: '', statusIds: [] };
}

export function emptyWorkspaceListFilters(): WorkspaceListFilters {
  return { board: emptyListFilter(), backlog: emptyListFilter() };
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

/** 一覧の応答の説明は先頭 500 文字まで（backend の listDescriptionRunes）なので、文字での絞り込みはその範囲だけを検索する（全文は詳細で取る）。 */
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

export function cloneListFilter(f: ListFilter | null | undefined): ListFilter {
  return {
    query: f?.query ?? '',
    statusIds: [...(f?.statusIds ?? [])],
  };
}

export function cloneWorkspaceListFilters(
  f: WorkspaceListFilters | null | undefined,
): WorkspaceListFilters {
  return {
    board: cloneListFilter(f?.board),
    backlog: cloneListFilter(f?.backlog),
  };
}

export function listFiltersEqual(a: ListFilter, b: ListFilter): boolean {
  if (a.query !== b.query) return false;
  if (a.statusIds.length !== b.statusIds.length) return false;
  return a.statusIds.every((id, i) => id === b.statusIds[i]);
}
