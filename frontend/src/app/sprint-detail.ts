import { ActiveProjectContext } from './active-project-context';
import {
  Component,
  DestroyRef,
  HostListener,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription, finalize, forkJoin } from 'rxjs';
import { Api } from './api';
import { errorMessage } from './api-error';
import { AuthSession } from './auth-session';
import { formatItemNumber } from './item-number';
import { Modal } from './modal';
import { Item, SPRINT_GOAL_MAX_SCALARS, Sprint, sprintStatusLabel } from './models';
import {
  buildSprintMemberCandidates,
  buildSprintMetaPatch,
  sprintMetaDraftFromSprint,
  parseOptionalSprintVelocityInput,
  validateSprintCompleteVelocity,
} from './sprint-detail-helpers';
import { validateSprintMetaForSave } from './sprint-meta';
import { ProjectSession } from './project-session';
import { bindProjectSwitchReload } from './project-switch-reload';

@Component({
  selector: 'app-sprint-detail',
  imports: [RouterLink, ReactiveFormsModule, Modal, ActiveProjectContext],
  templateUrl: './sprint-detail.html',
  styleUrl: './sprint-detail.css',
})
export class SprintDetail implements OnInit {
  readonly formatItemNumber = formatItemNumber;
  readonly statusLabel = sprintStatusLabel;
  readonly goalMax = SPRINT_GOAL_MAX_SCALARS;

  private readonly api = inject(Api);
  private readonly route = inject(ActivatedRoute);
  private readonly projectSession = inject(ProjectSession);
  private readonly auth = inject(AuthSession);
  private readonly destroyRef = inject(DestroyRef);

  readonly projectSwitching = computed(() => this.projectSession.switching());
  private loadGeneration = 0;
  private actionGeneration = 0;
  private projectSwitchSub?: Subscription;
  private routeId = 0;

  readonly sprint = signal<Sprint | null>(null);
  readonly candidates = signal<Item[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly saveError = signal('');
  readonly savingMeta = signal(false);
  readonly savingMembers = signal(false);
  readonly activating = signal(false);
  readonly completing = signal(false);
  readonly savingVelocity = signal(false);
  readonly completeOpen = signal(false);
  readonly completeVelocity = signal(0);
  readonly completeError = signal('');

  /** Drafts live only on this component (L-542). */
  readonly draftName = signal('');
  readonly draftGoal = signal('');
  readonly draftStart = signal('');
  readonly draftEnd = signal('');
  readonly draftVelocity = signal<string>('');
  readonly selectedIds = signal<number[]>([]);
  readonly membersDirty = signal(false);
  readonly metaDirty = signal(false);

  readonly membersEditable = computed(() => {
    const s = this.sprint();
    return !!s && (s.status === 'planned' || s.status === 'active');
  });

  readonly completeForm = new FormGroup({
    velocity: new FormControl(0, { nonNullable: true }),
  });

  ngOnInit() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = Number(params.get('id'));
      this.routeId = Number.isFinite(id) && id > 0 ? id : 0;
      this.load();
    });
    bindProjectSwitchReload(this.projectSession, this.destroyRef, () =>
      this.reloadForProjectSwitch(),
    );
    this.destroyRef.onDestroy(() => {
      this.projectSwitchSub?.unsubscribe();
      this.loadGeneration++;
      this.actionGeneration++;
    });
  }

  load() {
    if (this.routeId <= 0) {
      this.loading.set(false);
      this.error.set('スプリントが見つかりません。');
      this.sprint.set(null);
      return;
    }
    const generation = ++this.loadGeneration;
    this.loading.set(true);
    this.error.set('');
    this.saveError.set('');
    const projectId = this.projectSession.activeId() ?? undefined;
    forkJoin({
      sprint: this.api.getSprint(this.routeId, projectId),
      board: this.api.board(projectId),
    })
      .pipe(
        finalize(() => {
          if (generation === this.loadGeneration) this.loading.set(false);
        }),
      )
      .subscribe({
        next: ({ sprint, board }) => {
          if (generation !== this.loadGeneration) return;
          this.applyLoaded(sprint, board.items ?? []);
          this.projectSession.endSwitch();
        },
        error: (err) => {
          if (generation !== this.loadGeneration) return;
          this.sprint.set(null);
          this.candidates.set([]);
          this.error.set(errorMessage(err));
          this.projectSession.endSwitch();
        },
      });
  }

  /** @internal project-switch reload. */
  reloadForProjectSwitch() {
    this.projectSwitchSub?.unsubscribe();
    const generation = ++this.loadGeneration;
    ++this.actionGeneration;
    this.completeOpen.set(false);
    this.activating.set(false);
    this.completing.set(false);
    this.savingMeta.set(false);
    this.savingMembers.set(false);
    this.savingVelocity.set(false);
    this.loading.set(true);
    this.error.set('');
    this.saveError.set('');
    if (this.routeId <= 0) {
      this.loading.set(false);
      this.projectSession.endSwitch();
      return;
    }
    const projectId = this.projectSession.activeId() ?? undefined;
    this.projectSwitchSub = forkJoin({
      sprint: this.api.getSprint(this.routeId, projectId),
      board: this.api.board(projectId),
    }).subscribe({
      next: ({ sprint, board }) => {
        if (generation !== this.loadGeneration) return;
        this.applyLoaded(sprint, board.items ?? []);
        this.loading.set(false);
        this.projectSession.endSwitch();
      },
      error: (err) => {
        if (generation !== this.loadGeneration) return;
        this.sprint.set(null);
        this.candidates.set([]);
        this.error.set(errorMessage(err));
        this.loading.set(false);
        this.projectSession.endSwitch();
      },
    });
  }

  private applyLoaded(sprint: Sprint, boardItems: Item[]) {
    if (!this.sprintBelongsToActiveProject(sprint)) {
      return;
    }
    this.sprint.set(sprint);
    const draft = sprintMetaDraftFromSprint(sprint);
    this.draftName.set(draft.name);
    this.draftGoal.set(draft.goal);
    this.draftStart.set(draft.startDate);
    this.draftEnd.set(draft.endDate);
    this.draftVelocity.set(draft.velocity);
    this.selectedIds.set((sprint.items ?? []).map((i) => i.id));
    this.membersDirty.set(false);
    this.metaDirty.set(false);
    this.saveError.set('');
    this.candidates.set(
      buildSprintMemberCandidates(
        boardItems,
        this.projectSession.activeId(),
        sprint,
        this.auth.user(),
      ),
    );
  }

  private sprintBelongsToActiveProject(sprint: Sprint): boolean {
    const activeId = this.projectSession.activeId();
    if (activeId == null || activeId <= 0 || sprint.projectId === activeId) {
      return true;
    }
    this.sprint.set(null);
    this.candidates.set([]);
    this.error.set('スプリントが見つかりません。');
    return false;
  }

  private reloadSprint(generation: number, onDone?: () => void) {
    const projectId = this.projectSession.activeId() ?? undefined;
    forkJoin({
      sprint: this.api.getSprint(this.routeId, projectId),
      board: this.api.board(projectId),
    }).subscribe({
      next: ({ sprint, board }) => {
        if (generation !== this.actionGeneration) {
          onDone?.();
          return;
        }
        this.applyLoaded(sprint, board.items ?? []);
        onDone?.();
      },
      error: (err) => {
        if (generation === this.actionGeneration) {
          this.saveError.set(errorMessage(err));
        }
        onDone?.();
      },
    });
  }

  onNameInput(value: string) {
    this.draftName.set(value);
    this.metaDirty.set(true);
  }

  onGoalInput(value: string) {
    this.draftGoal.set(value);
    this.metaDirty.set(true);
  }

  onStartInput(value: string) {
    this.draftStart.set(value);
    this.metaDirty.set(true);
  }

  onEndInput(value: string) {
    this.draftEnd.set(value);
    this.metaDirty.set(true);
  }

  onVelocityInput(value: string) {
    this.draftVelocity.set(value);
    this.metaDirty.set(true);
  }

  toggleMember(id: number, checked: boolean) {
    if (!this.membersEditable() || this.savingMembers()) return;
    this.selectedIds.update((ids) => {
      if (checked) return ids.includes(id) ? ids : [...ids, id];
      return ids.filter((x) => x !== id);
    });
    this.membersDirty.set(true);
  }

  isSelected(id: number) {
    return this.selectedIds().includes(id);
  }

  saveMeta() {
    const sprint = this.sprint();
    if (!sprint || this.savingMeta() || this.projectSwitching()) return;
    const draft = {
      name: this.draftName(),
      goal: this.draftGoal(),
      startDate: this.draftStart(),
      endDate: this.draftEnd(),
      velocity: this.draftVelocity(),
    };
    const validationError = validateSprintMetaForSave(
      draft.name,
      draft.goal,
      draft.startDate,
      draft.endDate,
    );
    if (validationError) {
      this.saveError.set(validationError);
      return;
    }
    const patch = buildSprintMetaPatch(sprint, draft);
    if (!patch) {
      this.metaDirty.set(false);
      return;
    }
    const generation = ++this.actionGeneration;
    this.savingMeta.set(true);
    this.saveError.set('');
    const projectId = this.projectSession.activeId() ?? undefined;
    this.api
      .patchSprint(sprint.id, patch, projectId)
      .pipe(
        finalize(() => {
          if (generation === this.actionGeneration) this.savingMeta.set(false);
        }),
      )
      .subscribe({
        next: () => {
          if (generation !== this.actionGeneration) return;
          this.reloadSprint(generation);
        },
        error: (err) => {
          if (generation !== this.actionGeneration) return;
          this.saveError.set(errorMessage(err));
        },
      });
  }

  saveVelocity() {
    const sprint = this.sprint();
    if (!sprint || sprint.status !== 'completed' || this.savingVelocity() || this.projectSwitching()) {
      return;
    }
    const parsed = parseOptionalSprintVelocityInput(this.draftVelocity());
    if (!parsed.ok) {
      this.saveError.set(parsed.error);
      return;
    }
    const velocity = parsed.velocity;
    if (velocity === sprint.velocity || (velocity === null && sprint.velocity == null)) {
      this.metaDirty.set(false);
      return;
    }
    const generation = ++this.actionGeneration;
    this.savingVelocity.set(true);
    this.saveError.set('');
    const projectId = this.projectSession.activeId() ?? undefined;
    this.api
      .patchSprint(sprint.id, { velocity }, projectId)
      .pipe(
        finalize(() => {
          if (generation === this.actionGeneration) this.savingVelocity.set(false);
        }),
      )
      .subscribe({
        next: () => {
          if (generation !== this.actionGeneration) return;
          this.reloadSprint(generation);
        },
        error: (err) => {
          if (generation !== this.actionGeneration) return;
          this.saveError.set(errorMessage(err));
        },
      });
  }

  saveMembers() {
    const sprint = this.sprint();
    if (!sprint || !this.membersEditable() || this.savingMembers() || this.projectSwitching()) {
      return;
    }
    const generation = ++this.actionGeneration;
    this.savingMembers.set(true);
    this.saveError.set('');
    const projectId = this.projectSession.activeId() ?? undefined;
    this.api
      .replaceSprintItems(sprint.id, this.selectedIds(), projectId)
      .pipe(
        finalize(() => {
          if (generation === this.actionGeneration) this.savingMembers.set(false);
        }),
      )
      .subscribe({
        next: () => {
          if (generation !== this.actionGeneration) return;
          this.reloadSprint(generation);
        },
        error: (err) => {
          if (generation !== this.actionGeneration) return;
          this.saveError.set(errorMessage(err));
        },
      });
  }

  activate() {
    const sprint = this.sprint();
    if (!sprint || sprint.status !== 'planned' || this.activating() || this.projectSwitching()) {
      return;
    }
    const generation = ++this.actionGeneration;
    this.activating.set(true);
    this.saveError.set('');
    const projectId = this.projectSession.activeId() ?? undefined;
    this.api
      .activateSprint(sprint.id, projectId)
      .pipe(
        finalize(() => {
          if (generation === this.actionGeneration) this.activating.set(false);
        }),
      )
      .subscribe({
        next: () => {
          if (generation !== this.actionGeneration) return;
          this.reloadSprint(generation);
        },
        error: (err) => {
          if (generation !== this.actionGeneration) return;
          this.saveError.set(errorMessage(err));
        },
      });
  }

  openComplete() {
    const sprint = this.sprint();
    if (!sprint || sprint.status !== 'active' || this.completing() || this.projectSwitching()) {
      return;
    }
    this.completeVelocity.set(sprint.suggestedVelocity ?? 0);
    this.completeForm.setValue({ velocity: sprint.suggestedVelocity ?? 0 });
    this.completeError.set('');
    this.completeOpen.set(true);
  }

  closeComplete() {
    if (this.completing()) return;
    this.completeOpen.set(false);
    this.completeError.set('');
  }

  confirmComplete() {
    const sprint = this.sprint();
    if (!sprint || !this.completeOpen() || this.completing() || this.projectSwitching()) return;
    const validated = validateSprintCompleteVelocity(this.completeForm.controls.velocity.value);
    if (!validated.ok) {
      this.completeError.set(validated.error);
      return;
    }
    const velocity = validated.velocity;
    const generation = ++this.actionGeneration;
    this.completing.set(true);
    this.completeError.set('');
    const projectId = this.projectSession.activeId() ?? undefined;
    this.api
      .completeSprint(sprint.id, velocity, projectId)
      .pipe(
        finalize(() => {
          if (generation === this.actionGeneration) this.completing.set(false);
        }),
      )
      .subscribe({
        next: () => {
          if (generation !== this.actionGeneration) return;
          this.completeOpen.set(false);
          this.reloadSprint(generation);
        },
        error: (err) => {
          if (generation !== this.actionGeneration) return;
          this.completeError.set(errorMessage(err));
        },
      });
  }

  isDirty() {
    return this.metaDirty() || this.membersDirty();
  }

  async canLeave(): Promise<boolean> {
    if (
      this.savingMeta() ||
      this.savingMembers() ||
      this.savingVelocity() ||
      this.activating() ||
      this.completing()
    ) {
      return window.confirm(
        '保存中です。移動すると保存が中断される可能性があります。移動しますか？',
      );
    }
    if (!this.isDirty()) return true;
    return window.confirm('未保存の変更があります。変更を破棄して移動しますか？');
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent) {
    if (
      this.isDirty() ||
      this.savingMeta() ||
      this.savingMembers() ||
      this.savingVelocity() ||
      this.activating() ||
      this.completing()
    ) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
}
