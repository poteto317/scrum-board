import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Observable, finalize, takeUntil } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Api } from './api';
import { errorMessage } from './api-error';
import { moveIndex } from './list-reorder';
import { Item, RelatedItem } from './models';
import { parseRelatedDraft, sameRelatedItem } from './related-item';
import { textLimit } from './form-validation';

/** Immediate add/remove/reorder for card.relatedItems — separate from title/description autosave. */
@Injectable()
export class ItemRelatedItems {
  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);
  readonly saving = signal(false);
  readonly draft = new FormControl('', { nonNullable: true });
  readonly labelDraft = new FormControl('', {
    nonNullable: true,
    validators: [textLimit(120)],
  });
  private cancel$?: Observable<unknown>;
  private apply!: (updated: Pick<Item, 'relatedItems' | 'updatedAt'>) => void;
  private markDirty!: () => void;
  private reportError!: (message: string) => void;
  private current!: () => Item | null;

  bind(opts: {
    item: () => Item | null;
    applyRelatedSave: (updated: Pick<Item, 'relatedItems' | 'updatedAt'>) => void;
    markRelatedSideDirty: () => void;
    onError: (message: string) => void;
    cancel$: Observable<unknown>;
  }) {
    this.current = opts.item;
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
      this.reportError('アイテム番号（正の整数）または http(s) URL を入力してください。');
      return;
    }
    if (parsed.kind === 'item' && parsed.number === card.number) {
      this.reportError('自分自身のアイテムは関連に追加できません。');
      return;
    }
    const label = this.labelDraft.value.trim();
    const item: RelatedItem =
      parsed.kind === 'item'
        ? { kind: 'item', number: parsed.number, label, projectId: card.projectId }
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

  reorder(from: number, to: number) {
    const card = this.current();
    if (!card || this.saving()) return;
    const previous = [...(card.relatedItems ?? [])];
    const next = moveIndex(previous, from, to);
    if (next === previous) return;
    this.apply({ relatedItems: next, updatedAt: card.updatedAt });
    this.save(next, undefined, previous);
  }

  move(index: number, delta: number) {
    this.reorder(index, index + delta);
  }

  private relatedItemsForPatch(card: Item, relatedItems: RelatedItem[]): RelatedItem[] {
    return relatedItems.map((row) => {
      if (row.kind !== 'item') return row;
      if (row.projectId && row.projectId > 0) return row;
      return { ...row, projectId: card.projectId };
    });
  }

  private save(relatedItems: RelatedItem[], onSuccess?: () => void, previous?: RelatedItem[]) {
    const card = this.current();
    if (!card || !this.cancel$) return;
    this.saving.set(true);
    this.markDirty();
    this.reportError('');
    this.api
      .updateItem(card.id, { relatedItems: this.relatedItemsForPatch(card, relatedItems) })
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
        error: (error) => {
          if (previous) {
            this.apply({
              relatedItems: previous,
              updatedAt: this.current()?.updatedAt ?? card.updatedAt,
            });
          }
          this.reportError(errorMessage(error));
        },
      });
  }
}
