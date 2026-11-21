import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, Routes } from '@angular/router';
import { EMPTY, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { App } from './app';
import { FavoritesSession } from './favorites-session';
import { Column, Item } from './models';
import { ProjectBoardCache } from './project-board-cache';
import { ProjectSession } from './project-session';
import { PROJECT_QUERY_NOT_FOUND } from './project-query';
import { SIDEBAR_COLLAPSED_KEY } from './sidebar-collapse-storage';

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

const headerMenuPrefs = {
  board: { hiddenIds: [] as string[] },
  backlog: { hiddenIds: [] as string[] },
  itemDetail: { hiddenIds: [] as string[] },
};

function openHeaderMenu(f: { detectChanges: () => void; nativeElement: HTMLElement }) {
  (f.nativeElement.querySelector('#header-menu-trigger') as HTMLButtonElement).click();
  f.detectChanges();
}

function headerMenuItem(
  f: { nativeElement: HTMLElement },
  id: string,
): HTMLButtonElement | null {
  return f.nativeElement.querySelector(`#header-menu-item-${id}`) as HTMLButtonElement | null;
}

function clickHeaderMenuItem(
  f: { detectChanges: () => void; nativeElement: HTMLElement },
  id: string,
) {
  openHeaderMenu(f);
  headerMenuItem(f, id)?.click();
  f.detectChanges();
}

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
  (
    f.nativeElement.querySelector(`#project-option-${id}`) as HTMLElement | null
  )?.click();
  f.detectChanges();
}

function setupApp(extra: Record<string, unknown> = {}, routerRoutes: Routes = []) {
  const api = {
    me: vi.fn(() =>
      of({ id: 1, loginName: 'admin', displayName: 'admin', role: 'admin', disabled: false }),
    ),
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
    createProject: vi.fn(() => of({ id: 3, name: '新規', position: 2 })),
    patchProject: vi.fn(() => of({ id: 1, name: '改名', position: 0 })),
    deleteProject: vi.fn(() => of(undefined)),
    headerMenu: vi.fn(() => of(headerMenuPrefs)),
    listUsers: vi.fn(() => of([])),
    ...extra,
  };
  TestBed.configureTestingModule({
    imports: [App],
    providers: [provideRouter(routerRoutes), { provide: Api, useValue: api }],
  });
  const f = TestBed.createComponent(App);
  f.detectChanges();
  return { f, api, session: TestBed.inject(ProjectSession) };
}

describe('App project switcher', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  function setup(extra: Record<string, unknown> = {}, routerRoutes: Routes = []) {
    return setupApp(extra, routerRoutes);
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

  it('keeps the app header sticky above content but below dialogs', () => {
    const { f } = setup();
    const header = f.nativeElement.querySelector('.app-header') as HTMLElement;
    expect(header).toBeTruthy();
    const style = getComputedStyle(header);
    expect(style.position).toBe('sticky');
    expect(style.top).toBe('0px');
    expect(style.zIndex).toBe('5');
  });

  it('disables delete when only one project remains', () => {
    const { f } = setup({
      listProjects: () => of({ projects: [projects[0]] }),
    });
    openHeaderMenu(f);
    expect(headerMenuItem(f, 'project_delete')?.disabled).toBe(true);
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

  it('prefetches other projects on select focus and pointerdown', () => {
    const { f, api, session } = setup();
    session.activeId.set(1);
    const trigger = projectTrigger(f);
    api.board.mockClear();
    trigger.dispatchEvent(new Event('focus'));
    expect(api.board).toHaveBeenCalledWith(2);
    expect(api.board.mock.calls.every((c: unknown[]) => c[0] === 2)).toBe(true);
    api.board.mockClear();
    trigger.dispatchEvent(new Event('pointerdown'));
    // warm after first prefetch — no new unscoped board() calls
    expect(api.board.mock.calls.every((c: unknown[]) => c[0] === 2)).toBe(true);
  });

  it('does not prefetch while switching', () => {
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
    await Promise.resolve();
    f.detectChanges();
    expect(panel.style.maxHeight).toMatch(/^\d+px$/);
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
      list?.querySelector('[role="option"][aria-selected="true"] .project-option-name')
        ?.textContent?.trim(),
    ).toBe('メイン');
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

  it('shows Doing and Review status dots from the board cache (L-060)', () => {
    const { f } = setup();
    const cache = TestBed.inject(ProjectBoardCache);
    cache.putBoard(
      2,
      [cacheItem(10, 2, 2), cacheItem(11, 2, 9)],
      statusColumns,
    );
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
    TestBed.inject(ProjectBoardCache).putBoard(
      2,
      [cacheItem(10, 2, 2)],
      statusColumns,
    );
    f.detectChanges();
    expect(option.getAttribute('aria-label')).toBe('次, Doing');
    expect(option.querySelector('.doing .status-dot')).toBeTruthy();
  });

  it('shows Todo fallback without .todo wrapper class', () => {
    const { f } = setup();
    TestBed.inject(ProjectBoardCache).putBoard(
      2,
      [cacheItem(10, 2, 1)],
      statusColumns,
    );
    openProjectMenu(f);
    const option = f.nativeElement.querySelector('#project-option-2') as HTMLElement;
    expect(option.getAttribute('aria-label')).toBe('次, Todo');
    expect(option.querySelector('.todo')).toBeNull();
    expect(option.querySelector('.project-status-dots > .status-dot')).toBeTruthy();
  });

  function withDialogPolyfill(f: ReturnType<typeof setup>['f'], run: () => void) {
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
    try {
      run();
    } finally {
      // Destroy dialog while polyfill still provides close() (jsdom has no native close).
      f.componentInstance.saving.set(false);
      f.componentInstance.projectModalOpen.set(false);
      f.detectChanges();
      proto.showModal = origShowModal;
      proto.close = origClose;
    }
  }

  it('opens a project add dialog instead of window.prompt', () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('無視');
    const { f } = setup();
    withDialogPolyfill(f, () => {
      clickHeaderMenuItem(f, 'project_add');
      f.detectChanges();
      expect(prompt).not.toHaveBeenCalled();
      expect(f.nativeElement.querySelector('#modal-project-title')?.textContent).toContain(
        'プロジェクトを追加',
      );
      openHeaderMenu(f);
      expect(headerMenuItem(f, 'project_add')?.disabled).toBe(true);
      expect(projectTrigger(f).disabled).toBe(true);
      expect(headerMenuItem(f, 'project_rename')?.disabled).toBe(true);
      expect(headerMenuItem(f, 'project_delete')?.disabled).toBe(true);
      f.componentInstance.projectForm.controls.name.setValue('下書き');
      f.detectChanges();
      expect(f.componentInstance.projectForm.controls.name.value).toBe('下書き');
    });
  });

  it('creates then switches to the new project and closes the dialog', async () => {
    const { f, api, session } = setup(undefined, chromeToggleRoutes);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    withDialogPolyfill(f, () => {
      clickHeaderMenuItem(f, 'project_add');
      f.detectChanges();
      f.componentInstance.projectForm.controls.name.setValue('新規');
      f.detectChanges();
      (f.nativeElement.querySelector('dialog form') as HTMLFormElement).dispatchEvent(
        new Event('submit'),
      );
      f.detectChanges();
      expect(api.createProject).toHaveBeenCalledWith('新規');
      expect(api.patchBoardSettings).toHaveBeenCalledWith({ activeProjectId: 3 });
      expect(session.activeId()).toBe(3);
      expect(f.nativeElement.querySelector('dialog')).toBeNull();
      expect(session.mutating()).toBe(false);
    });
    await f.whenStable();
    expect(router.url).toContain('project=3');
  });

  it('does not update the URL when switch after create fails', async () => {
    const { f } = setup(
      {
        patchBoardSettings: () => throwError(() => ({ error: { message: '切替失敗' } })),
      },
      chromeToggleRoutes,
    );
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    const navigateSpy = vi.spyOn(router, 'navigateByUrl');
    withDialogPolyfill(f, () => {
      clickHeaderMenuItem(f, 'project_add');
      f.detectChanges();
      f.componentInstance.projectForm.controls.name.setValue('新規');
      f.detectChanges();
      (f.nativeElement.querySelector('dialog form') as HTMLFormElement).dispatchEvent(
        new Event('submit'),
      );
      f.detectChanges();
      expect(navigateSpy).not.toHaveBeenCalled();
      expect(router.url).toBe('/');
    });
  });

  it('keeps the dialog open and shows formError when create fails', () => {
    const { f, session } = setup({
      createProject: () => throwError(() => ({ error: { message: '作成失敗' } })),
    });
    withDialogPolyfill(f, () => {
      clickHeaderMenuItem(f, 'project_add');
      f.detectChanges();
      f.componentInstance.projectForm.controls.name.setValue('新規');
      f.detectChanges();
      (f.nativeElement.querySelector('dialog form') as HTMLFormElement).dispatchEvent(
        new Event('submit'),
      );
      f.detectChanges();
      expect(session.projects().map((p) => p.name)).toEqual(['メイン', '次']);
      expect(f.componentInstance.projectForm.controls.name.value).toBe('新規');
      expect(f.nativeElement.querySelector('dialog .form-error')?.textContent).toContain(
        '作成失敗',
      );
      expect(f.nativeElement.querySelector('.project-error')).toBeNull();
      expect(f.nativeElement.querySelector('dialog')).toBeTruthy();
    });
  });

  it('does not POST when the name is empty or over 80 code points', () => {
    const { f, api } = setup();
    withDialogPolyfill(f, () => {
      clickHeaderMenuItem(f, 'project_add');
      f.detectChanges();
      f.componentInstance.projectForm.controls.name.setValue('   ');
      f.detectChanges();
      (f.nativeElement.querySelector('dialog form') as HTMLFormElement).dispatchEvent(
        new Event('submit'),
      );
      f.detectChanges();
      expect(api.createProject).not.toHaveBeenCalled();
      expect(f.nativeElement.querySelector('dialog')).toBeTruthy();

      f.componentInstance.projectForm.controls.name.setValue('a'.repeat(81));
      f.detectChanges();
      (f.nativeElement.querySelector('dialog form') as HTMLFormElement).dispatchEvent(
        new Event('submit'),
      );
      f.detectChanges();
      expect(api.createProject).not.toHaveBeenCalled();
      expect(f.nativeElement.querySelector('dialog .form-error')?.textContent).toMatch(
        /プロジェクト名を1〜80文字/,
      );
    });
  });

  it('shows header error when switchTo returns EMPTY after create', () => {
    const { f, session } = setup();
    withDialogPolyfill(f, () => {
      vi.spyOn(session, 'switchTo').mockReturnValue(EMPTY);
      clickHeaderMenuItem(f, 'project_add');
      f.detectChanges();
      f.componentInstance.projectForm.controls.name.setValue('新規');
      f.detectChanges();
      (f.nativeElement.querySelector('dialog form') as HTMLFormElement).dispatchEvent(
        new Event('submit'),
      );
      f.detectChanges();
      expect(session.projects().some((p) => p.name === '新規')).toBe(true);
      expect(f.nativeElement.querySelector('dialog')).toBeNull();
      expect(f.nativeElement.querySelector('.project-error')?.textContent).toContain(
        '切替できませんでした',
      );
      expect(session.mutating()).toBe(false);
      expect(f.componentInstance.saving()).toBe(false);
    });
  });

  it('keeps the new project when switchTo fails after create', () => {
    const { f, session } = setup({
      patchBoardSettings: () => throwError(() => ({ error: { message: '切替失敗' } })),
    });
    withDialogPolyfill(f, () => {
      clickHeaderMenuItem(f, 'project_add');
      f.detectChanges();
      f.componentInstance.projectForm.controls.name.setValue('新規');
      f.detectChanges();
      (f.nativeElement.querySelector('dialog form') as HTMLFormElement).dispatchEvent(
        new Event('submit'),
      );
      f.detectChanges();
      expect(session.projects().some((p) => p.name === '新規')).toBe(true);
      expect(session.activeId()).toBe(1);
      expect(f.nativeElement.querySelector('.project-error')?.textContent).toContain('切替失敗');
      expect(f.nativeElement.querySelector('dialog')).toBeNull();
    });
  });

  it('does not close on backdrop click; Esc closes when not saving', () => {
    const { f } = setup();
    withDialogPolyfill(f, () => {
      clickHeaderMenuItem(f, 'project_add');
      f.detectChanges();
      const dialog = f.nativeElement.querySelector('dialog') as HTMLDialogElement;
      dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      f.detectChanges();
      expect(f.nativeElement.querySelector('dialog')).toBeTruthy();
      dialog.dispatchEvent(new Event('cancel'));
      f.detectChanges();
      expect(f.nativeElement.querySelector('dialog')).toBeNull();
    });
  });

  it('does not close via Esc or × while saving', () => {
    const pending = new Subject<{ id: number; name: string; position: number }>();
    const { f } = setup({
      createProject: () => pending.asObservable(),
    });
    withDialogPolyfill(f, () => {
      clickHeaderMenuItem(f, 'project_add');
      f.detectChanges();
      f.componentInstance.projectForm.controls.name.setValue('新規');
      f.detectChanges();
      (f.nativeElement.querySelector('dialog form') as HTMLFormElement).dispatchEvent(
        new Event('submit'),
      );
      f.detectChanges();
      const dialog = f.nativeElement.querySelector('dialog') as HTMLDialogElement;
      const closeBtn = f.nativeElement.querySelector(
        'dialog .icon-button',
      ) as HTMLButtonElement;
      expect(closeBtn.disabled).toBe(true);
      dialog.dispatchEvent(new Event('cancel'));
      f.detectChanges();
      expect(f.nativeElement.querySelector('dialog')).toBeTruthy();
      // Leave create in-flight; withDialogPolyfill clears saving/open on teardown.
      void pending;
    });
  });

  it('keeps the project and shows the server message when delete returns 409', () => {
    const { f, session } = setup({
      deleteProject: () =>
        throwError(() => ({
          status: 409,
          error: { message: 'アイテムがあるため削除できません' },
        })),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    clickHeaderMenuItem(f, 'project_delete');
    f.detectChanges();
    expect(session.projects()).toHaveLength(2);
    expect(f.nativeElement.querySelector('.project-error')?.textContent).toContain('削除できません');
  });

  it('moves board/backlog nav into the sidebar and shows empty favorites', () => {
    const { f } = setup();
    const sidebar = f.nativeElement.querySelector('.app-sidebar') as HTMLElement;
    expect(sidebar).toBeTruthy();
    const links = [...sidebar.querySelectorAll('.app-nav a')].map((a) => ({
      href: a.getAttribute('href'),
      text: a.querySelector('.nav-label')?.textContent?.trim() ?? a.textContent?.trim(),
    }));
    expect(links).toEqual([
      { href: '/', text: 'ボード' },
      { href: '/backlog', text: 'バックログ' },
      { href: '/sprints', text: 'スプリント' },
    ]);
    expect(f.nativeElement.querySelector('header .app-nav')).toBeNull();
    expect(sidebar.querySelector('.sidebar-empty')?.textContent?.trim()).toBe('なし');
  });

  it('lists favorite items with untitled fallback and reloads after switch', () => {
    const { f, api, session } = setup({
      board: vi.fn(() =>
        of({
          columns: [],
          items: [
            {
              id: 1,
              number: 7,
              title: '  ',
              projectId: 1,
              favorite: true,
              columnId: 1,
              description: '',
              position: 0,
              backlogPosition: 0,
              offsetY: 0,
              prUrls: [],
              relatedItems: [],
              assignee: '',
              closeReason: '',
              solution: '',
              dueAt: null,
              createdAt: '',
              updatedAt: '',
            },
          ],
          settings: { cardLayout: 'pack', activeProjectId: 1 },
        }),
      ),
    });
    f.detectChanges();
    const favLink = f.nativeElement.querySelector(
      '.sidebar-favorite-list a',
    ) as HTMLAnchorElement | null;
    expect(favLink?.textContent?.trim()).toBe('（無題）');
    expect(favLink?.getAttribute('href')).toContain('/items/7');
    const favorites = TestBed.inject(FavoritesSession);
    const loadSpy = vi.spyOn(favorites, 'loadForActiveProject');
    selectProjectOption(f, 2);
    expect(session.activeId()).toBe(2);
    expect(loadSpy).toHaveBeenCalled();
    expect(api.board).toHaveBeenCalled();
  });
});

describe('App sidebar collapse', () => {
  beforeEach(() => {
    localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  function setup(extra: Record<string, unknown> = {}, routerRoutes: Routes = []) {
    return setupApp(extra, routerRoutes);
  }

  it('toggles the sidebar between expanded and rail', () => {
    const { f } = setup();
    const sidebar = () => f.nativeElement.querySelector('.app-sidebar') as HTMLElement;
    const toggle = () =>
      f.nativeElement.querySelector('.sidebar-toggle') as HTMLButtonElement;
    expect(sidebar().classList.contains('is-collapsed')).toBe(false);
    expect(sidebar().querySelector('.sidebar-favorites')).toBeTruthy();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-label')).toBe('サイドバーを閉じる');

    toggle().focus();
    toggle().click();
    f.detectChanges();
    expect(sidebar().classList.contains('is-collapsed')).toBe(true);
    expect(sidebar().querySelector('.sidebar-favorites')).toBeNull();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().getAttribute('aria-label')).toBe('サイドバーを開く');
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('1');
    expect(document.activeElement).toBe(toggle());

    const navLinks = [...sidebar().querySelectorAll('.app-nav a')] as HTMLAnchorElement[];
    expect(navLinks.map((a) => a.getAttribute('aria-label'))).toEqual([
      'ボード',
      'バックログ',
      'スプリント',
    ]);
    expect(navLinks.every((a) => a.querySelector('.nav-label') == null)).toBe(true);
    expect(navLinks.every((a) => (a.textContent ?? '').trim() === '')).toBe(true);

    toggle().click();
    f.detectChanges();
    expect(sidebar().classList.contains('is-collapsed')).toBe(false);
    expect(sidebar().querySelector('.sidebar-favorites')).toBeTruthy();
    expect(toggle().getAttribute('aria-label')).toBe('サイドバーを閉じる');
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('0');
    expect(document.activeElement).toBe(toggle());
  });

  it('restores rail state from localStorage on construct', () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1');
    const { f } = setup();
    const sidebar = f.nativeElement.querySelector('.app-sidebar') as HTMLElement;
    expect(sidebar.classList.contains('is-collapsed')).toBe(true);
    expect(sidebar.querySelector('.sidebar-favorites')).toBeNull();
  });

  it('keeps collapsed UI when localStorage setItem throws', () => {
    const { f } = setup();
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === SIDEBAR_COLLAPSED_KEY) {
        throw new DOMException('QuotaExceededError');
      }
      return original.call(this, key, value);
    });
    const toggle = f.nativeElement.querySelector('.sidebar-toggle') as HTMLButtonElement;
    toggle.click();
    f.detectChanges();
    expect(
      (f.nativeElement.querySelector('.app-sidebar') as HTMLElement).classList.contains(
        'is-collapsed',
      ),
    ).toBe(true);
    expect(f.nativeElement.querySelector('.sidebar-favorites')).toBeNull();
  });

  it('does not re-read collapsed state when chrome hides and returns', async () => {
    const { f } = setup({}, chromeToggleRoutes);
    const toggle = f.nativeElement.querySelector('.sidebar-toggle') as HTMLButtonElement;
    toggle.click();
    f.detectChanges();
    expect(f.componentInstance.collapsed()).toBe(true);
    // Poison storage: if showChrome toggles re-read, UI would expand again.
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '0');

    const router = TestBed.inject(Router);
    await router.navigateByUrl('/login');
    f.detectChanges();
    expect(f.nativeElement.querySelector('.app-sidebar')).toBeNull();
    expect(f.componentInstance.collapsed()).toBe(true);

    await router.navigateByUrl('/');
    f.detectChanges();
    const sidebar = f.nativeElement.querySelector('.app-sidebar') as HTMLElement;
    expect(sidebar?.classList.contains('is-collapsed')).toBe(true);
    expect(f.componentInstance.collapsed()).toBe(true);
  });

  it('prevents Enter/Space key repeat from toggling', () => {
    const { f } = setup();
    const toggle = f.nativeElement.querySelector('.sidebar-toggle') as HTMLButtonElement;
    const enterRepeat = new KeyboardEvent('keydown', {
      key: 'Enter',
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    toggle.dispatchEvent(enterRepeat);
    expect(enterRepeat.defaultPrevented).toBe(true);
    expect(f.componentInstance.collapsed()).toBe(false);

    const spaceRepeat = new KeyboardEvent('keydown', {
      key: ' ',
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    toggle.dispatchEvent(spaceRepeat);
    expect(spaceRepeat.defaultPrevented).toBe(true);
    expect(f.componentInstance.collapsed()).toBe(false);

    const enterOnce = new KeyboardEvent('keydown', {
      key: 'Enter',
      repeat: false,
      bubbles: true,
      cancelable: true,
    });
    toggle.dispatchEvent(enterOnce);
    expect(enterOnce.defaultPrevented).toBe(false);
  });
});

const deepLinkRoutes: Routes = [
  { path: '', component: SpecStubPage },
  { path: 'backlog', component: SpecStubPage },
  { path: 'items/:number', component: SpecStubPage },
  { path: 'login', component: SpecStubPage },
];

async function setupAppAtUrl(url: string, extra: Record<string, unknown> = {}) {
  const api = {
    me: vi.fn(() =>
      of({ id: 1, loginName: 'admin', displayName: 'admin', role: 'admin', disabled: false }),
    ),
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
    createProject: vi.fn(() => of({ id: 3, name: '新規', position: 2 })),
    patchProject: vi.fn(() => of({ id: 1, name: '改名', position: 0 })),
    deleteProject: vi.fn(() => of(undefined)),
    headerMenu: vi.fn(() => of(headerMenuPrefs)),
    listUsers: vi.fn(() => of([])),
    ...extra,
  };
  TestBed.configureTestingModule({
    imports: [App],
    providers: [provideRouter(deepLinkRoutes), { provide: Api, useValue: api }],
  });
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  const f = TestBed.createComponent(App);
  f.detectChanges();
  return { f, api, session: TestBed.inject(ProjectSession), router };
}

describe('App project URL deep link', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('switches to the project from /?project= when active differs', async () => {
    const { api, session } = await setupAppAtUrl('/?project=2');
    expect(api.patchBoardSettings).toHaveBeenCalledWith({ activeProjectId: 2 });
    expect(session.activeId()).toBe(2);
  });

  it('does not switch when URL project matches activeId', async () => {
    const { api, session } = await setupAppAtUrl('/?project=1');
    expect(api.patchBoardSettings).not.toHaveBeenCalled();
    expect(session.activeId()).toBe(1);
  });

  it('shows fixed error and keeps activeId for unknown project', async () => {
    const { api, session } = await setupAppAtUrl('/?project=999');
    expect(api.patchBoardSettings).not.toHaveBeenCalled();
    expect(session.activeId()).toBe(1);
    expect(session.error()).toBe(PROJECT_QUERY_NOT_FOUND);
  });

  it('shows fixed error and keeps activeId for invalid project', async () => {
    const { api, session } = await setupAppAtUrl('/?project=abc');
    expect(api.patchBoardSettings).not.toHaveBeenCalled();
    expect(session.activeId()).toBe(1);
    expect(session.error()).toBe(PROJECT_QUERY_NOT_FOUND);
  });

  it('does nothing when project query is absent', async () => {
    const { api, session } = await setupAppAtUrl('/');
    expect(api.patchBoardSettings).not.toHaveBeenCalled();
    expect(session.error()).toBe('');
  });

  it('does not apply deep link on /items/:n', async () => {
    const { api, session } = await setupAppAtUrl('/items/1?project=2');
    expect(api.patchBoardSettings).not.toHaveBeenCalled();
    expect(session.activeId()).toBe(1);
  });

  it('does not apply deep link on /backlog', async () => {
    const { api, session } = await setupAppAtUrl('/backlog?project=2');
    expect(api.patchBoardSettings).not.toHaveBeenCalled();
    expect(session.activeId()).toBe(1);
  });

  it('applies deep link after login navigates from /login to /?project=', async () => {
    const pendingProjects = new Subject<{ projects: typeof projects }>();
    const pendingBoard = new Subject<{
      columns: [];
      items: [];
      settings: { cardLayout: 'pack'; activeProjectId: number };
    }>();
    const api = {
      me: vi.fn(() =>
        of({ id: 1, loginName: 'admin', displayName: 'admin', role: 'admin', disabled: false }),
      ),
      listProjects: vi.fn(() => pendingProjects.asObservable()),
      board: vi.fn(() => pendingBoard.asObservable()),
      patchBoardSettings: vi.fn((body: { activeProjectId: number }) =>
        of({ settings: { cardLayout: 'pack', activeProjectId: body.activeProjectId } }),
      ),
      createProject: vi.fn(() => of({ id: 3, name: '新規', position: 2 })),
      patchProject: vi.fn(() => of({ id: 1, name: '改名', position: 0 })),
      deleteProject: vi.fn(() => of(undefined)),
      headerMenu: vi.fn(() => of(headerMenuPrefs)),
      listUsers: vi.fn(() => of([])),
    };
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(deepLinkRoutes), { provide: Api, useValue: api }],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/login');
    const f = TestBed.createComponent(App);
    f.detectChanges();
    pendingProjects.next({ projects });
    pendingBoard.next({
      columns: [],
      items: [],
      settings: { cardLayout: 'pack', activeProjectId: 1 },
    });
    pendingProjects.complete();
    pendingBoard.complete();
    f.detectChanges();
    expect(api.patchBoardSettings).not.toHaveBeenCalled();
    await router.navigateByUrl('/?project=2');
    f.detectChanges();
    await f.whenStable();
    expect(api.patchBoardSettings).toHaveBeenCalledWith({ activeProjectId: 2 });
  });

  it('applies deep link only once after bootstrap', async () => {
    const pendingProjects = new Subject<{ projects: typeof projects }>();
    const pendingBoard = new Subject<{
      columns: [];
      items: [];
      settings: { cardLayout: 'pack'; activeProjectId: number };
    }>();
    const api = {
      me: vi.fn(() =>
        of({ id: 1, loginName: 'admin', displayName: 'admin', role: 'admin', disabled: false }),
      ),
      listProjects: vi.fn(() => pendingProjects.asObservable()),
      board: vi.fn(() => pendingBoard.asObservable()),
      patchBoardSettings: vi.fn((body: { activeProjectId: number }) =>
        of({ settings: { cardLayout: 'pack', activeProjectId: body.activeProjectId } }),
      ),
      createProject: vi.fn(() => of({ id: 3, name: '新規', position: 2 })),
      patchProject: vi.fn(() => of({ id: 1, name: '改名', position: 0 })),
      deleteProject: vi.fn(() => of(undefined)),
      headerMenu: vi.fn(() => of(headerMenuPrefs)),
      listUsers: vi.fn(() => of([])),
    };
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(deepLinkRoutes), { provide: Api, useValue: api }],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?project=2');
    const f = TestBed.createComponent(App);
    f.detectChanges();
    const session = TestBed.inject(ProjectSession);
    const switchSpy = vi.spyOn(session, 'switchTo');
    expect(session.bootstrapped()).toBe(false);
    expect(switchSpy).not.toHaveBeenCalled();
    pendingProjects.next({ projects });
    pendingBoard.next({
      columns: [],
      items: [],
      settings: { cardLayout: 'pack', activeProjectId: 1 },
    });
    pendingProjects.complete();
    pendingBoard.complete();
    f.detectChanges();
    expect(switchSpy).toHaveBeenCalledTimes(1);
    expect(switchSpy).toHaveBeenCalledWith(2);
    session.bootstrapped.set(false);
    session.bootstrapped.set(true);
    f.detectChanges();
    expect(switchSpy).toHaveBeenCalledTimes(1);
  });
});
