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
export const COMMAND_APPLY_ALL_SUCCESS = '全アイテムのコマンド表示を置き換えました';
export const COMMAND_DEFAULTS_SUCCESS = '新規アイテムの初期コマンドを更新しました';
export const COMMAND_APPLY_ALL_CONFIRM =
  'チェックしたコマンドで、すべてのアイテムの表示セットを置き換えます。よろしいですか？';
export const COMMAND_DEFAULTS_CONFIRM =
  'チェックしたコマンドを新規アイテムの初期セットにします。既存アイテムは変わりません。よろしいですか？';

/** Catalog list and admin CRUD for item detail (menus use per-item links). */
@Injectable()
export class CommandTemplatesSession {
  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);
  readonly templates = signal<CommandTemplate[]>([]);
  readonly listError = signal('');
  readonly adminMessage = signal('');
  readonly saving = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly bulkSelectedIds = signal<number[]>([]);
  readonly createForm = new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    template: new FormControl('', { nonNullable: true }),
  });
  readonly editForm = new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    template: new FormControl('', { nonNullable: true }),
  });
  /** Bumped on each load so an older list response cannot overwrite a newer one. */
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
        next: () => {
          this.createForm.reset();
          this.adminMessage.set(COMMAND_CREATE_SUCCESS);
          this.load();
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
        next: () => {
          this.editingId.set(null);
          this.adminMessage.set(COMMAND_UPDATE_SUCCESS);
          this.load();
        },
        error: (error) => this.adminMessage.set(errorMessage(error)),
      });
  }

  delete(id: number, onSuccess?: () => void) {
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
          if (this.editingId() === id) this.editingId.set(null);
          this.bulkSelectedIds.set(this.bulkSelectedIds().filter((x) => x !== id));
          this.adminMessage.set(COMMAND_DELETE_SUCCESS);
          this.load();
          onSuccess?.();
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

  toggleBulk(id: number, checked: boolean) {
    const current = this.bulkSelectedIds();
    if (checked) {
      if (!current.includes(id)) this.bulkSelectedIds.set([...current, id]);
      return;
    }
    this.bulkSelectedIds.set(current.filter((x) => x !== id));
  }

  isBulkSelected(id: number) {
    return this.bulkSelectedIds().includes(id);
  }

  applyToAllItems(
    confirmFn: (message: string) => boolean = (m) => window.confirm(m),
    onSuccess?: () => void,
  ) {
    if (this.saving()) return;
    if (!confirmFn(COMMAND_APPLY_ALL_CONFIRM)) return;
    this.saving.set(true);
    this.adminMessage.set('');
    const ids = this.bulkSelectedIds();
    this.api
      .applyCommandTemplatesToAllItems(ids)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: () => {
          this.adminMessage.set(COMMAND_APPLY_ALL_SUCCESS);
          onSuccess?.();
        },
        error: (error) => this.adminMessage.set(errorMessage(error)),
      });
  }

  setAsDefaults(confirmFn: (message: string) => boolean = (m) => window.confirm(m)) {
    if (this.saving()) return;
    if (!confirmFn(COMMAND_DEFAULTS_CONFIRM)) return;
    this.saving.set(true);
    this.adminMessage.set('');
    const ids = this.bulkSelectedIds();
    this.api
      .replaceCommandTemplateDefaults(ids)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: () => this.adminMessage.set(COMMAND_DEFAULTS_SUCCESS),
        error: (error) => this.adminMessage.set(errorMessage(error)),
      });
  }
}
