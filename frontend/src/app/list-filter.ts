import type { Label } from './label';

export type ListFilter = { query: string; statusIds: number[]; labelIds: number[] };

export type ListFilterInput = { query: string; statusIds: number[]; labelIds?: number[] };

export type ListFilterView = 'board' | 'backlog';

export type WorkspaceListFilters = {
  board: ListFilter;
  backlog: ListFilter;
};

export type WorkspaceListFiltersInput = {
  board: ListFilterInput;
  backlog: ListFilterInput;
};

export function emptyListFilter(): ListFilter {
  return { query: '', statusIds: [], labelIds: [] };
}

export function emptyWorkspaceListFilters(): WorkspaceListFilters {
  return { board: emptyListFilter(), backlog: emptyListFilter() };
}

function dedupePositiveInts(ids: readonly number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function resolveKnownLabelIds(ids: number[], knownLabelIds: number[] | null): number[] {
  return knownLabelIds === null ? dedupePositiveInts(ids) : normalizeStatusIds(ids, knownLabelIds);
}

/**
 * Draft filter with statusIds/labelIds limited to known ids (for UI + match).
 * While knownLabelIds is null (labels catalog still loading), labelIds are preserved de-duplicated.
 */
export function appliedListFilter(
  draft: ListFilter,
  knownColumnIds: number[],
  knownLabelIds: number[] | null = null,
): ListFilter {
  return {
    query: draft.query,
    statusIds: normalizeStatusIds(draft.statusIds, knownColumnIds),
    labelIds: resolveKnownLabelIds(draft.labelIds, knownLabelIds),
  };
}

/** True when the filter hides at least one item relative to known columns/labels (DnD should pause). */
export function listFilterActive(
  filter: ListFilter,
  knownColumnIds: number[] = [],
  knownLabelIds: number[] | null = null,
): boolean {
  if (filter.query.trim() !== '') return true;
  if (resolveKnownLabelIds(filter.labelIds, knownLabelIds).length > 0) return true;
  if (filter.statusIds.length === 0) return false;
  if (knownColumnIds.length === 0) return true;
  return !knownColumnIds.every((id) => filter.statusIds.includes(id));
}

/** Keep only ids present in knownIds; preserve first-seen order; drop duplicates. */
export function normalizeStatusIds(ids: number[], knownIds: number[]): number[] {
  const known = new Set(knownIds);
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
  item: { title: string; description: string; columnId: number; labels?: readonly Label[] },
  filter: ListFilter,
): boolean {
  const q = filter.query.trim().toLowerCase();
  if (q) {
    const title = (item.title ?? '').toLowerCase();
    const description = (item.description ?? '').toLowerCase();
    if (!title.includes(q) && !description.includes(q)) return false;
  }
  if (filter.statusIds.length > 0 && !filter.statusIds.includes(item.columnId)) {
    return false;
  }
  if (filter.labelIds.length > 0) {
    const attached = new Set((item.labels ?? []).map((l) => l.id));
    if (!filter.labelIds.every((id) => attached.has(id))) {
      return false;
    }
  }
  return true;
}

export function cloneListFilter(f: ListFilterInput | null | undefined): ListFilter {
  return {
    query: f?.query ?? '',
    statusIds: [...(f?.statusIds ?? [])],
    labelIds: [...(f?.labelIds ?? [])],
  };
}

export function cloneWorkspaceListFilters(
  f: WorkspaceListFiltersInput | null | undefined,
): WorkspaceListFilters {
  return {
    board: cloneListFilter(f?.board),
    backlog: cloneListFilter(f?.backlog),
  };
}

export function listFiltersEqual(a: ListFilter, b: ListFilter): boolean {
  if (a.query !== b.query) return false;
  if (a.statusIds.length !== b.statusIds.length) return false;
  if (!a.statusIds.every((id, i) => id === b.statusIds[i])) return false;
  if (a.labelIds.length !== b.labelIds.length) return false;
  return a.labelIds.every((id, i) => id === b.labelIds[i]);
}
