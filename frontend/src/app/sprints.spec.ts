import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { ProjectSession } from './project-session';
import { Sprint, SprintSummary } from './models';
import { Sprints, sortSprintSummaries } from './sprints';

function summary(partial: Partial<SprintSummary> & Pick<SprintSummary, 'id' | 'name'>): SprintSummary {
  return {
    projectId: partial.projectId ?? 1,
    goal: partial.goal ?? '',
    startDate: partial.startDate ?? '2026-11-01',
    endDate: partial.endDate ?? '2026-11-14',
    status: partial.status ?? 'planned',
    velocity: partial.velocity ?? null,
    itemCount: partial.itemCount ?? 0,
    createdAt: partial.createdAt ?? '',
    updatedAt: partial.updatedAt ?? '',
    ...partial,
  };
}

function detail(partial: Partial<Sprint> & Pick<Sprint, 'id' | 'name'>): Sprint {
  const base = summary(partial);
  return {
    ...base,
    suggestedVelocity: partial.suggestedVelocity ?? 0,
    items: partial.items ?? [],
  };
}

describe('sortSprintSummaries', () => {
  it('orders by startDate desc then id desc', () => {
    const rows = [
      summary({ id: 1, name: 'a', startDate: '2026-11-01' }),
      summary({ id: 3, name: 'b', startDate: '2026-11-10' }),
      summary({ id: 2, name: 'c', startDate: '2026-11-10' }),
    ];
    expect(sortSprintSummaries(rows).map((r) => r.id)).toEqual([3, 2, 1]);
  });
});

describe('Sprints page', () => {
  let restoreDialog: () => void;

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
  });

  afterEach(() => {
    restoreDialog();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  function setup(apiOverrides: Record<string, unknown> = {}) {
    const api = {
      listSprints: vi.fn(() =>
        of({
          sprints: [
            summary({
              id: 5,
              name: 'Sprint Alpha',
              startDate: '2026-11-21',
              endDate: '2026-12-04',
              status: 'completed',
              velocity: 7,
              itemCount: 3,
            }),
          ],
        }),
      ),
      createSprint: vi.fn(() =>
        of(
          detail({
            id: 9,
            name: 'Sprint Beta',
            startDate: '2026-12-05',
            endDate: '2026-12-18',
            status: 'planned',
            itemCount: 0,
          }),
        ),
      ),
      ...apiOverrides,
    };
    TestBed.configureTestingModule({
      imports: [Sprints],
      providers: [
        provideRouter([{ path: 'sprints', component: Sprints }]),
        { provide: Api, useValue: api },
      ],
    });
    const f = TestBed.createComponent(Sprints);
    const session = TestBed.inject(ProjectSession);
    session.activeId.set(1);
    session.bootstrapped.set(true);
    f.detectChanges();
    return {
      f,
      session,
      listSprints: api.listSprints as ReturnType<typeof vi.fn>,
      createSprint: api.createSprint as ReturnType<typeof vi.fn>,
    };
  }

  it('renders name, dates, status, itemCount, and completed velocity', () => {
    const { f } = setup();
    const text = f.nativeElement.textContent as string;
    expect(text).toContain('Sprint Alpha');
    expect(text).toContain('2026-11-21');
    expect(text).toContain('2026-12-04');
    expect(text).toContain('完了');
    expect(text).toContain('メンバー 3');
    expect(text).toContain('ベロシティ 7');
    f.destroy();
  });

  it('reloads when project switches', () => {
    const { f, session, listSprints } = setup();
    listSprints.mockReturnValueOnce(
      of({ sprints: [summary({ id: 2, name: 'Other PJ Sprint', projectId: 2 })] }),
    );
    session.switching.set(true);
    f.componentInstance.reloadForProjectSwitch();
    f.detectChanges();
    expect(listSprints).toHaveBeenCalledTimes(2);
    expect(f.nativeElement.textContent).toContain('Other PJ Sprint');
    f.destroy();
  });

  it('does not treat create failure as success (L-001)', () => {
    const pending = new Subject<Sprint>();
    const { f, createSprint } = setup({
      createSprint: vi.fn(() => pending.asObservable()),
    });
    f.componentInstance.openCreate();
    f.detectChanges();
    f.componentInstance.createForm.setValue({
      name: 'Sprint Beta',
      startDate: '2026-12-05',
      endDate: '2026-12-18',
    });
    f.componentInstance.submitCreate();
    f.detectChanges();
    expect(createSprint).toHaveBeenCalledWith({
      name: 'Sprint Beta',
      startDate: '2026-12-05',
      endDate: '2026-12-18',
      projectId: 1,
    });
    expect(f.componentInstance.sprints().some((s) => s.name === 'Sprint Beta')).toBe(false);

    pending.error({ status: 500, error: { message: '作成失敗' } });
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('作成失敗');
    expect(f.nativeElement.querySelector('#sprint-create-title')).toBeTruthy();
    expect(f.componentInstance.sprints().some((s) => s.name === 'Sprint Beta')).toBe(false);
    f.destroy();
  });

  it('adds created sprint to the list only after API success', () => {
    const { f, createSprint } = setup();
    (f.nativeElement.querySelector('.page-heading .primary') as HTMLButtonElement).click();
    f.detectChanges();
    f.componentInstance.createForm.setValue({
      name: 'Sprint Beta',
      startDate: '2026-12-05',
      endDate: '2026-12-18',
    });
    f.componentInstance.submitCreate();
    f.detectChanges();
    expect(createSprint).toHaveBeenCalled();
    expect(f.nativeElement.textContent).toContain('Sprint Beta');
    expect(f.nativeElement.querySelector('#sprint-create-title')).toBeNull();
    f.destroy();
  });

  it('shows error and not empty copy when GET fails', () => {
    const { f } = setup({
      listSprints: vi.fn(() => throwError(() => ({ status: 500 }))),
    });
    const text = f.nativeElement.textContent as string;
    expect(text).not.toContain('スプリントはまだありません');
    expect(text).toMatch(/失敗|エラー|読み込み|通信/);
    f.destroy();
  });
});

describe('Router sprints path', () => {
  it('has /sprints and /sprints/:id with authGuard', async () => {
    const { routes } = await import('./app.routes');
    const list = routes.find((r) => r.path === 'sprints');
    const detail = routes.find((r) => r.path === 'sprints/:id');
    expect(list?.canActivate).toBeTruthy();
    expect(detail?.canActivate).toBeTruthy();
    expect(detail?.canDeactivate).toBeTruthy();
  });
});
