import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, Subject, finalize, tap } from 'rxjs';
import { Api } from './api';
import { errorMessage } from './api-error';
import {
  Label,
  LabelCatalogChange,
  LabelInput,
  LabelPatch,
  normalizeLabels,
} from './label';
import { ListFilterSession } from './list-filter-session';
import { Item } from './models';
import { ProjectBoardCache } from './project-board-cache';

export const LABELS_LOAD_FAILURE = 'ラベルを読み込めませんでした。再試行してください。';

@Injectable({ providedIn: 'root' })
export class LabelsSession {
  private readonly api = inject(Api);
  private readonly cache = inject(ProjectBoardCache);
  private readonly listFilter = inject(ListFilterSession);

  readonly labels = signal<Label[]>([]);
  readonly loaded = signal(false);
  readonly loading = signal(false);
  readonly loadError = signal('');
  /** Null while catalog has not loaded yet so persisted label filter ids are preserved. */
  readonly knownLabelIds = computed<number[] | null>(() =>
    this.loaded() ? this.labels().map((l) => l.id) : null,
  );

  private readonly changesSubject = new Subject<LabelCatalogChange>();
  readonly changes$ = this.changesSubject.asObservable();

  private loadGeneration = 0;
  private mutationGeneration = 0;

  clear(): void {
    this.loadGeneration++;
    this.mutationGeneration++;
    this.labels.set([]);
    this.loaded.set(false);
    this.loading.set(false);
    this.loadError.set('');
  }

  load(options?: { force?: boolean }): void {
    if (this.loading() && options?.force !== true) return;
    const generation = ++this.loadGeneration;
    this.loading.set(true);
    this.loadError.set('');
    this.api
      .listLabels()
      .pipe(
        finalize(() => {
          if (generation === this.loadGeneration) {
            this.loading.set(false);
          }
        }),
      )
      .subscribe({
        next: (res) => {
          if (generation !== this.loadGeneration) return;
          this.labels.set(normalizeLabels(res?.labels));
          this.loaded.set(true);
          this.loadError.set('');
        },
        error: (err: unknown) => {
          if (generation !== this.loadGeneration) return;
          // L-002: keep previously loaded labels visible on refresh failure.
          this.loadError.set(errorMessage(err) || LABELS_LOAD_FAILURE);
        },
      });
  }

  /** Refresh catalog in the background when server items show label additions/renames/recolors (L-475). */
  syncWithObservedItems(items: readonly Item[]): void {
    if (!this.loaded() || this.loading()) return;
    const byId = new Map(this.labels().map((l) => [l.id, l]));
    for (const item of items) {
      for (const l of item.labels ?? []) {
        const known = byId.get(l.id);
        if (!known || known.name !== l.name || known.color !== l.color) {
          this.load();
          return;
        }
      }
    }
  }

  create(input: LabelInput): Observable<Label> {
    const mutGen = this.mutationGeneration;
    return this.api.createLabel(input).pipe(
      tap((created) => {
        if (mutGen !== this.mutationGeneration) return;
        this.loadGeneration++;
        this.loading.set(false);
        const wasLoaded = this.loaded();
        this.labels.update((cur) => normalizeLabels([...cur, created]));
        this.loadError.set('');
        if (!wasLoaded) {
          this.load({ force: true });
        }
      }),
    );
  }

  update(id: number, patch: LabelPatch): Observable<Label> {
    const mutGen = this.mutationGeneration;
    return this.api.updateLabel(id, patch).pipe(
      tap((updated) => {
        if (mutGen !== this.mutationGeneration) return;
        this.loadGeneration++;
        this.loading.set(false);
        this.labels.update((cur) =>
          normalizeLabels(cur.map((l) => (l.id === id ? updated : l))),
        );
        this.cache.syncUpdatedLabel(updated);
        this.changesSubject.next({ kind: 'updated', label: updated });
      }),
    );
  }

  remove(id: number): Observable<void> {
    const mutGen = this.mutationGeneration;
    return this.api.deleteLabel(id).pipe(
      tap(() => {
        if (mutGen !== this.mutationGeneration) return;
        this.loadGeneration++;
        this.loading.set(false);
        this.labels.update((cur) => cur.filter((l) => l.id !== id));
        this.cache.pruneDeletedLabel(id);
        this.listFilter.pruneDeletedLabel(id);
        this.changesSubject.next({ kind: 'deleted', id });
      }),
    );
  }
}
