import { ActiveProjectName } from './active-project-name';
import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription, finalize } from 'rxjs';
import { Api } from './api';
import { errorMessage } from './api-error';
import { textLimit } from './form-validation';
import { Modal } from './modal';
import {
  SPRINT_NAME_MAX,
  SprintSummary,
  sprintStatusLabel,
} from './models';
import { ProjectSession } from './project-session';
import { bindProjectSwitchReload } from './project-switch-reload';
import { validateSprintMetaForSave } from './sprint-meta';

@Component({
  selector: 'app-sprints',
  imports: [RouterLink, ReactiveFormsModule, Modal, ActiveProjectName],
  templateUrl: './sprints.html',
  styleUrl: './sprints.css',
})
export class Sprints implements OnInit {
  readonly statusLabel = sprintStatusLabel;

  private readonly api = inject(Api);
  private readonly projectSession = inject(ProjectSession);
  private readonly destroyRef = inject(DestroyRef);

  readonly projectSwitching = computed(() => this.projectSession.switching());
  private loadGeneration = 0;
  private createGeneration = 0;
  private projectSwitchSub?: Subscription;

  readonly sprints = signal<SprintSummary[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly createOpen = signal(false);
  readonly creating = signal(false);
  readonly formError = signal('');

  readonly createForm = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [textLimit(SPRINT_NAME_MAX, true)],
    }),
    startDate: new FormControl('', { nonNullable: true }),
    endDate: new FormControl('', { nonNullable: true }),
  });

  ngOnInit() {
    this.load();
    bindProjectSwitchReload(this.projectSession, this.destroyRef, () =>
      this.reloadForProjectSwitch(),
    );
    this.destroyRef.onDestroy(() => {
      this.projectSwitchSub?.unsubscribe();
      this.loadGeneration++;
      this.createGeneration++;
    });
  }

  load() {
    this.fetchSprintList(false);
  }

  /** @internal project-switch reload (generation-guarded). */
  reloadForProjectSwitch() {
    this.fetchSprintList(true);
  }

  private fetchSprintList(projectSwitch: boolean) {
    if (projectSwitch) {
      this.projectSwitchSub?.unsubscribe();
    }
    const generation = ++this.loadGeneration;
    if (projectSwitch) {
      ++this.createGeneration;
      this.createOpen.set(false);
      this.creating.set(false);
      this.formError.set('');
    }
    this.loading.set(true);
    this.error.set('');
    const projectId = this.projectSession.activeId() ?? undefined;
    const req = this.api.listSprints(projectId).pipe(
      finalize(() => {
        if (generation === this.loadGeneration) this.loading.set(false);
      }),
    );
    const sub = req.subscribe({
      next: (res) => {
        if (generation !== this.loadGeneration) return;
        this.sprints.set(res.sprints ?? []);
        this.error.set('');
        this.projectSession.endSwitch();
      },
      error: (err) => {
        if (generation !== this.loadGeneration) return;
        this.sprints.set([]);
        this.error.set(errorMessage(err));
        this.projectSession.endSwitch();
      },
    });
    if (projectSwitch) {
      this.projectSwitchSub = sub;
    }
  }

  openCreate() {
    if (this.loading() || this.creating() || this.projectSwitching()) return;
    this.createForm.reset({ name: '', startDate: '', endDate: '' });
    this.formError.set('');
    this.createOpen.set(true);
  }

  closeCreate() {
    if (this.creating()) return;
    this.createOpen.set(false);
    this.formError.set('');
  }

  submitCreate() {
    if (this.creating() || this.projectSwitching()) return;
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }
    const { name, startDate, endDate } = this.createForm.getRawValue();
    const trimmed = name.trim();
    if (!trimmed || !startDate || !endDate) {
      this.createForm.markAllAsTouched();
      return;
    }
    const metaError = validateSprintMetaForSave(trimmed, '', startDate, endDate);
    if (metaError) {
      this.formError.set(metaError);
      return;
    }
    const generation = ++this.createGeneration;
    this.creating.set(true);
    this.formError.set('');
    const projectId = this.projectSession.activeId() ?? undefined;
    this.api
      .createSprint({
        name: trimmed,
        startDate,
        endDate,
        projectId,
      })
      .pipe(
        finalize(() => {
          if (generation === this.createGeneration) this.creating.set(false);
        }),
      )
      .subscribe({
        next: (created) => {
          if (generation !== this.createGeneration) return;
          this.createOpen.set(false);
          this.sprints.update((rows) => {
            const next = [
              {
                id: created.id,
                projectId: created.projectId,
                name: created.name,
                goal: created.goal,
                startDate: created.startDate,
                endDate: created.endDate,
                status: created.status,
                velocity: created.velocity,
                itemCount: created.itemCount ?? created.items?.length ?? 0,
                createdAt: created.createdAt,
                updatedAt: created.updatedAt,
              },
              ...rows.filter((r) => r.id !== created.id),
            ];
            return sortSprintSummaries(next);
          });
        },
        error: (err) => {
          if (generation !== this.createGeneration) return;
          this.formError.set(errorMessage(err));
        },
      });
  }
}

/** Match API list order: startDate desc, then id desc. */
export function sortSprintSummaries(rows: SprintSummary[]): SprintSummary[] {
  return [...rows].sort((a, b) => {
    if (a.startDate !== b.startDate) return a.startDate < b.startDate ? 1 : -1;
    return b.id - a.id;
  });
}
