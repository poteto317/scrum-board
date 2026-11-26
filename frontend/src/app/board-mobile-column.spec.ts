import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { Board } from './board';
import { normalizeBoardData } from './board-data';
import { Column } from './models';

function columns(): Column[] {
  return [
    { id: 1, name: 'Todo', position: 0 },
    { id: 2, name: 'Doing', position: 1 },
    { id: 3, name: 'Done', position: 2 },
  ];
}

function sample(settings: { cardLayout: 'pack' | 'free'; mobileBoardColumnId?: number }) {
  return normalizeBoardData({
    columns: columns(),
    items: [
      {
        id: 1,
        projectId: 1,
        number: 1,
        columnId: 1,
        title: 'A',
        description: '',
        position: 0,
        backlogPosition: 0,
        offsetY: 40,
        prUrls: [],
        relatedItems: [],
        assignee: '',
        closeReason: '',
        solution: '',
        favorite: false,
        dueAt: null,
        createdAt: '',
        updatedAt: '',
      },
    ],
    settings,
  });
}

describe('Board mobile column select', () => {
  let matchMediaMatches = false;
  let listeners: Array<(ev: MediaQueryListEvent) => void> = [];

  // matchMedia の差し替えを戻す。戻さないと、同じワーカーで後に走るボードのテストがモバイル表示になる。
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    matchMediaMatches = false;
    listeners = [];
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: matchMediaMatches,
        media: query,
        addEventListener: (_: string, cb: (ev: MediaQueryListEvent) => void) => {
          listeners.push(cb);
        },
        removeEventListener: (_: string, cb: (ev: MediaQueryListEvent) => void) => {
          listeners = listeners.filter((l) => l !== cb);
        },
        dispatchEvent: () => false,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
      })),
    );
  });

  function mount(api: Partial<Api> = {}) {
    const boardData = sample({ cardLayout: 'free', mobileBoardColumnId: 99 });
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(boardData),
            patchBoardSettings: vi.fn(() =>
              of({ settings: { cardLayout: 'free', mobileBoardColumnId: 2 } }),
            ),
            listCommandTemplates: () => of({ templates: [] }),
            listItemCommandTemplatesByNumber: () => of({ templates: [] }),
            listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: { board: { query: string; statusIds: number[] }; backlog: { query: string; statusIds: number[] } }) => of(f),
            ...api,
          },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    return f;
  }

  it('desktop: no status select, all columns, free layout honored', async () => {
    matchMediaMatches = false;
    const f = mount();
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.querySelector('select[aria-label="表示するステータス"]')).toBeNull();
    expect(f.nativeElement.querySelectorAll('.kanban-column').length).toBe(3);
    expect(f.componentInstance.isFreeLayout()).toBe(true);
    expect(f.componentInstance.selectedMobileColumnId()).toBe(1);
  });

  it('mobile: select + one column + effective pack', async () => {
    matchMediaMatches = true;
    const f = mount();
    await f.whenStable();
    f.detectChanges();
    const select = f.nativeElement.querySelector(
      'select[aria-label="表示するステータス"]',
    ) as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.options.length).toBe(3);
    expect(f.nativeElement.querySelectorAll('.kanban-column').length).toBe(1);
    expect(f.nativeElement.querySelector('.layout-toggle')).toBeNull();
    expect(f.componentInstance.isFreeLayout()).toBe(false);
    expect(f.nativeElement.querySelector('.card-list-free')).toBeNull();
    expect(f.componentInstance.canReorderItems()).toBe(true);
    expect(f.componentInstance.canReorder()).toBe(false);
    expect(f.nativeElement.querySelector('[cdkdragdisabled="true"]')).toBeNull();
  });

  it('mobile: empty columns disables select', async () => {
    matchMediaMatches = true;
    const f = mount({
      board: () => of(normalizeBoardData({ columns: [], items: [], settings: { cardLayout: 'pack', activeProjectId: 1 } })),
    });
    await f.whenStable();
    f.detectChanges();
    const select = f.nativeElement.querySelector(
      'select[aria-label="表示するステータス"]',
    ) as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });

  it('mobile: change persists and rolls back on failure', async () => {
    matchMediaMatches = true;
    const patchBoardSettings = vi.fn(() =>
      of({ settings: { cardLayout: 'free' as const, mobileBoardColumnId: 2 } }),
    );
    const f = mount({ patchBoardSettings });
    await f.whenStable();
    f.detectChanges();
    await f.componentInstance.onMobileColumnChange('2');
    expect(patchBoardSettings).toHaveBeenCalledWith({ mobileBoardColumnId: 2 });
    expect(f.componentInstance.selectedMobileColumnId()).toBe(2);

    const failing = vi.fn(() => throwError(() => ({ status: 500, message: 'fail' })));
    TestBed.resetTestingModule();
    matchMediaMatches = true;
    const f2 = mount({
      patchBoardSettings: failing,
      board: () => of(sample({ cardLayout: 'pack', mobileBoardColumnId: 1 })),
    });
    await f2.whenStable();
    await f2.componentInstance.onMobileColumnChange('3');
    expect(f2.componentInstance.selectedMobileColumnId()).toBe(1);
    expect(f2.componentInstance.reorderError()).toBeTruthy();
  });

  it('ignores select change while settingsSaving', async () => {
    matchMediaMatches = true;
    const patchBoardSettings = vi.fn(() =>
      of({ settings: { cardLayout: 'pack' as const, mobileBoardColumnId: 2 } }),
    );
    const f = mount({
      patchBoardSettings,
      board: () => of(sample({ cardLayout: 'pack', mobileBoardColumnId: 1 })),
    });
    await f.whenStable();
    f.componentInstance.settingsSaving.set(true);
    await f.componentInstance.onMobileColumnChange('2');
    expect(patchBoardSettings).not.toHaveBeenCalled();
  });

  it('keeps persisted free cardLayout while mobile forces pack UI', async () => {
    matchMediaMatches = true;
    const f = mount({
      board: () => of(sample({ cardLayout: 'free', mobileBoardColumnId: 1 })),
    });
    await f.whenStable();
    f.detectChanges();
    expect(f.componentInstance.data().settings.cardLayout).toBe('free');
    expect(f.componentInstance.isFreeLayout()).toBe(false);
  });

  it('blocks live refresh while settingsSaving', async () => {
    matchMediaMatches = true;
    const f = mount({
      board: () => of(sample({ cardLayout: 'pack', mobileBoardColumnId: 1 })),
    });
    await f.whenStable();
    const board = f.componentInstance;
    board.settingsSaving.set(false);
    expect(
      !board.loading() &&
        !board.reordering() &&
        !board.saving() &&
        !board.settingsSaving() &&
        !board.layoutSwitching() &&
        board.modal() === null &&
        board.draggingColumnId() === null &&
        board.draggingItemId() === null,
    ).toBe(true);
    board.settingsSaving.set(true);
    expect(board.settingsSaving()).toBe(true);
    // Same predicate as startLiveRefresh enabled() in ngOnInit.
    expect(
      !board.loading() &&
        !board.reordering() &&
        !board.saving() &&
        !board.settingsSaving() &&
        !board.layoutSwitching() &&
        board.modal() === null &&
        board.draggingColumnId() === null &&
        board.draggingItemId() === null,
    ).toBe(false);
  });
});


