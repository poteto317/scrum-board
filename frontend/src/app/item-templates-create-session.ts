import { DestroyRef, Injectable, WritableSignal, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { finalize } from 'rxjs';
import { Api } from './api';
import { errorMessage } from './api-error';
import { textLimit } from './form-validation';
import {
  ITEM_TEMPLATE_CREATE_SUCCESS,
  ITEM_TEMPLATE_DELETE_CONFIRM,
  ITEM_TEMPLATE_DELETE_SUCCESS,
  ITEM_TEMPLATE_LIST_LOAD_FAILURE,
  ITEM_TEMPLATE_UPDATE_SUCCESS,
  ItemTemplate,
  applyItemTemplate,
} from './item-template';

/** Load/apply/CRUD helpers for the item-create dialog (board & backlog). */
@Injectable()
export class ItemTemplatesCreateSession {
  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);
  readonly templates = signal<ItemTemplate[]>([]);
  readonly listError = signal('');
  readonly listLoading = signal(false);
  readonly manageOpen = signal(false);
  readonly adminMessage = signal('');
  readonly editingId = signal<number | null>(null);
  readonly selectedId = signal<number | null>(null);
  private loadGeneration = 0;

  readonly createForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [textLimit(60, true)] }),
    titleTemplate: new FormControl('', { nonNullable: true, validators: [textLimit(200, true)] }),
    descriptionTemplate: new FormControl('', {
      nonNullable: true,
      validators: [textLimit(10000)],
    }),
  });
  readonly editForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [textLimit(60, true)] }),
    titleTemplate: new FormControl('', { nonNullable: true, validators: [textLimit(200, true)] }),
    descriptionTemplate: new FormControl('', {
      nonNullable: true,
      validators: [textLimit(10000)],
    }),
  });

  resetSelection() {
    this.selectedId.set(null);
    this.manageOpen.set(false);
    this.editingId.set(null);
    this.adminMessage.set('');
    this.createForm.reset({ name: '', titleTemplate: '', descriptionTemplate: '' });
  }

  load(projectId: number | null | undefined) {
    if (projectId == null || projectId <= 0) {
      this.templates.set([]);
      this.listError.set('');
      this.listLoading.set(false);
      return;
    }
    const generation = ++this.loadGeneration;
    this.listLoading.set(true);
    this.listError.set('');
    this.api
      .listItemTemplates(projectId)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          if (generation === this.loadGeneration) this.listLoading.set(false);
        }),
      )
      .subscribe({
        next: (res) => {
          if (generation !== this.loadGeneration) return;
          this.listError.set('');
          this.templates.set(res?.templates ?? []);
        },
        error: () => {
          if (generation !== this.loadGeneration) return;
          this.templates.set([]);
          this.listError.set(ITEM_TEMPLATE_LIST_LOAD_FAILURE);
        },
      });
  }

  appliedFields(): { title: string; description: string } {
    const id = this.selectedId();
    if (id == null) return applyItemTemplate(null);
    const t = this.templates().find((x) => x.id === id) ?? null;
    return applyItemTemplate(t);
  }

  onSelect(raw: string) {
    if (!raw) {
      this.selectedId.set(null);
      return;
    }
    const id = Number(raw);
    this.selectedId.set(Number.isFinite(id) && id > 0 ? id : null);
  }

  toggleManage() {
    this.manageOpen.update((v) => !v);
    this.adminMessage.set('');
  }

  startEdit(t: ItemTemplate) {
    this.editingId.set(t.id);
    this.editForm.setValue({
      name: t.name,
      titleTemplate: t.titleTemplate,
      descriptionTemplate: t.descriptionTemplate,
    });
  }

  cancelEdit() {
    this.editingId.set(null);
  }

  create(projectId: number, saving: WritableSignal<boolean>) {
    if (saving() || this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }
    saving.set(true);
    this.adminMessage.set('');
    const value = this.createForm.getRawValue();
    this.api
      .createItemTemplate(projectId, value)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => saving.set(false)),
      )
      .subscribe({
        next: () => {
          this.createForm.reset({ name: '', titleTemplate: '', descriptionTemplate: '' });
          this.adminMessage.set(ITEM_TEMPLATE_CREATE_SUCCESS);
          this.load(projectId);
        },
        error: (e) => this.adminMessage.set(errorMessage(e)),
      });
  }

  update(projectId: number, id: number, saving: WritableSignal<boolean>) {
    if (saving() || this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }
    saving.set(true);
    this.adminMessage.set('');
    const value = this.editForm.getRawValue();
    this.api
      .updateItemTemplate(projectId, id, value)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => saving.set(false)),
      )
      .subscribe({
        next: () => {
          this.editingId.set(null);
          this.adminMessage.set(ITEM_TEMPLATE_UPDATE_SUCCESS);
          this.load(projectId);
        },
        error: (e) => this.adminMessage.set(errorMessage(e)),
      });
  }

  remove(
    projectId: number,
    id: number,
    saving: WritableSignal<boolean>,
    confirmFn: (msg: string) => boolean = (m) => confirm(m),
  ) {
    if (saving()) return;
    if (!confirmFn(ITEM_TEMPLATE_DELETE_CONFIRM)) return;
    saving.set(true);
    this.adminMessage.set('');
    this.api
      .deleteItemTemplate(projectId, id)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => saving.set(false)),
      )
      .subscribe({
        next: () => {
          if (this.selectedId() === id) this.selectedId.set(null);
          if (this.editingId() === id) this.editingId.set(null);
          this.adminMessage.set(ITEM_TEMPLATE_DELETE_SUCCESS);
          this.load(projectId);
        },
        error: (e) => this.adminMessage.set(errorMessage(e)),
      });
  }
}
