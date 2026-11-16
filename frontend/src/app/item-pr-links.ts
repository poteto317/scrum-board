import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Observable, finalize, takeUntil } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Api } from './api';
import { errorMessage } from './api-error';
import { moveIndex } from './list-reorder';
import { Item } from './models';
import { alignPrTitles } from './pr-display';
import { prUrlValidator } from './pr-url';

/** Immediate add/remove/reorder for card.prUrls — separate from title/description autosave. */
@Injectable()
export class ItemPrLinks {
  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);
  readonly saving = signal(false);
  readonly draft = new FormControl('', { nonNullable: true, validators: [prUrlValidator] });
  private cancel$?: Observable<unknown>;
  private apply!: (updated: Pick<Item, 'prUrls' | 'prTitles' | 'updatedAt'>) => void;
  private markDirty!: () => void;
  private reportError!: (message: string) => void;
  private current!: () => Item | null;

  bind(opts: {
    item: () => Item | null;
    applyPrSave: (updated: Pick<Item, 'prUrls' | 'prTitles' | 'updatedAt'>) => void;
    markPrSideDirty: () => void;
    onError: (message: string) => void;
    cancel$: Observable<unknown>;
  }) {
    this.current = opts.item;
    this.apply = opts.applyPrSave;
    this.markDirty = opts.markPrSideDirty;
    this.reportError = opts.onError;
    this.cancel$ = opts.cancel$;
  }

  reset() {
    this.draft.reset('', { emitEvent: false });
    this.saving.set(false);
  }

  add() {
    const card = this.current();
    if (!card || this.saving()) return;
    this.draft.markAsTouched();
    const url = this.draft.value.trim();
    if (!url || this.draft.invalid) return;
    if (card.prUrls.includes(url)) {
      this.reportError('同じPR URLはすでに紐付いています。');
      return;
    }
    this.save([...card.prUrls, url], () => this.draft.reset('', { emitEvent: false }));
  }

  remove(index: number) {
    const card = this.current();
    if (!card || this.saving() || index < 0 || index >= card.prUrls.length) return;
    this.save(card.prUrls.filter((_, i) => i !== index));
  }

  reorder(from: number, to: number) {
    const card = this.current();
    if (!card || this.saving()) return;
    const previous = [...card.prUrls];
    const next = moveIndex(previous, from, to);
    if (next === previous) return;
    this.save(next);
  }

  move(index: number, delta: number) {
    this.reorder(index, index + delta);
  }

  private save(prUrls: string[], onSuccess?: () => void) {
    const card = this.current();
    if (!card || !this.cancel$) return;
    const snapshotUrls = [...card.prUrls];
    const snapshotTitles = [...(card.prTitles ?? [])];
    const aligned = alignPrTitles(snapshotUrls, snapshotTitles, prUrls);
    this.saving.set(true);
    this.markDirty();
    this.reportError('');
    this.apply({ prUrls, prTitles: aligned, updatedAt: card.updatedAt });
    this.api
      .updateItem(card.id, { prUrls })
      .pipe(
        takeUntil(this.cancel$),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: (updated) => {
          const nextUrls = updated.prUrls ?? [];
          this.apply({
            prUrls: nextUrls,
            prTitles: alignPrTitles(prUrls, aligned, nextUrls),
            updatedAt: updated.updatedAt,
          });
          onSuccess?.();
        },
        error: (error) => {
          this.apply({
            prUrls: snapshotUrls,
            prTitles: snapshotTitles,
            updatedAt: this.current()?.updatedAt ?? card.updatedAt,
          });
          this.reportError(errorMessage(error));
        },
      });
  }
}
