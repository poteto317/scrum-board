import { ActiveProjectName } from './active-project-name';
import { DatePipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription, finalize } from 'rxjs';
import { Api } from './api';
import { errorMessage } from './api-error';
import { formatItemNumber } from './item-number';
import { normalizeItem } from './board-data';
import { ProjectSession } from './project-session';
import { bindProjectSwitchReload } from './project-switch-reload';

@Component({
  selector: 'app-archive',
  imports: [RouterLink, DatePipe, ActiveProjectName],
  templateUrl: './archive.html',
  styleUrl: './archive.css',
})
export class Archive implements OnInit {
  readonly formatItemNumber = formatItemNumber;

  private readonly api = inject(Api);
  private readonly projectSession = inject(ProjectSession);
  private readonly destroyRef = inject(DestroyRef);

  readonly projectSwitching = computed(() => this.projectSession.switching());
  readonly items = signal<ReturnType<typeof normalizeItem>[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly busyId = signal<number | null>(null);
  readonly actionError = signal('');

  private loadGeneration = 0;
  private actionGeneration = 0;
  private projectSwitchSub?: Subscription;

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
    this.api
      .listArchivedItems(this.projectSession.activeId() ?? undefined)
      .pipe(
        finalize(() => {
          if (generation === this.loadGeneration) this.loading.set(false);
        }),
      )
      .subscribe({
        next: (res) => {
          if (generation !== this.loadGeneration) return;
          this.items.set((res.items ?? []).map((item) => normalizeItem(item)));
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

  /** @internal project-switch reload with stale-response protection. */
  reloadForProjectSwitch() {
    this.projectSwitchSub?.unsubscribe();
    const generation = ++this.loadGeneration;
    ++this.actionGeneration;
    this.busyId.set(null);
    this.loading.set(true);
    this.error.set('');
    this.actionError.set('');
    this.projectSwitchSub = this.api
      .listArchivedItems(this.projectSession.activeId() ?? undefined)
      .subscribe({
        next: (res) => {
          if (generation !== this.loadGeneration) return;
          this.items.set((res.items ?? []).map((item) => normalizeItem(item)));
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

  restore(item: ReturnType<typeof normalizeItem>) {
    if (this.busyId() !== null || this.projectSwitching()) return;
    const generation = ++this.actionGeneration;
    this.busyId.set(item.id);
    this.actionError.set('');
    this.api
      .restoreArchivedItem(item.id, this.projectSession.activeId() ?? undefined)
      .pipe(
        finalize(() => {
          if (generation === this.actionGeneration) this.busyId.set(null);
        }),
      )
      .subscribe({
        next: () => {
          if (generation !== this.actionGeneration) return;
          this.items.update((rows) => rows.filter((row) => row.id !== item.id));
        },
        error: (err) => {
          if (generation !== this.actionGeneration) return;
          this.actionError.set(errorMessage(err));
        },
      });
  }
}
