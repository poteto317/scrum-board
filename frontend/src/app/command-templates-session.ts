import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { finalize } from 'rxjs';
import { Api } from './api';
import { errorMessage } from './api-error';
import { CommandTemplate } from './command-template';

export const COMMAND_LIST_LOAD_FAILURE = 'コマンド一覧を読み込めませんでした';
export const COMMAND_CREATE_SUCCESS = 'コマンドを追加しました';
export const COMMAND_UPDATE_SUCCESS = 'コマンドを更新しました';
export const COMMAND_DELETE_SUCCESS = 'コマンドを削除しました';

/** Command-template list and admin CRUD, shared by the board menu and card detail. */
@Injectable()
export class CommandTemplatesSession {
  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);
  readonly templates = signal<CommandTemplate[]>([]);
  readonly listError = signal('');
  readonly adminMessage = signal('');
  readonly saving = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly createForm = new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    template: new FormControl('', { nonNullable: true }),
  });
  readonly editForm = new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    template: new FormControl('', { nonNullable: true }),
  });
  /** Bumped on each load and on a successful create/update/delete so an older list response cannot overwrite local edits. */
  private loadGeneration = 0;

  load() {
    const generation = ++this.loadGeneration;
    this.api
      .listCommandTemplates()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (generation !== this.loadGeneration) return;
          this.listError.set('');
          this.templates.set(res?.templates ?? []);
        },
        error: () => {
          if (generation !== this.loadGeneration) return;
          this.templates.set([]);
          this.listError.set(COMMAND_LIST_LOAD_FAILURE);
        },
      });
  }

  private invalidateLoad() {
    this.loadGeneration++;
  }

  create() {
    if (this.saving()) return;
    const { name, template } = this.createForm.getRawValue();
    this.saving.set(true);
    this.adminMessage.set('');
    this.api
      .createCommandTemplate({ name, template })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: (created) => {
          this.invalidateLoad();
          this.listError.set('');
          this.templates.update((list) => [...list, created]);
          this.createForm.reset();
          this.adminMessage.set(COMMAND_CREATE_SUCCESS);
        },
        error: (error) => this.adminMessage.set(errorMessage(error)),
      });
  }

  update(id: number) {
    if (this.saving()) return;
    const { name, template } = this.editForm.getRawValue();
    this.saving.set(true);
    this.adminMessage.set('');
    this.api
      .updateCommandTemplate(id, { name, template })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: (updated) => {
          this.invalidateLoad();
          this.templates.update((list) => list.map((item) => (item.id === id ? updated : item)));
          this.editingId.set(null);
          this.adminMessage.set(COMMAND_UPDATE_SUCCESS);
        },
        error: (error) => this.adminMessage.set(errorMessage(error)),
      });
  }

  delete(id: number) {
    if (this.saving()) return;
    this.saving.set(true);
    this.adminMessage.set('');
    this.api
      .deleteCommandTemplate(id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: () => {
          this.invalidateLoad();
          this.templates.update((list) => list.filter((item) => item.id !== id));
          if (this.editingId() === id) this.editingId.set(null);
          this.adminMessage.set(COMMAND_DELETE_SUCCESS);
        },
        error: (error) => this.adminMessage.set(errorMessage(error)),
      });
  }

  startEdit(template: CommandTemplate) {
    this.editingId.set(template.id);
    this.editForm.setValue({ name: template.name, template: template.template });
  }

  cancelEdit() {
    this.editingId.set(null);
  }
}
