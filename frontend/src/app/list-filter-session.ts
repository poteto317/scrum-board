import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Api } from './api';
import { errorMessage } from './api-error';
import { emptyListFilter, ListFilter } from './list-filter';

export const LIST_FILTER_LOAD_FAILURE = 'フィルタ設定を読み込めませんでした。再試行してください。';
export const LIST_FILTER_SAVE_FAILURE = 'フィルタ設定の保存に失敗しました。';
export const LIST_FILTER_QUERY_MAX = 200;

const SAVE_DEBOUNCE_MS = 300;

@Injectable({ providedIn: 'root' })
export class ListFilterSession {
  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);
  /** Draft used for UI and client-side matching. */
  readonly filter = signal<ListFilter>(emptyListFilter());
  readonly loadError = signal('');
  readonly saveError = signal('');
  private confirmed: ListFilter = emptyListFilter();
  private loadGeneration = 0;
  private saveGeneration = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private saveInFlight = false;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.clearTimer();
      this.saveGeneration++;
      this.loadGeneration++;
      this.saveInFlight = false;
    });
  }

  load(options?: { force?: boolean }) {
    const force = options?.force === true;
    if (!force && this.isDirty()) {
      // Keep local draft across board↔backlog; do not cancel pending PUT/debounce.
      return;
    }
    this.clearTimer();
    if (force) {
      this.saveGeneration++;
      this.saveInFlight = false;
    }
    const generation = ++this.loadGeneration;
    this.api.listFilter().subscribe({
      next: (res) => {
        if (generation !== this.loadGeneration) return;
        const next = cloneFilter(res);
        this.confirmed = next;
        this.filter.set(cloneFilter(next));
        this.loadError.set('');
        this.saveError.set('');
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

  setQuery(query: string) {
    this.bumpLoadGeneration();
    const clipped = [...query].slice(0, LIST_FILTER_QUERY_MAX).join('');
    this.filter.update((f) => ({ ...f, query: clipped }));
    this.scheduleSave();
  }

  toggleStatus(columnId: number) {
    this.bumpLoadGeneration();
    this.filter.update((f) => {
      const has = f.statusIds.includes(columnId);
      return {
        ...f,
        statusIds: has ? f.statusIds.filter((id) => id !== columnId) : [...f.statusIds, columnId],
      };
    });
    this.scheduleSave();
  }

  clear() {
    this.bumpLoadGeneration();
    this.filter.set(emptyListFilter());
    this.scheduleSave();
  }

  private isDirty(): boolean {
    if (this.timer !== undefined || this.saveInFlight) return true;
    const draft = this.filter();
    if (draft.query !== this.confirmed.query) return true;
    if (draft.statusIds.length !== this.confirmed.statusIds.length) return true;
    return draft.statusIds.some((id, i) => id !== this.confirmed.statusIds[i]);
  }

  private bumpLoadGeneration() {
    this.loadGeneration++;
    // Invalidate in-flight PUT so its response cannot rewind a newer draft (L-040).
    this.saveGeneration++;
    this.saveInFlight = false;
  }

  private scheduleSave() {
    this.clearTimer();
    this.timer = setTimeout(() => this.flushSave(), SAVE_DEBOUNCE_MS);
  }

  private flushSave() {
    this.timer = undefined;
    const generation = ++this.saveGeneration;
    this.saveInFlight = true;
    const payload = cloneFilter(this.filter());
    this.api.putListFilter(payload).subscribe({
      next: (res) => {
        if (generation !== this.saveGeneration) return;
        this.saveInFlight = false;
        const next = cloneFilter(res);
        this.confirmed = next;
        this.filter.set(cloneFilter(next));
        this.saveError.set('');
      },
      error: (error: unknown) => {
        if (generation !== this.saveGeneration) return;
        this.saveInFlight = false;
        this.filter.set(cloneFilter(this.confirmed));
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

function cloneFilter(f: ListFilter | null | undefined): ListFilter {
  return {
    query: f?.query ?? '',
    statusIds: [...(f?.statusIds ?? [])],
  };
}
