import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Observable, finalize, takeUntil } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Api } from './api';
import { errorMessage } from './api-error';
import { Card } from './models';
import { prUrlValidator } from './pr-url';

/** Immediate add/remove for card.prUrls — separate from title/description autosave. */
@Injectable()
export class CardPrLinks {
  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);
  readonly saving = signal(false);
  readonly draft = new FormControl('', { nonNullable: true, validators: [prUrlValidator] });
  private cancel$?: Observable<unknown>;
  private apply!: (updated: Pick<Card, 'prUrls' | 'updatedAt'>) => void;
  private reportError!: (message: string) => void;
  private current!: () => Card | null;

  bind(opts: {
    card: () => Card | null;
    applyPrSave: (updated: Pick<Card, 'prUrls' | 'updatedAt'>) => void;
    onError: (message: string) => void;
    cancel$: Observable<unknown>;
  }) {
    this.current = opts.card;
    this.apply = opts.applyPrSave;
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

  private save(prUrls: string[], onSuccess?: () => void) {
    const card = this.current();
    if (!card || !this.cancel$) return;
    this.saving.set(true);
    this.reportError('');
    this.api
      .updateCard(card.id, { prUrls })
      .pipe(
        takeUntil(this.cancel$),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: (updated) => {
          this.apply({ prUrls: updated.prUrls ?? [], updatedAt: updated.updatedAt });
          onSuccess?.();
        },
        error: (error) => this.reportError(errorMessage(error)),
      });
  }
}
