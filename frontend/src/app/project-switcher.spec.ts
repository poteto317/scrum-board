import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, Routes } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { Column, Item } from './models';
import { ProjectBoardCache } from './project-board-cache';
import { ProjectSession } from './project-session';
import { ProjectSwitcher } from './project-switcher';

@Component({ standalone: true, template: '' })
class SpecStubPage {}

const chromeToggleRoutes: Routes = [
  { path: 'login', component: SpecStubPage },
  { path: '', component: SpecStubPage },
];

const projects = [
  { id: 1, name: 'メイン', position: 0 },
  { id: 2, name: '次', position: 1 },
];

function projectTrigger(f: { nativeElement: HTMLElement }): HTMLButtonElement {
  return f.nativeElement.querySelector('#project-select-trigger') as HTMLButtonElement;
}

function openProjectMenu(f: { detectChanges: () => void; nativeElement: HTMLElement }) {
  projectTrigger(f).click();
  f.detectChanges();
}

function projectOptionLabels(f: { nativeElement: HTMLElement }): string[] {
  return Array.from(
    f.nativeElement.querySelectorAll('#project-select-list [role="option"] .project-option-name'),
  ).map((el) => (el.textContent ?? '').trim());
}

function selectProjectOption(
  f: { detectChanges: () => void; nativeElement: HTMLElement },
  id: number,
) {
  openProjectMenu(f);
  (f.nativeElement.querySelector(`#project-option-${id}`) as HTMLElement | null)?.click();
  f.detectChanges();
}

function setupSwitcher(extra: Record<string, unknown> = {}, routerRoutes: Routes = []) {
  const api = {
    listProjects: vi.fn(() => of({ projects })),
    board: vi.fn(() =>
      of({
        columns: [],
        items: [],
        settings: { cardLayout: 'pack', activeProjectId: 1 },
      }),
    ),
    patchBoardSettings: vi.fn((body: { activeProjectId: number }) =>
      of({ settings: { cardLayout: 'pack', activeProjectId: body.activeProjectId } }),
    ),
    ...extra,
  };
  TestBed.configureTestingModule({
    imports: [ProjectSwitcher],
    providers: [provideRouter(routerRoutes), { provide: Api, useValue: api }],
  });
  const session = TestBed.inject(ProjectSession);
  session.load();
  const f = TestBed.createComponent(ProjectSwitcher);
  f.detectChanges();
  return { f, api, session };
}

describe('ProjectSwitcher', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  const statusColumns: Column[] = [
    { id: 1, name: 'Todo', position: 0 },
    { id: 2, name: 'Doing', position: 1 },
    { id: 9, name: 'Review', position: 2 },
  ];

  function cacheItem(id: number, projectId: number, columnId: number): Item {
    return {
      id,
      number: id,
      projectId,
      columnId,
      title: `t${id}`,
      description: '',
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
    };
  }

  function setup(extra: Record<string, unknown> = {}, routerRoutes: Routes = []) {
    return setupSwitcher(extra, routerRoutes);
  }

  it('loads projects into the header select', () => {
    const { f, session } = setup();
    const trigger = projectTrigger(f);
    expect(session.activeId()).toBe(1);
    expect(session.bootstrapped()).toBe(true);
    expect(trigger.textContent?.trim()).toBe('メイン');
    openProjectMenu(f);
    expect(projectOptionLabels(f)).toEqual(['メイン', '次']);
    expect(f.nativeElement.querySelector('.workspace-name')).toBeNull();
  });

  it('shows a loading select until project session is bootstrapped', () => {
    const pendingProjects = new Subject<{ projects: typeof projects }>();
    const pendingBoard = new Subject<{
      columns: [];
      items: [];
      settings: { cardLayout: 'pack'; activeProjectId: number };
    }>();
    const { f, session } = setup({
      listProjects: () => pendingProjects.asObservable(),
      board: () => pendingBoard.asObservable(),
    });
    expect(session.bootstrapped()).toBe(false);
    const loading = projectTrigger(f);
    expect(loading.disabled).toBe(true);
    expect(loading.textContent?.trim()).toBe('…');
    pendingProjects.next({ projects });
    pendingBoard.next({
      columns: [],
      items: [],
      settings: { cardLayout: 'pack', activeProjectId: 2 },
    });
    pendingProjects.complete();
    pendingBoard.complete();
    f.detectChanges();
    expect(session.bootstrapped()).toBe(true);
    expect(session.activeId()).toBe(2);
    const trigger = projectTrigger(f);
    expect(trigger.disabled).toBe(false);
    expect(trigger.textContent?.trim()).toBe('次');
    openProjectMenu(f);
    expect(projectOptionLabels(f)).toEqual(['次', 'メイン']);
  });

  it('does not prefetch while switching or mutating', () => {
    const { f, api, session } = setup();
    const trigger = projectTrigger(f);
    api.board.mockClear();
    session.switching.set(true);
    trigger.dispatchEvent(new Event('focus'));
    trigger.dispatchEvent(new Event('pointerdown'));
    expect(api.board).not.toHaveBeenCalled();
    session.switching.set(false);
    session.mutating.set(true);
    trigger.dispatchEvent(new Event('focus'));
    trigger.dispatchEvent(new Event('pointerdown'));
    expect(api.board).not.toHaveBeenCalled();
  });

  it('disables the project trigger while mutating', () => {
    const { f, session } = setup();
    const trigger = projectTrigger(f);
    expect(trigger.disabled).toBe(false);
    session.mutating.set(true);
    f.detectChanges();
    expect(trigger.disabled).toBe(true);
  });

  it('updates the select after a successful switch when no board is mounted', async () => {
    const { f, api, session } = setup(undefined, chromeToggleRoutes);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    f.detectChanges();
    selectProjectOption(f, 2);
    expect(api.patchBoardSettings).toHaveBeenCalledWith({ activeProjectId: 2 });
    expect(session.activeId()).toBe(2);
    expect(session.switching()).toBe(false);
    expect(projectTrigger(f).textContent?.trim()).toBe('次');
    await f.whenStable();
    expect(router.url).toContain('project=2');
  });

  it('does not update the URL when header switch fails', async () => {
    const { f } = setup(
      {
        patchBoardSettings: () => throwError(() => ({ error: { message: '切替失敗' } })),
      },
      chromeToggleRoutes,
    );
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    const navigateSpy = vi.spyOn(router, 'navigateByUrl');
    selectProjectOption(f, 2);
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(router.url).toBe('/');
  });

  it('refreshes other projects on select focus and pointerdown even when warm', () => {
    const { f, api, session } = setup();
    session.activeId.set(1);
    TestBed.inject(ProjectBoardCache).putBoard(2, [cacheItem(10, 2, 2)], statusColumns);
    const trigger = projectTrigger(f);
    api.board.mockClear();
    trigger.dispatchEvent(new Event('focus'));
    expect(api.board).toHaveBeenCalledWith(2);
    expect(api.board.mock.calls.every((c: unknown[]) => c[0] === 2)).toBe(true);
    api.board.mockClear();
    trigger.dispatchEvent(new Event('pointerdown'));
    expect(api.board).toHaveBeenCalledWith(2);
  });

  it('refreshes other projects when the project menu opens via click', () => {
    const { f, api, session } = setup();
    session.activeId.set(1);
    api.board.mockClear();
    openProjectMenu(f);
    expect(api.board).toHaveBeenCalledWith(2);
    expect(api.board.mock.calls.every((c: unknown[]) => c[0] === 2)).toBe(true);
  });

  it('refreshes other projects when the menu opens via Enter without pointerdown', () => {
    const { f, api, session } = setup();
    session.activeId.set(1);
    const trigger = projectTrigger(f);
    api.board.mockClear();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    f.detectChanges();
    expect(f.nativeElement.querySelector('#project-select-list')).toBeTruthy();
    expect(api.board).toHaveBeenCalledWith(2);
    expect(api.board.mock.calls.every((c: unknown[]) => c[0] === 2)).toBe(true);
  });

  it('does not refresh while switching', () => {
    const { f, api, session } = setup();
    session.switching.set(true);
    const trigger = projectTrigger(f);
    api.board.mockClear();
    trigger.dispatchEvent(new Event('focus'));
    trigger.dispatchEvent(new Event('pointerdown'));
    expect(api.board).not.toHaveBeenCalled();
  });

  it('restores the previous project when the switch PATCH fails', () => {
    const { f, session } = setup({
      patchBoardSettings: () => throwError(() => ({ error: { message: '切替失敗' } })),
    });
    selectProjectOption(f, 2);
    expect(session.activeId()).toBe(1);
    expect(session.switching()).toBe(false);
    expect(projectTrigger(f).textContent?.trim()).toBe('メイン');
    expect(f.nativeElement.querySelector('.project-error')?.textContent).toContain('切替失敗');
  });

  it('shows ProjectSession.error as an alert only while it is set', () => {
    const { f, session } = setup();
    const alert = () => f.nativeElement.querySelector('.project-error[role="alert"]');
    expect(alert()).toBeNull();
    session.error.set('プロジェクトが見つかりません');
    f.detectChanges();
    expect(alert()?.textContent).toContain('プロジェクトが見つかりません');
    session.error.set('');
    f.detectChanges();
    expect(alert()).toBeNull();
  });

  it('lists the active project first even when it is last by position', () => {
    const { f, session } = setup({
      listProjects: () =>
        of({
          projects: [
            { id: 1, name: 'メイン', position: 0 },
            { id: 2, name: '次', position: 1 },
            { id: 3, name: '三', position: 2 },
          ],
        }),
      board: () =>
        of({
          columns: [],
          items: [],
          settings: { cardLayout: 'pack', activeProjectId: 3 },
        }),
    });
    expect(session.activeId()).toBe(3);
    openProjectMenu(f);
    expect(projectOptionLabels(f)).toEqual(['三', 'メイン', '次']);
  });

  it('opens the list below the trigger', async () => {
    const { f } = setup();
    openProjectMenu(f);
    const panel = f.nativeElement.querySelector('#project-select-list') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(getComputedStyle(panel).top).toBe('100%');
    expect(getComputedStyle(panel).position).toBe('absolute');
    expect(getComputedStyle(panel).left).toBe('50%');
    expect(getComputedStyle(panel).right).toBe('auto');
    expect(getComputedStyle(panel).transform).toContain('translateX(-50%)');
    await Promise.resolve();
    f.detectChanges();
    expect(panel.style.maxHeight).toMatch(/^\d+px$/);
    const maxHeightPx = Number.parseInt(panel.style.maxHeight, 10);
    expect(maxHeightPx).toBeGreaterThan(0);
    expect(maxHeightPx).toBeLessThanOrEqual(360);
  });

  it('uses the enlarged trigger size from the component stylesheet', () => {
    const { f } = setup();
    const trigger = projectTrigger(f);
    expect(getComputedStyle(trigger).maxWidth).toBe('360px');
    expect(getComputedStyle(trigger).fontSize).toBe('16px');
  });

  it('moves highlight with arrows and selects with Enter', () => {
    const { f, api } = setup();
    openProjectMenu(f);
    const trigger = projectTrigger(f);
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    f.detectChanges();
    expect(
      f.nativeElement.querySelector('#project-option-2')?.classList.contains('is-highlighted'),
    ).toBe(true);
    api.patchBoardSettings.mockClear();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    f.detectChanges();
    expect(api.patchBoardSettings).toHaveBeenCalledWith({ activeProjectId: 2 });
    expect(f.nativeElement.querySelector('#project-select-list')).toBeNull();
  });

  it('closes when activeId becomes null while open', () => {
    const { f, session } = setup();
    openProjectMenu(f);
    expect(f.nativeElement.querySelector('#project-select-list')).toBeTruthy();
    session.activeId.set(null);
    f.detectChanges();
    expect(f.nativeElement.querySelector('#project-select-list')).toBeNull();
  });

  it('closes on Escape and restores focus to the trigger', async () => {
    const { f } = setup();
    const trigger = projectTrigger(f);
    trigger.focus();
    openProjectMenu(f);
    expect(f.nativeElement.querySelector('#project-select-list')).toBeTruthy();
    f.componentInstance.onProjectMenuEscape();
    f.detectChanges();
    await Promise.resolve();
    expect(f.nativeElement.querySelector('#project-select-list')).toBeNull();
    expect(document.activeElement).toBe(projectTrigger(f));
  });

  it('closes on outside mousedown without selecting', () => {
    const { f, api } = setup();
    openProjectMenu(f);
    api.patchBoardSettings.mockClear();
    f.componentInstance.onProjectMenuDocumentMouseDown(
      new MouseEvent('mousedown', { bubbles: true }),
    );
    f.detectChanges();
    expect(f.nativeElement.querySelector('#project-select-list')).toBeNull();
    expect(api.patchBoardSettings).not.toHaveBeenCalled();
  });

  it('does not open on ArrowUp while closed', () => {
    const { f } = setup();
    const trigger = projectTrigger(f);
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    f.detectChanges();
    expect(f.nativeElement.querySelector('#project-select-list')).toBeNull();
  });

  it('closes on Space while open without switching', () => {
    const { f, api } = setup();
    openProjectMenu(f);
    api.patchBoardSettings.mockClear();
    const trigger = projectTrigger(f);
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    f.detectChanges();
    expect(f.nativeElement.querySelector('#project-select-list')).toBeNull();
    expect(api.patchBoardSettings).not.toHaveBeenCalled();
  });

  it('exposes listbox ARIA on the trigger and options', () => {
    const { f } = setup();
    const trigger = projectTrigger(f);
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    openProjectMenu(f);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const list = f.nativeElement.querySelector('#project-select-list');
    expect(list?.getAttribute('role')).toBe('listbox');
    expect(
      list
        ?.querySelector('[role="option"][aria-selected="true"] .project-option-name')
        ?.textContent?.trim(),
    ).toBe('メイン');
  });

  it('shows Doing and Review status dots from the board cache (L-060)', () => {
    const { f } = setup();
    const cache = TestBed.inject(ProjectBoardCache);
    cache.putBoard(2, [cacheItem(10, 2, 2), cacheItem(11, 2, 9)], statusColumns);
    openProjectMenu(f);
    const option = f.nativeElement.querySelector('#project-option-2') as HTMLElement;
    expect(option.getAttribute('aria-label')).toBe('次, Doing と Review');
    expect(option.querySelector('.doing .status-dot')).toBeTruthy();
    expect(option.querySelector('.review .status-dot')).toBeTruthy();
    const cold = f.nativeElement.querySelector('#project-option-1') as HTMLElement;
    expect(cold.getAttribute('aria-label')).toBe('メイン');
    expect(cold.querySelector('.status-dot')).toBeNull();
  });

  it('fills status dots after prefetch while the menu stays open', () => {
    const { f } = setup();
    openProjectMenu(f);
    const option = f.nativeElement.querySelector('#project-option-2') as HTMLElement;
    expect(option.querySelector('.status-dot')).toBeNull();
    TestBed.inject(ProjectBoardCache).putBoard(2, [cacheItem(10, 2, 2)], statusColumns);
    f.detectChanges();
    expect(option.getAttribute('aria-label')).toBe('次, Doing');
    expect(option.querySelector('.doing .status-dot')).toBeTruthy();
  });

  it('updates open-menu status dots when refreshOthers lands newer board data', () => {
    const { f, api, session } = setup();
    session.activeId.set(1);
    TestBed.inject(ProjectBoardCache).putBoard(2, [cacheItem(10, 2, 2)], statusColumns);
    const held = new Subject<unknown>();
    api.board.mockImplementation(() => held.asObservable() as ReturnType<typeof api.board>);
    api.board.mockClear();
    openProjectMenu(f);
    const option = f.nativeElement.querySelector('#project-option-2') as HTMLElement;
    expect(option.getAttribute('aria-label')).toBe('次, Doing');
    expect(option.querySelector('.doing .status-dot')).toBeTruthy();
    expect(api.board).toHaveBeenCalledWith(2);
    held.next({
      items: [cacheItem(11, 2, 9)],
      columns: statusColumns,
      settings: { cardLayout: 'pack', activeProjectId: 1 },
    });
    held.complete();
    f.detectChanges();
    expect(option.getAttribute('aria-label')).toBe('次, Review');
    expect(option.querySelector('.review .status-dot')).toBeTruthy();
  });

  it('soft-prefetches backlog for other projects on backlog route', async () => {
    const backlog = vi.fn(() => of({ items: [] }));
    const { f, api, session } = setup({ backlog }, [
      { path: '', component: SpecStubPage },
      { path: 'backlog', component: SpecStubPage },
    ]);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/backlog');
    f.detectChanges();
    session.activeId.set(1);
    api.board.mockClear();
    backlog.mockClear();
    projectTrigger(f).dispatchEvent(new Event('focus'));
    expect(api.board).toHaveBeenCalledWith(2);
    expect(backlog).toHaveBeenCalledWith(2);
  });

  it('shows Todo fallback without .todo wrapper class', () => {
    const { f } = setup();
    TestBed.inject(ProjectBoardCache).putBoard(2, [cacheItem(10, 2, 1)], statusColumns);
    openProjectMenu(f);
    const option = f.nativeElement.querySelector('#project-option-2') as HTMLElement;
    expect(option.getAttribute('aria-label')).toBe('次, Todo');
    expect(option.querySelector('.todo')).toBeNull();
    expect(option.querySelector('.project-status-dots > .status-dot')).toBeTruthy();
  });

  it('closes on Escape from a document keydown event', async () => {
    const { f } = setup();
    projectTrigger(f).focus();
    openProjectMenu(f);
    expect(f.nativeElement.querySelector('#project-select-list')).toBeTruthy();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.detectChanges();
    await Promise.resolve();
    expect(f.nativeElement.querySelector('#project-select-list')).toBeNull();
    expect(document.activeElement).toBe(projectTrigger(f));
  });

  it('closes on a document mousedown outside the switcher', () => {
    const { f, api } = setup();
    openProjectMenu(f);
    api.patchBoardSettings.mockClear();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    f.detectChanges();
    expect(f.nativeElement.querySelector('#project-select-list')).toBeNull();
    expect(api.patchBoardSettings).not.toHaveBeenCalled();
  });

  it('keeps the menu open on a mousedown inside the switcher', () => {
    const { f } = setup();
    openProjectMenu(f);
    projectTrigger(f).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    f.detectChanges();
    expect(f.nativeElement.querySelector('#project-select-list')).toBeTruthy();
  });

  it('does not rewrite ?project= when the route changed before the switch completed', async () => {
    const held = new Subject<{ settings: { cardLayout: 'pack'; activeProjectId: number } }>();
    const { f, session } = setup({ patchBoardSettings: () => held.asObservable() }, [
      { path: '', component: SpecStubPage },
      { path: 'other', component: SpecStubPage },
    ]);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    selectProjectOption(f, 2);
    await router.navigateByUrl('/other');
    const navigateSpy = vi.spyOn(router, 'navigateByUrl');
    held.next({ settings: { cardLayout: 'pack', activeProjectId: 2 } });
    held.complete();
    await f.whenStable();
    expect(session.activeId()).toBe(2);
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(router.url).toBe('/other');
  });
});
