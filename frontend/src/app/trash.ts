import { ActiveProjectName } from './active-project-name';
import { DatePipe } from '@angular/common';
import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription, finalize } from 'rxjs';
import { Api, TrashItem } from './api';
import { errorMessage } from './api-error';
import { Modal } from './modal';
import { formatItemNumber } from './item-number';
import { ProjectSession } from './project-session';
import { bindProjectSwitchReload } from './project-switch-reload';

const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Remaining whole days until purge (ceil). 0 when expired/at boundary. */
export function trashRemainingDays(deletedAt: string | Date, now = Date.now()): number {
  const deleted = typeof deletedAt === 'string' ? Date.parse(deletedAt) : deletedAt.getTime();
  if (Number.isNaN(deleted)) return 0;
  const left = deleted + TRASH_RETENTION_MS - now;
  if (left <= 0) return 0;
  return Math.ceil(left / (24 * 60 * 60 * 1000));
}

@Component({
  selector: 'app-trash',
  imports: [RouterLink, Modal, DatePipe, ActiveProjectName],
  templateUrl: './trash.html',
  styleUrl: './trash.css',
})
export class Trash implements OnInit {
  readonly formatItemNumber = formatItemNumber;
  readonly remainingDays = trashRemainingDays;

  private readonly api = inject(Api);
  private readonly projectSession = inject(ProjectSession);
  private readonly destroyRef = inject(DestroyRef);

  readonly projectSwitching = computed(() => this.projectSession.switching());
  private loadGeneration = 0;
  private actionGeneration = 0;
  private projectSwitchSub?: Subscription;

  readonly items = signal<TrashItem[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly busyId = signal<number | null>(null);
  readonly confirmHardDelete = signal<TrashItem | null>(null);
  readonly actionError = signal('');

  ngOnInit() {
    this.load();
    bindProjectSwitchReload(this.projectSession, this.destroyRef, () => this.reloadForProjectSwitch());
    this.destroyRef.onDestroy(() => {
      this.projectSwitchSub?.unsubscribe();
      this.loadGeneration++;
      this.actionGeneration++;
    });
  }

  load() {
    const generation = ++this.loadGeneration;
    this.loading.set(true);
    this.error.set('');
    this.actionError.set('');
    const projectId = this.projectSession.activeId() ?? undefined;
    this.api
      .listTrash(projectId)
      .pipe(
        finalize(() => {
          if (generation === this.loadGeneration) this.loading.set(false);
        }),
      )
      .subscribe({
        next: (res) => {
          if (generation !== this.loadGeneration) return;
          this.items.set(res.items ?? []);
          this.error.set('');
          this.projectSession.endSwitch();
        },
        error: (err) => {
          if (generation !== this.loadGeneration) return;
          this.items.set([]);
          this.error.set(errorMessage(err));
          this.projectSession.endSwitch();
        },
      });
  }

  /** @internal project-switch reload (generation-guarded). */
  reloadForProjectSwitch() {
    this.projectSwitchSub?.unsubscribe();
    const generation = ++this.loadGeneration;
    ++this.actionGeneration;
    this.busyId.set(null);
    this.confirmHardDelete.set(null);
    this.loading.set(true);
    this.error.set('');
    this.actionError.set('');
    const projectId = this.projectSession.activeId() ?? undefined;
    this.projectSwitchSub = this.api.listTrash(projectId).subscribe({
      next: (res) => {
        if (generation !== this.loadGeneration) return;
        this.items.set(res.items ?? []);
        this.loading.set(false);
        this.projectSession.endSwitch();
      },
      error: (err) => {
        if (generation !== this.loadGeneration) return;
        this.items.set([]);
        this.error.set(errorMessage(err));
        this.loading.set(false);
        this.projectSession.endSwitch();
      },
    });
  }

  restore(item: TrashItem) {
    if (this.busyId() !== null || this.projectSwitching()) return;
    const generation = ++this.actionGeneration;
    const projectId = this.projectSession.activeId() ?? undefined;
    this.busyId.set(item.id);
    this.actionError.set('');
    this.api
      .restoreItem(item.id, projectId)
      .pipe(
        finalize(() => {
          if (generation === this.actionGeneration) this.busyId.set(null);
        }),
      )
      .subscribe({
        next: () => {
          if (generation !== this.actionGeneration) return;
          this.items.update((rows) => rows.filter((r) => r.id !== item.id));
        },
        error: (err) => {
          if (generation !== this.actionGeneration) return;
          this.actionError.set(errorMessage(err));
        },
      });
  }

  askHardDelete(item: TrashItem) {
    if (this.busyId() !== null || this.projectSwitching()) return;
    this.confirmHardDelete.set(item);
  }

  cancelHardDelete() {
    if (this.busyId() !== null) return;
    this.confirmHardDelete.set(null);
  }

  confirmHardDeleteNow() {
    const item = this.confirmHardDelete();
    if (!item || this.busyId() !== null || this.projectSwitching()) return;
    const generation = ++this.actionGeneration;
    const projectId = this.projectSession.activeId() ?? undefined;
    this.busyId.set(item.id);
    this.actionError.set('');
    this.api
      .hardDeleteTrashItem(item.id, projectId)
      .pipe(
        finalize(() => {
          if (generation === this.actionGeneration) this.busyId.set(null);
        }),
      )
      .subscribe({
        next: () => {
          if (generation !== this.actionGeneration) return;
          this.confirmHardDelete.set(null);
          this.items.update((rows) => rows.filter((r) => r.id !== item.id));
        },
        error: (err) => {
          if (generation !== this.actionGeneration) return;
          this.actionError.set(errorMessage(err));
        },
      });
  }
}
