import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Observable, finalize, takeUntil } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Api } from './api';
import { errorMessage } from './api-error';
import {
  DueAtLocalParts,
  formatDueAtUtc,
  fromLocalParts,
  parseDueAt,
  toLocalParts,
  truncateLocalToMinute,
} from './due-at';
import { clampDueAtPartsToYearRange } from './due-at-year';
import { Item } from './models';

/** Immediate dueAt PATCH — picker session separate from title/description autosave. */
@Injectable()
export class ItemDueAt {
  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);
  readonly open = signal(false);
  readonly saving = signal(false);
  readonly draft = signal<DueAtLocalParts | null>(null);
  private cancel$?: Observable<unknown>;
  private apply!: (updated: Pick<Item, 'dueAt' | 'updatedAt'>) => void;
  private markDirty!: () => void;
  private reportError!: (message: string) => void;
  private current!: () => Item | null;
  bind(opts: {
    item: () => Item | null;
    applyDueSave: (updated: Pick<Item, 'dueAt' | 'updatedAt'>) => void;
    markDueSideDirty: () => void;
    onError: (message: string) => void;
    cancel$: Observable<unknown>;
  }) {
    this.current = opts.item;
    this.apply = opts.applyDueSave;
    this.markDirty = opts.markDueSideDirty;
    this.reportError = opts.onError;
    this.cancel$ = opts.cancel$;
  }

  reset() {
    this.open.set(false);
    this.draft.set(null);
    this.saving.set(false);
  }

  /** Open picker: existing dueAt → local parts; else now truncated to the minute. */
  start() {
    const card = this.current();
    if (!card || this.saving()) return;
    const existing = parseDueAt(card.dueAt);
    const base = existing ?? truncateLocalToMinute(new Date());
    this.draft.set(clampDueAtPartsToYearRange(toLocalParts(base)));
    this.open.set(true);
    this.reportError('');
  }

  cancel() {
    if (this.saving()) return;
    this.open.set(false);
    this.draft.set(null);
  }

  /** Optional parts flush wheel scroll before save (caller passes picker read). */
  confirm(partsFromPicker?: DueAtLocalParts | null) {
    if (partsFromPicker) this.draft.set(partsFromPicker);
    const card = this.current();
    const parts = this.draft();
    if (!card || !parts || this.saving() || !this.cancel$) return;
    const dueAt = formatDueAtUtc(fromLocalParts(parts));
    if (dueAt === card.dueAt) {
      this.open.set(false);
      this.draft.set(null);
      return;
    }
    this.save(dueAt);
  }

  clear() {
    const card = this.current();
    if (!card || this.saving() || card.dueAt == null || !this.cancel$) return;
    this.save(null);
  }

  private save(dueAt: string | null) {
    const card = this.current();
    if (!card || !this.cancel$) return;
    this.saving.set(true);
    this.markDirty();
    this.reportError('');
    this.api
      .updateItem(card.id, { dueAt })
      .pipe(
        takeUntil(this.cancel$),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: (updated) => {
          this.apply({ dueAt: updated.dueAt ?? null, updatedAt: updated.updatedAt });
          this.open.set(false);
          this.draft.set(null);
        },
        error: (error) => {
          // L-001: discard uncommitted draft; restore display from item signal.
          this.open.set(false);
          this.draft.set(null);
          this.reportError(errorMessage(error));
        },
      });
  }
}
