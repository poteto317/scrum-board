import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { Backlog } from './backlog';
import { Column, Item } from './models';
import { ProjectBoardCache } from './project-board-cache';
import { ProjectSession } from './project-session';

const SPINNER = '読み込み中…';

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

const columns: Column[] = [
  { id: 1, name: 'Todo', position: 0 },
  { id: 2, name: 'Doing', position: 1 },
];

/** Mounts Backlog as after "list -> detail -> back": a fresh component, an active project, a cache. */
function mountBacklog(options: {
  cachedTitles?: string[];
  withColumns?: boolean;
  activeId?: number | null;
  switching?: boolean;
  ephemeral?: boolean;
}) {
  const heldBacklog = new Subject<{ items: Item[] }>();
  const heldBoard = new Subject<{ columns: Column[]; items: Item[] }>();
  const backlog = vi.fn(() => heldBacklog.asObservable());
  const board = vi.fn(() => heldBoard.asObservable());
  const reorderBacklog = vi.fn();
  const createItem = vi.fn();
  TestBed.configureTestingModule({
    imports: [Backlog],
    providers: [
      provideRouter([]),
      {
        provide: Api,
        useValue: {
          backlog,
          board,
          reorderBacklog,
          createItem,
          patchBoardSettings: vi.fn(),
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
  session.ephemeralActiveView.set(options.ephemeral === true);
  const cache = TestBed.inject(ProjectBoardCache);
  if (options.cachedTitles) {
    cache.putBacklog(
      1,
      options.cachedTitles.map((t, i) => card(i + 1, t)),
      options.withColumns === false ? undefined : columns,
    );
  }
  const f = TestBed.createComponent(Backlog);
  f.detectChanges();
  const titles = () => f.componentInstance.items().map((i) => i.title);
  const answer = (titlesNow: string[]) => {
    const items = titlesNow.map((t, i) => card(i + 1, t));
    heldBacklog.next({ items });
    heldBacklog.complete();
    heldBoard.next({ columns, items });
    heldBoard.complete();
  };
  return {
    f,
    backlog,
    board,
    cache,
    titles,
    answer,
    heldBacklog,
    heldBoard,
    reorderBacklog,
    createItem,
  };
}

describe('Backlog shown from the cache on return (#124)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('shows the previous content at once, with no loading panel, while the request is pending', () => {
    const { f, backlog, titles } = mountBacklog({ cachedTitles: ['A', 'B'] });
    expect(backlog).toHaveBeenCalledTimes(1);
    expect(titles()).toEqual(['A', 'B']);
    expect(f.componentInstance.columns()).toEqual(columns);
    expect(f.nativeElement.textContent).not.toContain(SPINNER);
    f.destroy();
  });

  it('replaces the cached content with the response, and the cache with the fresh backlog', () => {
    const { f, answer, cache, titles } = mountBacklog({ cachedTitles: ['A', 'B'] });
    answer(['A', 'B', 'C']);
    f.detectChanges();
    expect(titles()).toEqual(['A', 'B', 'C']);
    expect(f.componentInstance.loading()).toBe(false);
    expect(cache.getBacklogView(1)?.items.map((i) => i.title)).toEqual(['A', 'B', 'C']);
    f.destroy();
  });

  it('keeps editing blocked until the fresh backlog has arrived', () => {
    const { f, answer } = mountBacklog({ cachedTitles: ['A', 'B'] });
    expect(f.componentInstance.loading()).toBe(true);
    expect(f.componentInstance.canReorder()).toBe(false);
    answer(['A', 'B']);
    expect(f.componentInstance.canReorder()).toBe(true);
    f.destroy();
  });

  it('shows the loading panel when nothing is cached', () => {
    const { f, titles } = mountBacklog({});
    expect(f.nativeElement.textContent).toContain(SPINNER);
    expect(titles()).toEqual([]);
    f.destroy();
  });

  it('shows the loading panel when the cached backlog has no columns', () => {
    const { f, titles } = mountBacklog({ cachedTitles: ['A'], withColumns: false });
    expect(f.nativeElement.textContent).toContain(SPINNER);
    expect(titles()).toEqual([]);
    f.destroy();
  });

  it('shows the loading panel while a project switch is in progress', () => {
    const { f, titles } = mountBacklog({ cachedTitles: ['A'], switching: true });
    expect(f.nativeElement.textContent).toContain(SPINNER);
    expect(titles()).toEqual([]);
    f.destroy();
  });

  it('shows the loading panel when no project is active yet', () => {
    const { f, titles } = mountBacklog({ cachedTitles: ['A'], activeId: null });
    expect(f.nativeElement.textContent).toContain(SPINNER);
    expect(titles()).toEqual([]);
    f.destroy();
  });

  it('goes back to the loading panel when the project is switched while the cached backlog is shown', () => {
    const { f } = mountBacklog({ cachedTitles: ['A', 'B'] });
    (
      f.componentInstance as unknown as { reloadAfterProjectSwitch(): void }
    ).reloadAfterProjectSwitch();
    f.detectChanges();
    expect(f.componentInstance.showingCached()).toBe(false);
    expect(f.nativeElement.textContent).toContain(SPINNER);
    f.destroy();
  });

  it('drops the cached cards when the request fails, so nothing stale stays published', () => {
    const { f, heldBacklog, titles } = mountBacklog({ cachedTitles: ['A', 'B'] });
    heldBacklog.error({ error: { message: '失敗' } });
    f.detectChanges();
    expect(titles()).toEqual([]);
    expect(f.componentInstance.columns()).toEqual([]);
    f.destroy();
  });

  it('keeps the same item list, and ends loading, when the response equals the cached backlog', () => {
    const { f, answer } = mountBacklog({ cachedTitles: ['A', 'B'] });
    const before = f.componentInstance.items();
    answer(['A', 'B']);
    expect(f.componentInstance.items()).toBe(before);
    expect(f.componentInstance.loading()).toBe(false);
    expect(f.componentInstance.showingCached()).toBe(false);
    f.destroy();
  });

  it('keeps the cache in step with a reorder, so the next return shows the new order', () => {
    const { f, answer, cache, reorderBacklog } = mountBacklog({ cachedTitles: ['A', 'B'] });
    answer(['A', 'B']);
    reorderBacklog.mockReturnValue(of({ items: [card(2, 'B'), card(1, 'A')] }));
    (f.componentInstance as unknown as { applyReorder(a: number, b: number): void }).applyReorder(
      0,
      1,
    );
    expect(cache.getBacklogView(1)?.items.map((i) => i.title)).toEqual(['B', 'A']);
    f.destroy();
  });

  it('keeps the cache in step with an added item, so the next return shows it', () => {
    const { f, answer, cache, createItem } = mountBacklog({ cachedTitles: ['A', 'B'] });
    answer(['A', 'B']);
    createItem.mockReturnValue(of(card(3, 'New')));
    const backlog = f.componentInstance;
    backlog.itemForm.setValue({ title: 'New', description: '' });
    backlog.addItem();
    expect(cache.getBacklogView(1)?.items.map((i) => i.title)).toEqual(['A', 'B', 'New']);
    f.destroy();
  });

  it('does not show, nor store, a backlog while the view is a deep link (the fetch is not scoped to it)', () => {
    const { f, titles, answer, cache } = mountBacklog({ cachedTitles: ['A'], ephemeral: true });
    expect(f.nativeElement.textContent).toContain(SPINNER);
    expect(titles()).toEqual([]);
    answer(['Other project item']);
    expect(cache.getBacklogView(1)?.items.map((i) => i.title)).toEqual(['A']);
    f.destroy();
  });

  it('shows the error panel, not the stale cache, when the request fails', () => {
    const { f, heldBacklog } = mountBacklog({ cachedTitles: ['A'] });
    heldBacklog.error({ error: { message: '失敗' } });
    f.detectChanges();
    expect(f.componentInstance.error()).not.toBe('');
    expect(f.nativeElement.textContent).toContain('再読み込み');
    f.destroy();
  });
});
