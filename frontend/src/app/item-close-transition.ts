import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Observable, takeUntil } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Api } from './api';
import { errorMessage } from './api-error';
import { normalizeCloseReason } from './close-reason';
import { Column, Item } from './models';

/** Non-Close → Close: reason modal + dedicated PATCH (not ordinary status flush). */
@Injectable()
export class ItemCloseTransition {
  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);
  readonly open = signal(false);
  readonly draft = signal('');
  readonly saving = signal(false);
  private cancel$?: Observable<unknown>;
  private columns!: () => Column[];
  private item!: () => Item | null;
  private columnId!: FormControl<number>;
  private suspendFlush!: (active: boolean) => void;
  private dropInFlight!: () => void;
  private flush!: () => void;
  private apply!: (updated: Item) => void;
  private reportError!: (message: string) => void;

  bind(opts: {
    item: () => Item | null;
    columns: () => Column[];
    columnId: FormControl<number>;
    suspendFlush: (active: boolean) => void;
    dropInFlight: () => void;
    flush: () => void;
    applyCloseSave: (updated: Item) => void;
    onError: (message: string) => void;
    cancel$: Observable<unknown>;
  }) {
    this.item = opts.item;
    this.columns = opts.columns;
    this.columnId = opts.columnId;
    this.suspendFlush = opts.suspendFlush;
    this.dropInFlight = opts.dropInFlight;
    this.flush = opts.flush;
    this.apply = opts.applyCloseSave;
    this.reportError = opts.onError;
    this.cancel$ = opts.cancel$;
  }

  reset() {
    this.suspendFlush(false);
    this.open.set(false);
    this.draft.set('');
    this.saving.set(false);
  }

  isCloseColumn(columnId: number): boolean {
    return this.columns().some((c) => c.id === columnId && c.name === 'Close');
  }

  showingReasonField(): boolean {
    const card = this.item();
    return !!card && this.isCloseColumn(card.columnId);
  }

  /** Status select change: gate Close entry behind the reason modal. */
  onStatusChange() {
    const card = this.item();
    if (!card) return;
    const nextId = this.columnId.value;
    if (this.isCloseColumn(nextId) && !this.isCloseColumn(card.columnId)) {
      this.suspendFlush(true);
      this.draft.set(card.closeReason ?? '');
      this.open.set(true);
      return;
    }
    this.flush();
  }

  cancel() {
    if (this.saving()) return;
    const card = this.item();
    if (card) this.columnId.setValue(card.columnId, { emitEvent: false });
    this.resetModal();
  }

  confirm() {
    const card = this.item();
    if (!card || this.saving() || !this.cancel$) return;
    const reason = normalizeCloseReason(this.draft());
    if (reason === null) {
      this.reportError('Close理由は2000文字以内で入力してください。');
      return;
    }
    const closeId = this.columnId.value;
    const prevCol = card.columnId;
    // Ignore any in-flight title/description flush so its response cannot rewind Close.
    this.dropInFlight();
    this.saving.set(true);
    this.reportError('');
    this.api
      .updateItem(card.id, { columnId: closeId, closeReason: reason })
      .pipe(takeUntil(this.cancel$), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.resetModal();
          this.apply(updated);
        },
        error: (err) => this.rollback(prevCol, errorMessage(err)),
      });
  }

  private rollback(prevCol: number, message: string) {
    this.columnId.setValue(prevCol, { emitEvent: false });
    this.resetModal();
    this.reportError(message);
  }

  private resetModal() {
    this.suspendFlush(false);
    this.open.set(false);
    this.saving.set(false);
    this.draft.set('');
  }
}
