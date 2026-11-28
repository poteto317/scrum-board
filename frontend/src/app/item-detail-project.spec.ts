import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { Api } from './api';
import { AuthSession } from './auth-session';
import { ItemDetail } from './item-detail';
import { Item } from './models';
import { ProjectSession } from './project-session';

function card(projectId: number): Item {
  return {
    id: 18,
    number: 3,
    projectId,
    columnId: 1,
    title: '学習',
    description: '元の説明',
    position: 0,
    backlogPosition: 0,
    offsetY: 0,
    prUrls: [],
    relatedItems: [],
    assignee: '',
    closeReason: '',
    solution: '',
    favorite: false,
    dueAt: null,
    createdAt: '',
    updatedAt: '',
    canEdit: true,
    canManage: true,
    viewAccess: 'open',
    editAccess: 'open',
  };
}


const testUser = {
  id: 1,
  loginName: 'admin',
  displayName: 'Admin',
  role: 'admin' as const,
  disabled: false,
};
const authStub = {
  user: signal(testUser),
  status: signal<'authenticated'>('authenticated'),
  loadError: signal(''),
  ensureMe: () => of(testUser),
  isAdmin: () => true,
  clearSubject: () => undefined,
  login: () => of(testUser),
  logout: () => of(undefined),
};

describe('ItemDetail project move', () => {
  let params: BehaviorSubject<Map<string, string>>;
  let query: BehaviorSubject<Map<string, string>>;
  let current: Item;
  let api: {
    history: ReturnType<typeof vi.fn>;
    listComments: ReturnType<typeof vi.fn>;
    board: ReturnType<typeof vi.fn>;
    itemByNumber: ReturnType<typeof vi.fn>;
    updateItem: ReturnType<typeof vi.fn>;
    patchBoardSettings: ReturnType<typeof vi.fn>;
    deleteItem: ReturnType<typeof vi.fn>;
    listCommandTemplates: ReturnType<typeof vi.fn>;
    listItemCommandTemplatesByNumber: ReturnType<typeof vi.fn>;
    uploadAttachment: ReturnType<typeof vi.fn>;
    deleteAttachment: ReturnType<typeof vi.fn>;
    listAttachments: ReturnType<typeof vi.fn>;
    listLabels?: ReturnType<typeof vi.fn>;
    listUsers: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    params = new BehaviorSubject(new Map([['number', '3']]));
    query = new BehaviorSubject(new Map());
    current = card(1);
    api = {
      history: vi.fn(() => of({ events: [], nextBefore: 0 })),
      listComments: vi.fn(() => of([])),
      listUsers: vi.fn(() => of([])),
      uploadAttachment: vi.fn(() => of({ id: 1, originalName: 'x.png' })),
      deleteAttachment: vi.fn(() => of(undefined)),
      listAttachments: vi.fn(() => of([])),
      listLabels: vi.fn(() => of({ labels: [] })),
      board: vi.fn(() =>
        of({
          columns: [
            { id: 1, name: 'Todo', position: 0 },
            { id: 2, name: 'Doing', position: 1 },
          ],
          items: [],
          settings: { cardLayout: 'pack' as const, activeProjectId: 1 },
        }),
      ),
      itemByNumber: vi.fn(() => of(current)),
      updateItem: vi.fn((_id: number, patch: Partial<Item>) => {
        current = { ...current, ...patch };
        return of(current);
      }),
      patchBoardSettings: vi.fn(() =>
        of({ settings: { cardLayout: 'pack' as const, activeProjectId: 2 } }),
      ),
      deleteItem: vi.fn(() => of(undefined)),
      listCommandTemplates: vi.fn(() => of({ templates: [] })),
      listItemCommandTemplatesByNumber: vi.fn(() => of({ templates: [] })),
    };
    TestBed.configureTestingModule({
      imports: [ItemDetail],
      providers: [
        { provide: Api, useValue: api },
        { provide: AuthSession, useValue: authStub },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: params.asObservable(), queryParamMap: query.asObservable() },
        },
        {
          provide: Router,
          useValue: { navigate: vi.fn(), navigateByUrl: vi.fn().mockResolvedValue(true) },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function create(activeId = 1) {
    const session = TestBed.inject(ProjectSession);
    session.projects.set([
      { id: 1, name: 'メイン', position: 0 },
      { id: 2, name: '次', position: 1 },
    ]);
    session.activeId.set(activeId);
    const f = TestBed.createComponent(ItemDetail);
    f.detectChanges();
    return { f, session };
  }

  it('does not switch the active project when a deep link opens', () => {
    current = card(2);
    const { session } = create(1);
    expect(api.patchBoardSettings).not.toHaveBeenCalled();
    expect(api.updateItem).not.toHaveBeenCalled();
    expect(session.activeId()).toBe(1);
  });

  it('switches active project then loads by number when project query is set', () => {
    query.next(new Map([['project', '2']]));
    const { session } = create(1);
    expect(api.patchBoardSettings).toHaveBeenCalledWith({ activeProjectId: 2 });
    expect(api.itemByNumber).toHaveBeenCalledWith(3, 2);
    expect(session.activeId()).toBe(2);
    expect(session.switching()).toBe(false);
  });

  it('does not load the item when project switch PATCH fails', () => {
    api.patchBoardSettings.mockReturnValue(
      throwError(() => ({ error: { message: '切替失敗' } })),
    );
    query.next(new Map([['project', '2']]));
    create(1);
    expect(api.itemByNumber).not.toHaveBeenCalled();
  });

  it('includes project switching in busy until load completes', () => {
    const pending = new Subject<Item>();
    api.itemByNumber.mockReturnValue(pending.asObservable());
    query.next(new Map([['project', '2']]));
    const { f, session } = create(1);
    expect(session.switching()).toBe(true);
    expect(f.componentInstance.busy()).toBe(true);
    pending.next(current);
    pending.complete();
    f.detectChanges();
    expect(session.switching()).toBe(false);
    expect(f.componentInstance.busy()).toBe(false);
  });

  it('patches the item and then the active project', () => {
    const { f, session } = create(1);
    const select = f.nativeElement.querySelector('#detail-project') as HTMLSelectElement;
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    f.detectChanges();
    expect(api.updateItem).toHaveBeenCalledWith(18, { projectId: 2 });
    expect(api.patchBoardSettings).toHaveBeenCalledTimes(1);
    expect(api.patchBoardSettings).toHaveBeenCalledWith({ activeProjectId: 2 });
    expect(session.activeId()).toBe(2);
    expect(f.componentInstance.item()?.projectId).toBe(2);
    expect(f.componentInstance.projectMoveError()).toBe('');
  });

  it('shows an error and does not retry settings when the item move succeeds and settings fail', async () => {
    api.patchBoardSettings.mockReturnValue(
      throwError(() => ({ error: { message: '設定の保存に失敗' } })),
    );
    const { f, session } = create(1);
    const select = f.nativeElement.querySelector('#detail-project') as HTMLSelectElement;
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    f.detectChanges();
    expect(api.updateItem).toHaveBeenCalledTimes(1);
    expect(api.patchBoardSettings).toHaveBeenCalledTimes(1);
    expect(session.activeId()).toBe(1);
    expect(f.componentInstance.item()?.projectId).toBe(2);
    expect(f.nativeElement.querySelector('#detail-project-error').textContent).toContain(
      '設定の保存に失敗',
    );
    expect(f.componentInstance.projectSaving()).toBe(false);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(api.patchBoardSettings).toHaveBeenCalledTimes(1);
    expect(api.updateItem).toHaveBeenCalledTimes(1);
  });

  it('skips the settings PATCH when the item already belongs to the active project', () => {
    const { f, session } = create(2);
    current = card(1);
    f.componentInstance.moveToProject(2);
    expect(api.updateItem).toHaveBeenCalledWith(18, { projectId: 2 });
    expect(api.patchBoardSettings).not.toHaveBeenCalled();
    expect(session.activeId()).toBe(2);
  });
});
