import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { AuthSession } from './auth-session';
import { Sprint } from './models';
import { ProjectSession } from './project-session';
import { SprintDetail } from './sprint-detail';

function sprint(projectId: number): Sprint {
  return {
    id: 9,
    projectId,
    name: 'S9',
    goal: '',
    startDate: '2026-11-21',
    endDate: '2026-12-04',
    status: 'planned',
    velocity: null,
    suggestedVelocity: 0,
    itemCount: 0,
    items: [],
    createdAt: '',
    updatedAt: '',
  };
}

describe('SprintDetail project scope', () => {
  let params: BehaviorSubject<Map<string, string>>;
  let api: {
    getSprint: ReturnType<typeof vi.fn>;
    board: ReturnType<typeof vi.fn>;
    patchBoardSettings: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    params = new BehaviorSubject(new Map([['id', '9']]));
    api = {
      getSprint: vi.fn(() => of(sprint(1))),
      board: vi.fn(() =>
        of({
          columns: [{ id: 1, name: 'Todo', position: 0 }],
          items: [],
          settings: { cardLayout: 'pack' as const, activeProjectId: 1 },
        }),
      ),
      patchBoardSettings: vi.fn(() =>
        of({ settings: { cardLayout: 'pack' as const, activeProjectId: 2 } }),
      ),
    };
    TestBed.configureTestingModule({
      imports: [SprintDetail],
      providers: [
        { provide: Api, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: params.asObservable() },
        },
        {
          provide: AuthSession,
          useValue: { user: () => ({ id: 1, role: 'admin' }) },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  function create(activeId = 1) {
    const session = TestBed.inject(ProjectSession);
    session.projects.set([
      { id: 1, name: 'メイン', position: 0 },
      { id: 2, name: '次', position: 1 },
    ]);
    session.activeId.set(activeId);
    const f = TestBed.createComponent(SprintDetail);
    f.detectChanges();
    return { f, session };
  }

  it('clears the sprint when the loaded row belongs to another project', () => {
    api.getSprint.mockReturnValue(of(sprint(2)));
    const { f } = create(1);
    expect(f.componentInstance.sprint()).toBeNull();
    expect(f.componentInstance.error()).toBe('スプリントが見つかりません。');
    expect(f.componentInstance.candidates()).toEqual([]);
  });

  it('clears the sprint after switching to a project that does not own the route id', () => {
    const { f, session } = create(1);
    expect(f.componentInstance.sprint()?.id).toBe(9);
    api.getSprint.mockImplementation(() => of(sprint(1)));
    session.switchTo(2).subscribe();
    f.detectChanges();
    expect(api.getSprint).toHaveBeenLastCalledWith(9, 2);
    expect(f.componentInstance.sprint()).toBeNull();
    expect(f.componentInstance.error()).toBe('スプリントが見つかりません。');
  });
});