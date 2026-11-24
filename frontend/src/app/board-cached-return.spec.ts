import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { Board } from './board';
import { BoardData, Item } from './models';
import { ProjectBoardCache } from './project-board-cache';
import { ProjectSession } from './project-session';

const SPINNER = 'ボードを読み込んでいます';

function card(id: number, title: string): Item {
  return {
    id,
    number: id,
    projectId: 1,
    columnId: 1,
    title,
    description: '',
    position: id - 1,
    backlogPosition: id - 1,
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
  };
}

function boardData(titles: string[]): BoardData {
  return {
    columns: [
      { id: 1, name: 'Todo', position: 0 },
      { id: 2, name: 'Doing', position: 1 },
    ],
    items: titles.map((t, i) => card(i + 1, t)),
    settings: { cardLayout: 'pack', activeProjectId: 1 },
  };
}

/** Mounts Board as after "list -> detail -> back": a fresh component, an active project, a cache. */
function mountBoard(options: {
  cached?: BoardData;
  withSettings?: boolean;
  activeId?: number | null;
  switching?: boolean;
}) {
  const held = new Subject<BoardData>();
  const patchBoardSettings = vi.fn(() => new Subject<never>());
  const board = vi.fn(() => held.asObservable());
  TestBed.configureTestingModule({
    imports: [Board],
    providers: [
      provideRouter([]),
      {
        provide: Api,
        useValue: {
          board,
          patchBoardSettings,
          reorderItems: vi.fn(),
          reorderColumns: vi.fn(),
          listCommandTemplates: () => of({ templates: [] }),
          listItemCommandTemplatesByNumber: () => of({ templates: [] }),
          listFilter: () =>
            of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
          putListFilter: (f: unknown) => of(f),
        },
      },
    ],
  });
  const session = TestBed.inject(ProjectSession);
  session.activeId.set(options.activeId === undefined ? 1 : options.activeId);
  session.switching.set(options.switching === true);
  const cache = TestBed.inject(ProjectBoardCache);
  if (options.cached) {
    const c = options.cached;
    cache.putBoard(1, c.items, c.columns, options.withSettings === false ? undefined : c.settings);
  }
  const f = TestBed.createComponent(Board);
  f.detectChanges();
  const titles = () => [...f.componentInstance.grouped().values()].flat().map((c) => c.title);
  return { f, held, board, cache, titles, session, patchBoardSettings };
}

describe('Board shown from the cache on return (#124)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('shows the previous content at once, with no loading panel, while the request is pending', () => {
    const { f, board, titles } = mountBoard({ cached: boardData(['A', 'B']) });
    expect(board).toHaveBeenCalledTimes(1);
    expect(titles()).toEqual(['A', 'B']);
    expect(f.nativeElement.textContent).not.toContain(SPINNER);
    f.destroy();
  });

  it('replaces the cached content with the response, and the cache with the fresh board', () => {
    const { f, held, cache, titles } = mountBoard({ cached: boardData(['A', 'B']) });
    held.next(boardData(['A', 'B', 'C']));
    held.complete();
    f.detectChanges();
    expect(titles()).toEqual(['A', 'B', 'C']);
    expect(f.componentInstance.loading()).toBe(false);
    expect(cache.getBoard(1)?.map((i) => i.title)).toEqual(['A', 'B', 'C']);
    f.destroy();
  });

  it('keeps editing blocked until the fresh board has arrived', () => {
    const { f, held } = mountBoard({ cached: boardData(['A', 'B']) });
    expect(f.componentInstance.loading()).toBe(true);
    expect(f.componentInstance.canReorderItems()).toBe(false);
    held.next(boardData(['A', 'B']));
    held.complete();
    expect(f.componentInstance.canReorderItems()).toBe(true);
    f.destroy();
  });

  it('shows the loading panel when nothing is cached', () => {
    const { f, titles } = mountBoard({});
    expect(f.nativeElement.textContent).toContain(SPINNER);
    expect(titles()).toEqual([]);
    f.destroy();
  });

  it('shows the loading panel when the cached board has no settings (it cannot be laid out)', () => {
    const { f, titles } = mountBoard({ cached: boardData(['A']), withSettings: false });
    expect(f.nativeElement.textContent).toContain(SPINNER);
    expect(titles()).toEqual([]);
    f.destroy();
  });

  it('refuses to open the add forms or change the mobile column while the cached board is shown', () => {
    const { f, patchBoardSettings, held } = mountBoard({ cached: boardData(['A', 'B']) });
    const board = f.componentInstance;
    board.openItem();
    board.openColumn();
    expect(board.modal()).toBeNull();
    void board.onMobileColumnChange('2');
    expect(patchBoardSettings).not.toHaveBeenCalled();
    held.next(boardData(['A', 'B']));
    held.complete();
    board.openItem();
    expect(board.modal()).toBe('item');
    f.destroy();
  });

  it('goes back to the loading panel when the project is switched while the cached board is shown', () => {
    const { f, titles } = mountBoard({ cached: boardData(['A', 'B']) });
    expect(titles()).toEqual(['A', 'B']);
    (
      f.componentInstance as unknown as { reloadAfterProjectSwitch(): void }
    ).reloadAfterProjectSwitch();
    f.detectChanges();
    expect(f.componentInstance.showingCached()).toBe(false);
    expect(f.nativeElement.textContent).toContain(SPINNER);
    f.destroy();
  });

  it('does not show a board whose settings belong to another project', () => {
    const other = boardData(['A']);
    other.settings = { cardLayout: 'pack', activeProjectId: 2 };
    const { f, titles } = mountBoard({ cached: other });
    expect(f.nativeElement.textContent).toContain(SPINNER);
    expect(titles()).toEqual([]);
    f.destroy();
  });

  it('shows the loading panel while a project switch is in progress', () => {
    const { f, titles } = mountBoard({ cached: boardData(['A']), switching: true });
    expect(f.nativeElement.textContent).toContain(SPINNER);
    expect(titles()).toEqual([]);
    f.destroy();
  });

  it('shows the loading panel when no project is active yet', () => {
    const { f, titles } = mountBoard({ cached: boardData(['A']), activeId: null });
    expect(f.nativeElement.textContent).toContain(SPINNER);
    expect(titles()).toEqual([]);
    f.destroy();
  });

  it('drops the cached cards when the request fails, so nothing stale stays published', () => {
    const { f, held, titles } = mountBoard({ cached: boardData(['A', 'B']) });
    held.error({ error: { message: '失敗' } });
    f.detectChanges();
    expect(titles()).toEqual([]);
    f.destroy();
  });

  it('keeps the same board object, and ends loading, when the response equals the cached board', () => {
    const { f, held } = mountBoard({ cached: boardData(['A', 'B']) });
    const before = f.componentInstance.data();
    held.next(boardData(['A', 'B']));
    held.complete();
    expect(f.componentInstance.data()).toBe(before);
    expect(f.componentInstance.loading()).toBe(false);
    expect(f.componentInstance.showingCached()).toBe(false);
    f.destroy();
  });

  it('saves the chosen mobile column into the cache', () => {
    const { f, held, cache, patchBoardSettings } = mountBoard({ cached: boardData(['A', 'B']) });
    held.next(boardData(['A', 'B']));
    held.complete();
    const patch = new Subject<{ settings: { cardLayout: 'pack'; mobileBoardColumnId: number } }>();
    patchBoardSettings.mockReturnValue(patch as never);
    void f.componentInstance.onMobileColumnChange('2');
    patch.next({ settings: { cardLayout: 'pack', mobileBoardColumnId: 2 } });
    patch.complete();
    expect(cache.getBoardSnapshot(1)?.settings?.mobileBoardColumnId).toBe(2);
    f.destroy();
  });

  it('shows the error panel, not the stale cache, when the request fails', () => {
    const { f, held } = mountBoard({ cached: boardData(['A']) });
    held.error({ error: { message: '失敗' } });
    f.detectChanges();
    expect(f.componentInstance.error()).not.toBe('');
    expect(f.nativeElement.textContent).toContain('再試行');
    f.destroy();
  });
});
