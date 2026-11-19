import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EMPTY, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { App } from './app';
import { FavoritesSession } from './favorites-session';
import { ProjectSession } from './project-session';

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

describe('App project switcher', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  function setup(extra: Record<string, unknown> = {}) {
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
      providers: [provideRouter([]), { provide: Api, useValue: api }],
    });
    const f = TestBed.createComponent(App);
    f.detectChanges();
    return { f, api, session: TestBed.inject(ProjectSession) };
  }

  it('loads projects into the header select', () => {
    const { f, session } = setup();
    const select = f.nativeElement.querySelector('#project-select') as HTMLSelectElement;
    expect(session.activeId()).toBe(1);
    expect(session.bootstrapped()).toBe(true);
    expect(select.value).toBe('1');
    expect(Array.from(select.options).map((option) => option.text)).toEqual(['メイン', '次']);
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
    const loading = f.nativeElement.querySelector('#project-select') as HTMLSelectElement;
    expect(loading.disabled).toBe(true);
    expect(loading.options[0]?.textContent?.trim()).toBe('…');
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
    const select = f.nativeElement.querySelector('#project-select') as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    expect(select.value).toBe('2');
    expect(Array.from(select.options).map((o) => o.text)).toEqual(['メイン', '次']);
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

  it('updates the select after a successful switch when no board is mounted', () => {
    const { f, api, session } = setup();
    const select = f.nativeElement.querySelector('#project-select') as HTMLSelectElement;
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    f.detectChanges();
    expect(api.patchBoardSettings).toHaveBeenCalledWith({ activeProjectId: 2 });
    expect(session.activeId()).toBe(2);
    expect(session.switching()).toBe(false);
    expect(select.value).toBe('2');
  });

  it('prefetches other projects on select focus and pointerdown', () => {
    const { f, api, session } = setup();
    session.activeId.set(1);
    const select = f.nativeElement.querySelector('#project-select') as HTMLSelectElement;
    api.board.mockClear();
    select.dispatchEvent(new Event('focus'));
    expect(api.board).toHaveBeenCalledWith(2);
    expect(api.board.mock.calls.every((c: unknown[]) => c[0] === 2)).toBe(true);
    api.board.mockClear();
    select.dispatchEvent(new Event('pointerdown'));
    // warm after first prefetch — no new unscoped board() calls
    expect(api.board.mock.calls.every((c: unknown[]) => c[0] === 2)).toBe(true);
  });

  it('does not prefetch while switching', () => {
    const { f, api, session } = setup();
    session.switching.set(true);
    const select = f.nativeElement.querySelector('#project-select') as HTMLSelectElement;
    api.board.mockClear();
    select.dispatchEvent(new Event('focus'));
    select.dispatchEvent(new Event('pointerdown'));
    expect(api.board).not.toHaveBeenCalled();
  });

  it('restores the previous project when the switch PATCH fails', () => {
    const { f, session } = setup({
      patchBoardSettings: () => throwError(() => ({ error: { message: '切替失敗' } })),
    });
    const select = f.nativeElement.querySelector('#project-select') as HTMLSelectElement;
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    f.detectChanges();
    expect(session.activeId()).toBe(1);
    expect(session.switching()).toBe(false);
    expect(select.value).toBe('1');
    expect(f.nativeElement.querySelector('.project-error')?.textContent).toContain('切替失敗');
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
      expect((f.nativeElement.querySelector('#project-select') as HTMLSelectElement).disabled).toBe(
        true,
      );
      expect(headerMenuItem(f, 'project_rename')?.disabled).toBe(true);
      expect(headerMenuItem(f, 'project_delete')?.disabled).toBe(true);
      f.componentInstance.projectForm.controls.name.setValue('下書き');
      f.detectChanges();
      expect(f.componentInstance.projectForm.controls.name.value).toBe('下書き');
    });
  });

  it('creates then switches to the new project and closes the dialog', () => {
    const { f, api, session } = setup();
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
      text: a.textContent?.trim(),
    }));
    expect(links).toEqual([
      { href: '/', text: 'ボード' },
      { href: '/backlog', text: 'バックログ' },
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
    const select = f.nativeElement.querySelector('#project-select') as HTMLSelectElement;
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    f.detectChanges();
    expect(session.activeId()).toBe(2);
    expect(loadSpy).toHaveBeenCalled();
    expect(api.board).toHaveBeenCalled();
  });
});
