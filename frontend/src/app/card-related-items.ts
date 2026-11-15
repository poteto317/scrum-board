import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Observable, finalize, takeUntil } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Api } from './api';
import { errorMessage } from './api-error';
import { Card, RelatedItem } from './models';
import { parseRelatedDraft, sameRelatedItem } from './related-item';
import { textLimit } from './form-validation';

/** Immediate add/remove for card.relatedItems — separate from title/description autosave. */
@Injectable()
export class CardRelatedItems {
  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);
  readonly saving = signal(false);
  readonly draft = new FormControl('', { nonNullable: true });
  readonly labelDraft = new FormControl('', {
    nonNullable: true,
    validators: [textLimit(120)],
  });
  private cancel$?: Observable<unknown>;
  private apply!: (updated: Pick<Card, 'relatedItems' | 'updatedAt'>) => void;
  private markDirty!: () => void;
  private reportError!: (message: string) => void;
  private current!: () => Card | null;

  bind(opts: {
    card: () => Card | null;
    applyRelatedSave: (updated: Pick<Card, 'relatedItems' | 'updatedAt'>) => void;
    markRelatedSideDirty: () => void;
    onError: (message: string) => void;
    cancel$: Observable<unknown>;
  }) {
    this.current = opts.card;
    this.apply = opts.applyRelatedSave;
    this.markDirty = opts.markRelatedSideDirty;
    this.reportError = opts.onError;
    this.cancel$ = opts.cancel$;
  }

  reset() {
    this.draft.reset('', { emitEvent: false });
    this.labelDraft.reset('', { emitEvent: false });
    this.saving.set(false);
  }

  add() {
    const card = this.current();
    if (!card || this.saving()) return;
    this.draft.markAsTouched();
    this.labelDraft.markAsTouched();
    if (this.labelDraft.invalid) return;
    const parsed = parseRelatedDraft(this.draft.value);
    if (parsed.kind === 'invalid') {
      this.reportError('カード番号（正の整数）または http(s) URL を入力してください。');
      return;
    }
    if (parsed.kind === 'card' && parsed.number === card.number) {
      this.reportError('自分自身のカードは関連に追加できません。');
      return;
    }
    const label = this.labelDraft.value.trim();
    const item: RelatedItem =
      parsed.kind === 'card'
        ? { kind: 'card', number: parsed.number, label }
        : { kind: 'url', url: parsed.url, label };
    const existing = card.relatedItems ?? [];
    if (existing.some((row) => sameRelatedItem(row, item))) {
      this.reportError('同じ関連はすでに付いています。');
      return;
    }
    this.save([...existing, item], () => {
      this.draft.reset('', { emitEvent: false });
      this.labelDraft.reset('', { emitEvent: false });
    });
  }

  remove(item: RelatedItem) {
    const card = this.current();
    if (!card || this.saving()) return;
    const next = (card.relatedItems ?? []).filter((row) => !sameRelatedItem(row, item));
    this.save(next);
  }

  private save(relatedItems: RelatedItem[], onSuccess?: () => void) {
    const card = this.current();
    if (!card || !this.cancel$) return;
    this.saving.set(true);
    this.markDirty();
    this.reportError('');
    this.api
      .updateCard(card.id, { relatedItems })
      .pipe(
        takeUntil(this.cancel$),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: (updated) => {
          this.apply({
            relatedItems: updated.relatedItems ?? [],
            updatedAt: updated.updatedAt,
          });
          onSuccess?.();
        },
        error: (error) => this.reportError(errorMessage(error)),
      });
  }
}
