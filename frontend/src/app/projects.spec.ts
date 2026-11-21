import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EMPTY, of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { ProjectSession } from './project-session';
import { ProjectsPage } from './projects';

const projects = [
  { id: 1, name: 'メイン', position: 0 },
  { id: 2, name: '次', position: 1 },
];

describe('ProjectsPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  function setup(extra: Record<string, unknown> = {}) {
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
      createProject: vi.fn(() => of({ id: 3, name: '新規', position: 2 })),
      patchProject: vi.fn(() => of({ id: 1, name: '改名', position: 0 })),
      deleteProject: vi.fn(() => of(undefined)),
      reorderProjects: vi.fn((projectIds: number[]) =>
        of({
          projects: projectIds.map((id, position) => {
            const p = [...projects, { id: 3, name: '新規', position: 2 }].find((x) => x.id === id)!;
            return { ...p, position };
          }),
        }),
      ),
      ...extra,
    };
    TestBed.configureTestingModule({
      imports: [ProjectsPage],
      providers: [provideRouter([]), { provide: Api, useValue: api }],
    });
    const session = TestBed.inject(ProjectSession);
    session.projects.set(projects.map((p) => ({ ...p })));
    session.activeId.set(1);
    session.bootstrapped.set(true);
    const f = TestBed.createComponent(ProjectsPage);
    f.detectChanges();
    return { f, api, session };
  }

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
      f.componentInstance.saving.set(false);
      f.componentInstance.modalOpen.set(false);
      f.detectChanges();
      proto.showModal = origShowModal;
      proto.close = origClose;
    }
  }

  it('disables delete when only one project remains', () => {
    const { f, session } = setup();
    session.projects.set([projects[0]]);
    f.detectChanges();
    const del = [...f.nativeElement.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '削除',
    ) as HTMLButtonElement;
    expect(del.disabled).toBe(true);
  });

  it('ignores key repeat on delete before confirm', () => {
    const { f } = setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const del = [...f.nativeElement.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === '削除',
    ) as HTMLButtonElement;
    del.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('creates then switches to the new project and closes the dialog', () => {
    const { f, api, session } = setup();
    withDialogPolyfill(f, () => {
      f.componentInstance.openAdd();
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
      f.componentInstance.openAdd();
      f.detectChanges();
      f.componentInstance.projectForm.controls.name.setValue('新規');
      f.detectChanges();
      (f.nativeElement.querySelector('dialog form') as HTMLFormElement).dispatchEvent(
        new Event('submit'),
      );
      f.detectChanges();
      expect(session.projects().map((p) => p.name)).toEqual(['メイン', '次']);
      expect(f.nativeElement.querySelector('dialog .form-error')?.textContent).toContain(
        '作成失敗',
      );
      expect(f.nativeElement.querySelector('dialog')).toBeTruthy();
    });
  });

  it('shows session error when switchTo returns EMPTY after create', () => {
    const { f, session } = setup();
    withDialogPolyfill(f, () => {
      vi.spyOn(session, 'switchTo').mockReturnValue(EMPTY);
      f.componentInstance.openAdd();
      f.detectChanges();
      f.componentInstance.projectForm.controls.name.setValue('新規');
      f.detectChanges();
      (f.nativeElement.querySelector('dialog form') as HTMLFormElement).dispatchEvent(
        new Event('submit'),
      );
      f.detectChanges();
      expect(session.projects().some((p) => p.name === '新規')).toBe(true);
      expect(f.nativeElement.querySelector('dialog')).toBeNull();
      expect(session.error()).toContain('切替できませんでした');
      expect(session.mutating()).toBe(false);
      expect(f.componentInstance.saving()).toBe(false);
    });
  });

  it('keeps the new project when switchTo fails after create', () => {
    const { f, session } = setup({
      patchBoardSettings: () => throwError(() => ({ error: { message: '切替失敗' } })),
    });
    withDialogPolyfill(f, () => {
      f.componentInstance.openAdd();
      f.detectChanges();
      f.componentInstance.projectForm.controls.name.setValue('新規');
      f.detectChanges();
      (f.nativeElement.querySelector('dialog form') as HTMLFormElement).dispatchEvent(
        new Event('submit'),
      );
      f.detectChanges();
      expect(session.projects().some((p) => p.name === '新規')).toBe(true);
      expect(session.activeId()).toBe(1);
      expect(session.error()).toContain('切替失敗');
      expect(f.nativeElement.querySelector('dialog')).toBeNull();
    });
  });

  it('reorders via move and rolls back draft on HTTP failure', () => {
    const { f, api, session } = setup({
      reorderProjects: vi.fn(() => throwError(() => ({ error: { message: '並び失敗' } }))),
    });
    f.componentInstance.move(0, 1);
    f.detectChanges();
    expect(api.reorderProjects).toHaveBeenCalledWith([2, 1]);
    expect(session.projects().map((p) => p.id)).toEqual([1, 2]);
    expect(f.componentInstance.list().map((p) => p.id)).toEqual([1, 2]);
    expect(session.error()).toContain('並び失敗');
  });

  it('does not reorder on EMPTY (busy)', () => {
    const { f, api, session } = setup();
    session.mutating.set(true);
    f.componentInstance.move(0, 1);
    expect(api.reorderProjects).not.toHaveBeenCalled();
  });

  it('prevents default on repeated Enter for move buttons (L-408)', () => {
    const { f, api } = setup();
    const moveSpy = vi.spyOn(f.componentInstance, 'move');
    const ups = [...f.nativeElement.querySelectorAll('[aria-label="上へ"]')] as HTMLButtonElement[];
    const repeat = new KeyboardEvent('keydown', {
      key: 'Enter',
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    ups[1].dispatchEvent(repeat);
    expect(repeat.defaultPrevented).toBe(true);
    expect(moveSpy).not.toHaveBeenCalled();
    expect(api.reorderProjects).not.toHaveBeenCalled();
  });

  it('moves on click without treating it as a key repeat', () => {
    const { f, api } = setup();
    const ups = [...f.nativeElement.querySelectorAll('[aria-label="上へ"]')] as HTMLButtonElement[];
    ups[1].click();
    expect(api.reorderProjects).toHaveBeenCalledWith([2, 1]);
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
    f.componentInstance.delete(projects[0]);
    f.detectChanges();
    expect(session.projects()).toHaveLength(2);
    expect(session.error()).toContain('削除できません');
  });
});
