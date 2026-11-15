import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { Api } from './api';
import { errorMessage } from './api-error';
import { CommandTemplate } from './command-template';

export const CARD_COMMANDS_SAVE_SUCCESS = 'このカードのコマンドを保存しました';

/** Per-card command selection for card detail (catalog is separate). */
@Injectable()
export class CardCommandsSession {
  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);
  readonly templates = signal<CommandTemplate[]>([]);
  readonly selectedIds = signal<number[]>([]);
  readonly loadError = signal('');
  readonly saveMessage = signal('');
  readonly saving = signal(false);
  readonly loading = signal(false);
  private loadGeneration = 0;
  private cardNumber: number | null = null;

  load(cardNumber: number) {
    this.cardNumber = cardNumber;
    const generation = ++this.loadGeneration;
    this.loading.set(true);
    this.loadError.set('');
    this.saveMessage.set('');
    this.templates.set([]);
    this.selectedIds.set([]);
    this.api
      .listCardCommandTemplatesByNumber(cardNumber)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (generation !== this.loadGeneration || this.cardNumber !== cardNumber) return;
          const list = res?.templates ?? [];
          this.templates.set(list);
          this.selectedIds.set(list.map((t) => t.id));
          this.loadError.set('');
          this.loading.set(false);
        },
        error: (error) => {
          if (generation !== this.loadGeneration || this.cardNumber !== cardNumber) return;
          this.templates.set([]);
          this.selectedIds.set([]);
          this.loadError.set(errorMessage(error));
          this.loading.set(false);
        },
      });
  }

  toggle(id: number, checked: boolean) {
    const current = this.selectedIds();
    if (checked) {
      if (!current.includes(id)) this.selectedIds.set([...current, id]);
      return;
    }
    this.selectedIds.set(current.filter((x) => x !== id));
  }

  isSelected(id: number) {
    return this.selectedIds().includes(id);
  }

  /** True when the checkbox set differs from the last successful load/save. */
  isDirty() {
    const saved = this.templates().map((t) => t.id);
    const selected = this.selectedIds();
    if (saved.length !== selected.length) return true;
    return saved.some((id, i) => id !== selected[i]);
  }

  save() {
    const number = this.cardNumber;
    if (number == null || this.saving() || this.loading() || this.loadError()) return;
    this.saving.set(true);
    this.saveMessage.set('');
    const ids = this.selectedIds();
    this.api
      .replaceCardCommandTemplatesByNumber(number, ids)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: (res) => {
          const list = res?.templates ?? [];
          this.templates.set(list);
          this.selectedIds.set(list.map((t) => t.id));
          this.saveMessage.set(CARD_COMMANDS_SAVE_SUCCESS);
        },
        error: (error) => this.saveMessage.set(errorMessage(error)),
      });
  }
}
