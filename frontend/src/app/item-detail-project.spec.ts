import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
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
    dueAt: null,
    createdAt: '',
    updatedAt: '',
  };
}

describe('ItemDetail project move', () => {
  let params: BehaviorSubject<Map<string, string>>;
  let current: Item;
  let api: {
    history: ReturnType<typeof vi.fn>;
    board: ReturnType<typeof vi.fn>;
    itemByNumber: ReturnType<typeof vi.fn>;
    updateItem: ReturnType<typeof vi.fn>;
    patchBoardSettings: ReturnType<typeof vi.fn>;
    deleteItem: ReturnType<typeof vi.fn>;
    listCommandTemplates: ReturnType<typeof vi.fn>;
    listItemCommandTemplatesByNumber: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    params = new BehaviorSubject(new Map([['number', '3']]));
    current = card(1);
    api = {
      history: vi.fn(() => of({ events: [], nextBefore: 0 })),
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
        { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
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
