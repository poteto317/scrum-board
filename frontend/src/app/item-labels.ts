import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Observable, finalize, takeUntil } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Api } from './api';
import { errorMessage } from './api-error';
import { Item } from './models';

/**
 * Component-scoped immediate save helper for item labelIds on ItemDetail (L-542 / L-653).
 */
@Injectable()
export class ItemLabels {
  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);

  readonly saving = signal(false);
  readonly error = signal('');

  private busy = false;
  private current!: () => Item | null;
  private apply!: (updated: Pick<Item, 'labels' | 'updatedAt'>) => void;
  private cancel$?: Observable<unknown>;

  bind(opts: {
    item: () => Item | null;
    applyLabelsSave: (updated: Pick<Item, 'labels' | 'updatedAt'>) => void;
    cancel$: Observable<unknown>;
  }): void {
    this.current = opts.item;
    this.apply = opts.applyLabelsSave;
    this.cancel$ = opts.cancel$;
  }

  reset(): void {
    this.busy = false;
    this.saving.set(false);
    this.error.set('');
  }

  updateLabels(labelIds: number[]): void {
    if (this.busy || this.saving() || !this.cancel$) return;
    const card = this.current();
    if (!card || card.archivedAt || card.canEdit === false) return;

    this.busy = true;
    this.saving.set(true);
    this.error.set('');
    this.api
      .updateItem(card.id, { labelIds })
      .pipe(
        takeUntil(this.cancel$),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.busy = false;
          this.saving.set(false);
        }),
      )
      .subscribe({
        next: (updated) => {
          this.apply(updated);
          this.error.set('');
        },
        error: (err: unknown) => {
          this.error.set(errorMessage(err) || 'ラベルの保存に失敗しました。');
        },
      });
  }
}
