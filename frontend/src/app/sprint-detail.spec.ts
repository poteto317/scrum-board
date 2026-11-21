import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { AuthSession } from './auth-session';
import { ProjectSession } from './project-session';
import { Item, Sprint, SPRINT_GOAL_MAX_SCALARS } from './models';
import { SprintDetail } from './sprint-detail';

function sprint(partial: Partial<Sprint> & Pick<Sprint, 'id' | 'name' | 'status'>): Sprint {
  return {
    projectId: partial.projectId ?? 1,
    goal: partial.goal ?? '',
    startDate: partial.startDate ?? '2026-11-21',
    endDate: partial.endDate ?? '2026-12-04',
    velocity: partial.velocity ?? null,
    suggestedVelocity: partial.suggestedVelocity ?? 0,
    itemCount: partial.itemCount ?? (partial.items?.length ?? 0),
    items: partial.items ?? [],
    createdAt: partial.createdAt ?? '',
    updatedAt: partial.updatedAt ?? '',
    ...partial,
  };
}

function item(partial: Partial<Item> & Pick<Item, 'id' | 'number' | 'title'>): Item {
  return {
    projectId: partial.projectId ?? 1,
    columnId: partial.columnId ?? 1,
    description: '',
    solution: '',
    position: 0,
    backlogPosition: 0,
    offsetY: 0,
    prUrls: [],
    relatedItems: [],
    assignee: '',
    closeReason: '',
    favorite: false,
    dueAt: null,
    createdAt: '',
    updatedAt: '',
    canEdit: true,
    ...partial,
  };
}

describe('SprintDetail page', () => {
  let restoreDialog: () => void;
  let confirmSpy: ReturnType<typeof vi.spyOn>;
  let params: BehaviorSubject<Map<string, string>>;

  beforeEach(() => {
    const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
      showModal?: () => void;
      close?: () => void;
    };
    const origShowModal = proto.showModal;
    const origClose = proto.close;
    proto.showModal = function () {
      this.open = true;
    };
    proto.close = function () {
      this.open = false;
    };
    restoreDialog = () => {
      proto.showModal = origShowModal;
      proto.close = origClose;
    };
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    params = new BehaviorSubject(new Map([['id', '8']]));
  });

  afterEach(() => {
    restoreDialog();
    confirmSpy.mockRestore();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  function setup(
    apiOverrides: Record<string, unknown> = {},
    sprintSeed: Sprint = sprint({
      id: 8,
      name: 'Sprint 8',
      status: 'planned',
      goal: '初期ゴール',
      items: [{ id: 10, number: 10, title: 'Member A', columnId: 1 }],
      suggestedVelocity: 2,
    }),
  ) {
    const api = {
      getSprint: vi.fn(() => of(sprintSeed)),
      board: vi.fn(() =>
        of({
          columns: [{ id: 1, name: 'Todo', position: 0 }],
          items: [
            item({ id: 10, number: 10, title: 'Member A' }),
            item({ id: 11, number: 11, title: 'Candidate B' }),
          ],
          settings: { cardLayout: 'pack', activeProjectId: 1 },
        }),
      ),
      patchSprint: vi.fn((id: number, patch: Record<string, unknown>) =>
        of({ ...sprintSeed, ...patch, id }),
      ),
      replaceSprintItems: vi.fn(() =>
        of({
          ...sprintSeed,
          items: [{ id: 11, number: 11, title: 'Candidate B', columnId: 1 }],
        }),
      ),
      activateSprint: vi.fn(() => of({ ...sprintSeed, status: 'active' as const })),
      completeSprint: vi.fn(() =>
        of({ ...sprintSeed, status: 'completed' as const, velocity: 2 }),
      ),
      me: vi.fn(() =>
        of({
          id: 1,
          loginName: 'admin',
          displayName: 'Admin',
          role: 'admin',
          disabled: false,
        }),
      ),
      listUsers: vi.fn(() => of([])),
      ...apiOverrides,
    };
    TestBed.configureTestingModule({
      imports: [SprintDetail],
      providers: [
        { provide: Api, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: params.asObservable() },
        },
      ],
    });
    const session = TestBed.inject(ProjectSession);
    session.activeId.set(1);
    session.bootstrapped.set(true);
    const auth = TestBed.inject(AuthSession);
    auth.user.set({
      id: 1,
      loginName: 'admin',
      displayName: 'Admin',
      role: 'admin',
      disabled: false,
    });
    const f = TestBed.createComponent(SprintDetail);
    f.detectChanges();
    return { f, api, session, auth, sprintSeed };
  }

  it('PATCHes goal/dates on blur and keeps drafts on failure (L-001)', () => {
    const pending = new Subject<Sprint>();
    const { f, api } = setup({
      patchSprint: vi.fn(() => pending.asObservable()),
    });
    f.componentInstance.onGoalInput('更新ゴール');
    f.componentInstance.saveMeta();
    f.detectChanges();
    expect(api.patchSprint).toHaveBeenCalledWith(
      8,
      expect.objectContaining({ goal: '更新ゴール' }),
      1,
    );
    pending.error({ status: 500, error: { message: '保存失敗' } });
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('保存失敗');
    expect(f.componentInstance.draftGoal()).toBe('更新ゴール');
    expect(f.componentInstance.sprint()?.goal).toBe('初期ゴール');
    f.destroy();
  });

  it('rejects goal over Unicode scalar limit before send (L-858)', () => {
    const { f, api } = setup();
    const tooLong = 'あ'.repeat(SPRINT_GOAL_MAX_SCALARS + 1);
    f.componentInstance.onGoalInput(tooLong);
    f.componentInstance.saveMeta();
    f.detectChanges();
    expect(api.patchSprint).not.toHaveBeenCalled();
    expect(f.nativeElement.textContent).toContain(String(SPRINT_GOAL_MAX_SCALARS));
    f.destroy();
  });

  it('PUTs members and reloads after success', () => {
    const reloaded = sprint({
      id: 8,
      name: 'Sprint 8',
      status: 'planned',
      items: [{ id: 11, number: 11, title: 'Candidate B', columnId: 1 }],
    });
    const { f, api } = setup({
      getSprint: vi
        .fn()
        .mockReturnValueOnce(
          of(
            sprint({
              id: 8,
              name: 'Sprint 8',
              status: 'planned',
              goal: '初期ゴール',
              items: [{ id: 10, number: 10, title: 'Member A', columnId: 1 }],
            }),
          ),
        )
        .mockReturnValue(of(reloaded)),
    });
    f.componentInstance.toggleMember(10, false);
    f.componentInstance.toggleMember(11, true);
    f.componentInstance.saveMembers();
    f.detectChanges();
    expect(api.replaceSprintItems).toHaveBeenCalledWith(8, [11], 1);
    expect(api.getSprint.mock.calls.length).toBeGreaterThan(1);
    f.destroy();
  });

  it('activates planned sprint and disables while in flight', () => {
    const pending = new Subject<Sprint>();
    const { f, api } = setup({
      activateSprint: vi.fn(() => pending.asObservable()),
      getSprint: vi
        .fn()
        .mockReturnValueOnce(
          of(sprint({ id: 8, name: 'Sprint 8', status: 'planned', goal: '初期ゴール' })),
        )
        .mockReturnValue(
          of(sprint({ id: 8, name: 'Sprint 8', status: 'active', goal: '初期ゴール' })),
        ),
    });
    const btn = f.nativeElement.querySelector('.heading-actions .primary') as HTMLButtonElement;
    expect(btn.textContent).toContain('開始');
    btn.click();
    f.detectChanges();
    expect(btn.disabled).toBe(true);
    expect(api.activateSprint).toHaveBeenCalledWith(8, 1);
    pending.next(sprint({ id: 8, name: 'Sprint 8', status: 'active' }));
    pending.complete();
    f.detectChanges();
    expect(api.getSprint.mock.calls.length).toBeGreaterThan(1);
    f.destroy();
  });

  it('opens complete dialog with suggestedVelocity and completes on confirm', () => {
    const seed = sprint({
      id: 8,
      name: 'Sprint 8',
      status: 'active',
      suggestedVelocity: 4,
    });
    const { f, api } = setup(
      {
        getSprint: vi
          .fn()
          .mockReturnValueOnce(of(seed))
          .mockReturnValue(of({ ...seed, status: 'completed', velocity: 4 })),
        completeSprint: vi.fn(() => of({ ...seed, status: 'completed', velocity: 4 })),
      },
      seed,
    );
    (f.nativeElement.querySelector('.heading-actions .primary') as HTMLButtonElement).click();
    f.detectChanges();
    expect(f.nativeElement.querySelector('#sprint-complete-title')).toBeTruthy();
    const velocity = f.nativeElement.querySelector(
      '#sprint-complete-velocity',
    ) as HTMLInputElement;
    expect(Number(velocity.value)).toBe(4);
    f.componentInstance.confirmComplete();
    f.detectChanges();
    expect(api.completeSprint).toHaveBeenCalledWith(8, 4, 1);
    f.destroy();
  });

  it('does not treat complete failure as success (L-001)', () => {
    const seed = sprint({ id: 8, name: 'Sprint 8', status: 'active', suggestedVelocity: 1 });
    const { f } = setup(
      {
        getSprint: vi.fn(() => of(seed)),
        completeSprint: vi.fn(() =>
          throwError(() => ({ status: 500, error: { message: '完了失敗' } })),
        ),
      },
      seed,
    );
    f.componentInstance.openComplete();
    f.detectChanges();
    f.componentInstance.confirmComplete();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('完了失敗');
    expect(f.componentInstance.completeOpen()).toBe(true);
    expect(f.componentInstance.sprint()?.status).toBe('active');
    f.destroy();
  });

  it('blocks leave when dirty via canLeave', async () => {
    const { f } = setup();
    confirmSpy.mockReturnValue(false);
    f.componentInstance.onGoalInput('dirty');
    expect(await f.componentInstance.canLeave()).toBe(false);
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockReturnValue(true);
    expect(await f.componentInstance.canLeave()).toBe(true);
    f.destroy();
  });

  it('hides member editing when completed and keeps draft on velocity PATCH failure', () => {
    const seed = sprint({
      id: 8,
      name: 'Sprint 8',
      status: 'completed',
      velocity: 3,
      suggestedVelocity: 2,
      items: [{ id: 10, number: 10, title: 'Done item', columnId: 3 }],
    });
    const pending = new Subject<Sprint>();
    const { f, api } = setup(
      {
        getSprint: vi.fn(() => of(seed)),
        patchSprint: vi.fn(() => pending.asObservable()),
      },
      seed,
    );
    expect(f.nativeElement.querySelector('.member-checklist')).toBeNull();
    expect(f.nativeElement.textContent).toContain('編集できません');
    expect(f.nativeElement.querySelector('#sprint-detail-velocity')).toBeTruthy();

    f.componentInstance.onVelocityInput('9');
    f.componentInstance.saveVelocity();
    f.detectChanges();
    expect(api.patchSprint).toHaveBeenCalledWith(8, { velocity: 9 }, 1);
    pending.error({ status: 500, error: { message: 'velocity失敗' } });
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('velocity失敗');
    expect(f.componentInstance.sprint()?.velocity).toBe(3);
    expect(f.componentInstance.draftVelocity()).toBe('9');
    f.destroy();
  });

  it('saves completed velocity on success and refreshes', () => {
    const seed = sprint({
      id: 8,
      name: 'Sprint 8',
      status: 'completed',
      velocity: 3,
      suggestedVelocity: 2,
    });
    const { f, api } = setup(
      {
        getSprint: vi
          .fn()
          .mockReturnValueOnce(of(seed))
          .mockReturnValue(of({ ...seed, velocity: 6 })),
        patchSprint: vi.fn(() => of({ ...seed, velocity: 6 })),
      },
      seed,
    );
    f.componentInstance.onVelocityInput('6');
    f.componentInstance.saveVelocity();
    f.detectChanges();
    expect(api.patchSprint).toHaveBeenCalledWith(8, { velocity: 6 }, 1);
    expect(f.componentInstance.sprint()?.velocity).toBe(6);
    f.destroy();
  });
});
