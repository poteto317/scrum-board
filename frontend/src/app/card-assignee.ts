import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Observable, finalize, takeUntil } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Api } from './api';
import { errorMessage } from './api-error';
import { validAssignee } from './assignee';
import { Card } from './models';

/** Immediate assignee PATCH — separate from title/description autosave. */
@Injectable()
export class CardAssignee {
  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);
  readonly saving = signal(false);
  readonly draft = new FormControl('', { nonNullable: true });
  private cancel$?: Observable<unknown>;
  private apply!: (updated: Pick<Card, 'assignee' | 'updatedAt'>) => void;
  private reportError!: (message: string) => void;
  private current!: () => Card | null;

  bind(opts: {
    card: () => Card | null;
    applyAssigneeSave: (updated: Pick<Card, 'assignee' | 'updatedAt'>) => void;
    onError: (message: string) => void;
    cancel$: Observable<unknown>;
  }) {
    this.current = opts.card;
    this.apply = opts.applyAssigneeSave;
    this.reportError = opts.onError;
    this.cancel$ = opts.cancel$;
  }

  reset() {
    this.draft.reset('', { emitEvent: false });
    this.saving.set(false);
  }

  selectPreset(name: string) {
    const card = this.current();
    if (!card || this.saving()) return;
    if (card.assignee === name) {
      this.draft.reset('', { emitEvent: false });
      return;
    }
    this.save(name, () => this.draft.reset('', { emitEvent: false }));
  }

  applyDraft() {
    const card = this.current();
    if (!card || this.saving()) return;
    const value = this.draft.value.trim();
    if (!value) return; // clear only via clear()
    if (!validAssignee(value)) {
      this.reportError('対応者は60文字以内で、制御文字を含めず入力してください。');
      return;
    }
    if (value === card.assignee) return;
    this.save(value, () => this.draft.reset('', { emitEvent: false }));
  }

  clear() {
    const card = this.current();
    if (!card || this.saving() || !card.assignee) return;
    this.save('', () => this.draft.reset('', { emitEvent: false }));
  }

  private save(assignee: string, onSuccess?: () => void) {
    const card = this.current();
    if (!card || !this.cancel$) return;
    this.saving.set(true);
    this.draft.disable({ emitEvent: false });
    this.reportError('');
    const draftAtSend = this.draft.value;
    this.api
      .updateCard(card.id, { assignee })
      .pipe(
        takeUntil(this.cancel$),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.saving.set(false);
          this.draft.enable({ emitEvent: false });
        }),
      )
      .subscribe({
        next: (updated) => {
          this.apply({ assignee: updated.assignee ?? '', updatedAt: updated.updatedAt });
          if (this.draft.value === draftAtSend) onSuccess?.();
        },
        error: (error) => this.reportError(errorMessage(error)),
      });
  }
}
