import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription, finalize } from 'rxjs';
import { Api, RecurringRule } from './api';
import { errorMessage } from './api-error';
import { Modal } from './modal';
import { Column } from './models';
import { ProjectSession } from './project-session';
import { bindProjectSwitchReload } from './project-switch-reload';
import { RecurringSession } from './recurring-session';

@Component({
  selector: 'app-recurring',
  imports: [RouterLink, FormsModule, ReactiveFormsModule, Modal],
  templateUrl: './recurring.html',
  styleUrl: './recurring.css',
})
export class RecurringPage implements OnInit {
  readonly session = inject(RecurringSession);
  private readonly api = inject(Api);
  private readonly projectSession = inject(ProjectSession);
  private readonly destroyRef = inject(DestroyRef);

  readonly projectSwitching = computed(() => this.projectSession.switching());
  readonly columns = signal<Column[]>([]);
  readonly actionError = signal('');
  readonly busy = signal(false);
  readonly editorOpen = signal(false);
  readonly editing = signal<RecurringRule | null>(null);
  readonly confirmDelete = signal<RecurringRule | null>(null);
  readonly pageBusy = computed(
    () => this.busy() || this.projectSwitching() || this.session.loading(),
  );

  /** Sync re-entry lock (L-653); set before signal/UI busy can flush. */
  private actionLocked = false;
  private columnsSub?: Subscription;

  readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    title: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    description: new FormControl('', { nonNullable: true }),
    // Defaults match BE defaultRecurringTZ / create omit behavior.
    cron: new FormControl('0 9 * * 1', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    timezone: new FormControl('Asia/Tokyo', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    columnId: new FormControl<number | null>(null, { validators: [Validators.required] }),
    enabled: new FormControl(true, { nonNullable: true }),
  });

  ngOnInit() {
    this.load();
    this.loadColumns();
    bindProjectSwitchReload(this.projectSession, this.destroyRef, () =>
      this.reloadForProjectSwitch(),
    );
    this.destroyRef.onDestroy(() => {
      this.columnsSub?.unsubscribe();
      this.session.clear();
      this.actionLocked = false;
    });
  }

  columnName(columnId: number): string {
    return this.columns().find((c) => c.id === columnId)?.name ?? `列 #${columnId}`;
  }

  load() {
    this.session.load();
  }

  openCreate() {
    if (this.pageBusy() || this.editorOpen() || this.confirmDelete()) return;
    this.editing.set(null);
    this.actionError.set('');
    const firstCol = this.columns()[0]?.id ?? null;
    this.form.reset({
      name: '',
      title: '',
      description: '',
      cron: '0 9 * * 1',
      timezone: 'Asia/Tokyo',
      columnId: firstCol,
      enabled: true,
    });
    this.editorOpen.set(true);
  }

  openEdit(rule: RecurringRule) {
    if (this.pageBusy() || this.editorOpen() || this.confirmDelete()) return;
    this.editing.set(rule);
    this.actionError.set('');
    this.form.reset({
      name: rule.name,
      title: rule.title,
      description: rule.description,
      cron: rule.cron,
      timezone: rule.timezone,
      columnId: rule.columnId,
      enabled: rule.enabled,
    });
    this.editorOpen.set(true);
  }

  closeEditor() {
    if (this.busy()) return;
    this.editorOpen.set(false);
    this.editing.set(null);
  }

  save() {
    if (this.actionLocked || this.busy() || this.projectSwitching()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.actionLocked = true;
    this.busy.set(true);
    this.actionError.set('');
    const v = this.form.getRawValue();
    const columnId = v.columnId;
    if (columnId == null) {
      this.actionLocked = false;
      this.busy.set(false);
      return;
    }
    const body = {
      name: v.name.trim(),
      title: v.title.trim(),
      description: v.description,
      cron: v.cron.trim(),
      timezone: v.timezone.trim(),
      columnId,
      enabled: v.enabled,
    };
    const editing = this.editing();
    const req = editing
      ? this.session.patch(editing.id, body)
      : this.session.create(body);
    req
      .pipe(
        finalize(() => {
          this.actionLocked = false;
          this.busy.set(false);
        }),
      )
      .subscribe({
        next: () => {
          this.editorOpen.set(false);
          this.editing.set(null);
        },
        error: (err) => this.actionError.set(errorMessage(err)),
      });
  }

  toggleEnabled(rule: RecurringRule) {
    if (this.actionLocked || this.busy() || this.projectSwitching()) return;
    if (this.editorOpen() || this.confirmDelete()) return;
    this.actionLocked = true;
    this.busy.set(true);
    this.actionError.set('');
    this.session
      .patch(rule.id, { enabled: !rule.enabled })
      .pipe(
        finalize(() => {
          this.actionLocked = false;
          this.busy.set(false);
        }),
      )
      .subscribe({
        error: (err) => this.actionError.set(errorMessage(err)),
      });
  }

  askDelete(rule: RecurringRule, event?: Event) {
    if (this.ignoreRepeatOrDouble(event)) return;
    if (this.pageBusy() || this.editorOpen() || this.confirmDelete()) return;
    this.confirmDelete.set(rule);
  }

  cancelDelete(event?: Event) {
    if (this.ignoreRepeatOrDouble(event)) return;
    if (this.busy()) return;
    this.confirmDelete.set(null);
  }

  confirmDeleteNow(event?: Event) {
    if (this.ignoreRepeatOrDouble(event)) return;
    const rule = this.confirmDelete();
    if (!rule || this.actionLocked || this.busy() || this.projectSwitching()) return;
    this.actionLocked = true;
    this.busy.set(true);
    this.actionError.set('');
    this.session
      .delete(rule.id)
      .pipe(
        finalize(() => {
          this.actionLocked = false;
          this.busy.set(false);
        }),
      )
      .subscribe({
        next: () => this.confirmDelete.set(null),
        error: (err) => this.actionError.set(errorMessage(err)),
      });
  }

  /** @internal project-switch reload: UI reset only; list fetch lives in RecurringSession. */
  reloadForProjectSwitch() {
    this.columnsSub?.unsubscribe();
    this.actionLocked = false;
    this.busy.set(false);
    this.editorOpen.set(false);
    this.editing.set(null);
    this.confirmDelete.set(null);
    this.actionError.set('');
    this.loadColumns();
    this.session.reloadForProjectSwitch(() => this.projectSession.endSwitch());
  }

  private loadColumns() {
    this.columnsSub?.unsubscribe();
    this.columnsSub = this.api.board().subscribe({
      next: (board) => {
        this.columns.set(board.columns ?? []);
        const col = this.form.controls.columnId.value;
        if (col == null && board.columns?.length) {
          this.form.controls.columnId.setValue(board.columns[0].id);
        }
      },
      error: () => {
        this.columns.set([]);
      },
    });
  }

  private ignoreRepeatOrDouble(event?: Event): boolean {
    if (!event) return false;
    if (event instanceof KeyboardEvent && event.repeat) return true;
    if (event instanceof MouseEvent && event.detail > 1) return true;
    return false;
  }
}
