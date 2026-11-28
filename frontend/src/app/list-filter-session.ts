import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Api } from './api';
import { errorMessage } from './api-error';
import {
  ListFilter,
  ListFilterView,
  WorkspaceListFilters,
  cloneListFilter,
  cloneWorkspaceListFilters,
  emptyListFilter,
  emptyWorkspaceListFilters,
  listFiltersEqual,
} from './list-filter';

export const LIST_FILTER_LOAD_FAILURE = 'フィルタ設定を読み込めませんでした。再試行してください。';
export const LIST_FILTER_SAVE_FAILURE = 'フィルタ設定の保存に失敗しました。';
export const LIST_FILTER_QUERY_MAX = 200;

const SAVE_DEBOUNCE_MS = 300;

@Injectable({ providedIn: 'root' })
export class ListFilterSession {
  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);
  /** Draft used for UI and client-side matching (both views). */
  readonly filters = signal<WorkspaceListFilters>(emptyWorkspaceListFilters());
  readonly loadError = signal('');
  readonly saveError = signal('');
  private confirmed: WorkspaceListFilters = emptyWorkspaceListFilters();
  private loadGeneration = 0;
  private saveGeneration = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private saveInFlight = false;
  /** True when a debounced whole-workspace PUT should run (both views). */
  private saveQueued = false;
  /** True after at least one successful GET so PUT never ships empty sibling views. */
  private hydrated = false;

  /** Deleted label ids observed in this session so in-flight GET/PUT never resurrects them. */
  private readonly deletedLabelIds = new Set<number>();

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.clearTimer();
      this.saveGeneration++;
      this.loadGeneration++;
      this.saveInFlight = false;
    });
  }

  filter(view: ListFilterView): ListFilter {
    return this.filters()[view];
  }

  load(options?: { force?: boolean }) {
    const force = options?.force === true;
    const hadQueuedSave = this.saveQueued || this.timer !== undefined;
    // Invalidate in-flight PUT so a stale whole-workspace body cannot overwrite a fresher GET.
    this.saveGeneration++;
    this.saveInFlight = false;
    if (force) {
      this.clearTimer();
      this.saveQueued = false;
    }
    const generation = ++this.loadGeneration;
    this.api.listFilter().subscribe({
      next: (res) => {
        if (generation !== this.loadGeneration) return;
        const incoming = this.stripDeletedLabels(cloneWorkspaceListFilters(res));
        const boardDirty = !force && this.isDirty('board');
        const backlogDirty = !force && this.isDirty('backlog');
        const next = cloneWorkspaceListFilters(incoming);
        if (boardDirty) next.board = cloneListFilter(this.filters().board);
        if (backlogDirty) next.backlog = cloneListFilter(this.filters().backlog);
        this.confirmed = {
          board: boardDirty ? cloneListFilter(this.confirmed.board) : cloneListFilter(incoming.board),
          backlog: backlogDirty
            ? cloneListFilter(this.confirmed.backlog)
            : cloneListFilter(incoming.backlog),
        };
        this.filters.set(next);
        this.hydrated = true;
        this.loadError.set('');
        this.saveError.set('');
        if (boardDirty || backlogDirty || hadQueuedSave || this.saveQueued) {
          this.scheduleSave();
        }
      },
      error: () => {
        if (generation !== this.loadGeneration) return;
        this.loadError.set(LIST_FILTER_LOAD_FAILURE);
      },
    });
  }

  retryLoad() {
    this.load({ force: true });
  }

  setQuery(view: ListFilterView, query: string) {
    const clipped = [...query].slice(0, LIST_FILTER_QUERY_MAX).join('');
    this.filters.update((f) => ({
      ...f,
      [view]: { ...f[view], query: clipped },
    }));
    this.afterLocalEdit(view);
  }

  toggleStatus(view: ListFilterView, columnId: number) {
    this.filters.update((f) => {
      const cur = f[view];
      const has = cur.statusIds.includes(columnId);
      return {
        ...f,
        [view]: {
          ...cur,
          statusIds: has ? cur.statusIds.filter((id) => id !== columnId) : [...cur.statusIds, columnId],
        },
      };
    });
    this.afterLocalEdit(view);
  }

  toggleLabel(view: ListFilterView, labelId: number) {
    this.filters.update((f) => {
      const cur = f[view];
      const has = cur.labelIds.includes(labelId);
      return {
        ...f,
        [view]: {
          ...cur,
          labelIds: has ? cur.labelIds.filter((id) => id !== labelId) : [...cur.labelIds, labelId],
        },
      };
    });
    this.afterLocalEdit(view);
  }

  /** Remove deleted label from both draft and confirmed filters without marking dirty. */
  pruneDeletedLabel(labelId: number) {
    this.deletedLabelIds.add(labelId);
    const strip = (f: ListFilter): ListFilter => ({
      ...f,
      labelIds: f.labelIds.filter((id) => id !== labelId),
    });
    this.confirmed = {
      board: strip(this.confirmed.board),
      backlog: strip(this.confirmed.backlog),
    };
    this.filters.update((cur) => ({
      board: strip(cur.board),
      backlog: strip(cur.backlog),
    }));
  }

  private stripDeletedLabels(wf: WorkspaceListFilters): WorkspaceListFilters {
    if (this.deletedLabelIds.size === 0) return wf;
    const strip = (f: ListFilter): ListFilter => ({
      ...f,
      labelIds: f.labelIds.filter((id) => !this.deletedLabelIds.has(id)),
    });
    return {
      board: strip(wf.board),
      backlog: strip(wf.backlog),
    };
  }

  clear(view: ListFilterView) {
    this.filters.update((f) => ({
      ...f,
      [view]: emptyListFilter(),
    }));
    this.afterLocalEdit(view);
  }

  private afterLocalEdit(_view: ListFilterView) {
    if (this.hydrated) {
      this.bumpLoadGeneration();
    }
    this.scheduleSave();
  }

  private isDirty(view: ListFilterView): boolean {
    return !listFiltersEqual(this.filters()[view], this.confirmed[view]);
  }

  private bumpLoadGeneration() {
    this.loadGeneration++;
    this.saveGeneration++;
    this.saveInFlight = false;
  }

  private scheduleSave() {
    this.clearTimer();
    this.saveQueued = true;
    this.timer = setTimeout(() => this.flushSave(), SAVE_DEBOUNCE_MS);
  }

  private flushSave() {
    this.timer = undefined;
    if (!this.hydrated) {
      // Wait for first GET so the other view is not PUT as empty defaults.
      return;
    }
    const generation = ++this.saveGeneration;
    this.saveInFlight = true;
    const payload = cloneWorkspaceListFilters(this.filters());
    this.api.putListFilter(payload).subscribe({
      next: (res) => {
        if (generation !== this.saveGeneration) return;
        this.saveInFlight = false;
        this.saveQueued = false;
        const next = this.stripDeletedLabels(cloneWorkspaceListFilters(res));
        this.confirmed = next;
        this.filters.set(cloneWorkspaceListFilters(next));
        this.saveError.set('');
      },
      error: (error: unknown) => {
        if (generation !== this.saveGeneration) return;
        this.saveInFlight = false;
        this.saveQueued = false;
        this.filters.set(cloneWorkspaceListFilters(this.confirmed));
        this.saveError.set(errorMessage(error) || LIST_FILTER_SAVE_FAILURE);
      },
    });
  }

  private clearTimer() {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
