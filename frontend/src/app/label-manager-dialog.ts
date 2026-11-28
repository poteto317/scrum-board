import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Observable, finalize } from 'rxjs';
import { errorMessage } from './api-error';
import { textLimit } from './form-validation';
import {
  DEFAULT_LABEL_COLOR,
  LABEL_COLOR_PRESETS,
  LABEL_NAME_MAX,
  Label,
  LabelInput,
  validateLabelInput,
} from './label';
import { LabelsSession } from './labels-session';
import { Modal } from './modal';

type LabelManagerForm = FormGroup<{
  name: FormControl<string>;
  color: FormControl<string>;
}>;

function createLabelForm(): LabelManagerForm {
  return new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [textLimit(LABEL_NAME_MAX, true)],
    }),
    color: new FormControl<string>(DEFAULT_LABEL_COLOR, { nonNullable: true }),
  });
}

@Component({
  selector: 'app-label-manager-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, Modal],
  templateUrl: './label-manager-dialog.html',
  styleUrl: './label-manager-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LabelManagerDialog implements OnInit {
  readonly labelsSession = inject(LabelsSession);
  readonly closed = output<void>();

  readonly presets = LABEL_COLOR_PRESETS;
  readonly maxNameLength = LABEL_NAME_MAX;
  readonly saving = signal(false);
  readonly editingId = signal<number | null>(null);
  readonly deletingId = signal<number | null>(null);
  readonly actionError = signal('');

  readonly createForm = createLabelForm();
  readonly editForm = createLabelForm();

  ngOnInit(): void {
    this.labelsSession.load();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  close(): void {
    if (this.saving()) return;
    this.resetDrafts();
    this.closed.emit();
  }

  resetDrafts(): void {
    this.createForm.reset({ name: '', color: DEFAULT_LABEL_COLOR });
    this.editForm.reset({ name: '', color: DEFAULT_LABEL_COLOR });
    this.editingId.set(null);
    this.deletingId.set(null);
    this.actionError.set('');
  }

  selectFormColor(form: LabelManagerForm, color: string): void {
    if (this.saving()) return;
    form.controls.color.setValue(color);
  }

  submitCreate(): void {
    if (this.saving() || !this.labelsSession.loaded()) return;
    const input = this.validateFormAndSetError(this.createForm);
    if (!input) return;
    this.runLabelMutation(
      this.labelsSession.create(input),
      'ラベルの作成に失敗しました。',
      () => {
        this.createForm.reset({ name: '', color: DEFAULT_LABEL_COLOR });
        this.actionError.set('');
      },
    );
  }

  startEdit(label: Label): void {
    if (this.saving()) return;
    this.deletingId.set(null);
    this.actionError.set('');
    this.editingId.set(label.id);
    this.editForm.reset({ name: label.name, color: label.color });
  }

  cancelEdit(): void {
    if (this.saving()) return;
    this.editingId.set(null);
    this.actionError.set('');
    this.editForm.reset({ name: '', color: DEFAULT_LABEL_COLOR });
  }

  submitEdit(id: number): void {
    if (this.saving()) return;
    const input = this.validateFormAndSetError(this.editForm);
    if (!input) return;
    this.runLabelMutation(
      this.labelsSession.update(id, input),
      'ラベルの更新に失敗しました。',
      () => {
        this.editingId.set(null);
        this.editForm.reset({ name: '', color: DEFAULT_LABEL_COLOR });
        this.actionError.set('');
      },
    );
  }

  requestDelete(id: number): void {
    if (this.saving()) return;
    this.actionError.set('');
    this.deletingId.set(id);
  }

  cancelDelete(): void {
    if (this.saving()) return;
    this.deletingId.set(null);
  }

  confirmDelete(id: number): void {
    if (this.saving()) return;
    this.actionError.set('');
    this.runLabelMutation(
      this.labelsSession.remove(id),
      'ラベルの削除に失敗しました。',
      () => {
        this.deletingId.set(null);
        if (this.editingId() === id) {
          this.editingId.set(null);
          this.editForm.reset({ name: '', color: DEFAULT_LABEL_COLOR });
        }
      },
    );
  }

  private validateFormAndSetError(form: LabelManagerForm): LabelInput | null {
    form.markAllAsTouched();
    this.actionError.set('');
    const result = validateLabelInput(form.controls.name.value, form.controls.color.value);
    if (form.invalid) {
      this.actionError.set(`ラベル名は1〜${LABEL_NAME_MAX}文字で入力してください。`);
      return null;
    }
    if (!result.ok) {
      this.actionError.set(result.error);
      return null;
    }
    return result.value;
  }

  private runLabelMutation(
    obs$: Observable<unknown>,
    fallbackError: string,
    onSuccess: () => void,
  ): void {
    this.saving.set(true);
    obs$.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => onSuccess(),
      error: (err: unknown) => {
        this.actionError.set(errorMessage(err) || fallbackError);
      },
    });
  }
}
