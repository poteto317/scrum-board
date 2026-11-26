import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, Routes } from '@angular/router';
import { of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { App } from './app';
import { FavoritesSession } from './favorites-session';
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

describe('App header and sidebar', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  function setup(extra: Record<string, unknown> = {}, routerRoutes: Routes = []) {
    return setupApp(extra, routerRoutes);
  }

  it('does not render the project switcher in the header', () => {
    const { f } = setup();
    expect(f.nativeElement.querySelector('#project-select-trigger')).toBeNull();
    expect(f.nativeElement.querySelector('app-project-switcher')).toBeNull();
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

  it('offers open_projects in the header menu with label プロジェクト', () => {
    const { f } = setup();
    openHeaderMenu(f);
    const btn = headerMenuItem(f, 'open_projects');
    expect(btn).toBeTruthy();
    expect(btn?.textContent?.trim()).toBe('プロジェクト');
    expect(headerMenuItem(f, 'project_add')).toBeNull();
    expect(headerMenuItem(f, 'project_rename')).toBeNull();
    expect(headerMenuItem(f, 'project_delete')).toBeNull();
  });

  it('navigates to /projects from the header menu', async () => {
    const { f } = setup({}, [{ path: 'projects', component: SpecStubPage }]);
    const router = TestBed.inject(Router);
    clickHeaderMenuItem(f, 'open_projects');
    await f.whenStable();
    expect(router.url).toBe('/projects');
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
    session.switchTo(2).subscribe();
    f.detectChanges();
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

  it('views the project from /?project= without patching shared settings', async () => {
    const { api, session } = await setupAppAtUrl('/?project=2');
    expect(api.patchBoardSettings).not.toHaveBeenCalled();
    expect(session.activeId()).toBe(2);
    expect(session.ephemeralActiveView()).toBe(true);
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
    expect(api.patchBoardSettings).not.toHaveBeenCalled();
    expect(TestBed.inject(ProjectSession).activeId()).toBe(2);
    expect(TestBed.inject(ProjectSession).ephemeralActiveView()).toBe(true);
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
    const viewSpy = vi.spyOn(session, 'viewFromDeepLink');
    expect(session.bootstrapped()).toBe(false);
    expect(viewSpy).not.toHaveBeenCalled();
    pendingProjects.next({ projects });
    pendingBoard.next({
      columns: [],
      items: [],
      settings: { cardLayout: 'pack', activeProjectId: 1 },
    });
    pendingProjects.complete();
    pendingBoard.complete();
    f.detectChanges();
    expect(viewSpy).toHaveBeenCalledTimes(1);
    expect(viewSpy).toHaveBeenCalledWith(2);
    session.bootstrapped.set(false);
    session.bootstrapped.set(true);
    f.detectChanges();
    expect(viewSpy).toHaveBeenCalledTimes(1);
  });
});
