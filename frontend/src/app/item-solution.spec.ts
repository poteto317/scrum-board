import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { ItemSolution } from './item-solution';
import type { Item } from './models';
import { ProjectSession } from './project-session';

const card: Item = {
  id: 18,
  projectId: 1,
  number: 3,
  columnId: 1,
  title: '学習',
  description: '元の説明',
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
};

describe('ItemSolution', () => {
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let api: {
    itemByNumber: ReturnType<typeof vi.fn>;
    updateItem: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    params = new BehaviorSubject(convertToParamMap({ number: '3' }));
    query = new BehaviorSubject(convertToParamMap({ project: '1' }));
    api = {
      itemByNumber: vi.fn(() => of(card)),
      updateItem: vi.fn((_id: number, patch: { solution?: string }) =>
        of({ ...card, ...patch }),
      ),
    };
    await TestBed.configureTestingModule({
      imports: [ItemSolution],
      providers: [
        provideRouter([]),
        { provide: Api, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: params.asObservable(),
            queryParamMap: query.asObservable(),
          },
        },
        {
          provide: ProjectSession,
          useValue: { activeId: () => 1, projects: () => [{ id: 1, name: 'P' }] },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  function create() {
    const fixture = TestBed.createComponent(ItemSolution);
    fixture.detectChanges();
    return fixture;
  }

  it('loads with project query and shows empty placeholder', async () => {
    const fixture = create();
    await Promise.resolve();
    fixture.detectChanges();
    expect(api.itemByNumber).toHaveBeenCalledWith(3, 1);
    expect(fixture.nativeElement.textContent).toContain('未記入');
    fixture.destroy();
  });

  it('PATCHes only solution after debounce', async () => {
    const fixture = create();
    await Promise.resolve();
    const cmp = fixture.componentInstance;
    cmp.onTextChange('実装メモ');
    await vi.advanceTimersByTimeAsync(400);
    expect(api.updateItem).toHaveBeenCalledWith(18, { solution: '実装メモ' });
    fixture.destroy();
  });

  it('keeps draft and shows error when save fails', async () => {
    api.updateItem.mockReturnValueOnce(throwError(() => new Error('fail')));
    const fixture = create();
    await Promise.resolve();
    const cmp = fixture.componentInstance;
    cmp.onTextChange('失敗する本文');
    await vi.advanceTimersByTimeAsync(400);
    fixture.detectChanges();
    expect(cmp.control.value).toBe('失敗する本文');
    expect(fixture.nativeElement.textContent).toContain('保存に失敗');
    fixture.destroy();
  });

  it('marks dirty so live refresh stays blocked', async () => {
    const fixture = create();
    await Promise.resolve();
    const cmp = fixture.componentInstance;
    cmp.onTextChange('下書き');
    expect(cmp['dirty']).toBe(true);
    fixture.destroy();
  });

  it('canLeave flushes pending changes', async () => {
    const fixture = create();
    await Promise.resolve();
    const cmp = fixture.componentInstance;
    cmp.onTextChange('flush me');
    const leaveP = cmp.canLeave();
    await vi.advanceTimersByTimeAsync(0);
    await expect(leaveP).resolves.toBe(true);
    expect(api.updateItem).toHaveBeenCalledWith(18, { solution: 'flush me' });
    fixture.destroy();
  });
});
