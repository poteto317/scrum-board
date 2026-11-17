import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { App } from './app';
import { ProjectSession } from './project-session';

const projects = [
  { id: 1, name: 'メイン', position: 0 },
  { id: 2, name: '次', position: 1 },
];

describe('App project switcher', () => {
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
      patchBoardSettings: vi.fn(() =>
        of({ settings: { cardLayout: 'pack', activeProjectId: 2 } }),
      ),
      createProject: vi.fn(() => of({ id: 3, name: '新規', position: 2 })),
      patchProject: vi.fn(() => of({ id: 1, name: '改名', position: 0 })),
      deleteProject: vi.fn(() => of(undefined)),
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
    expect(select.value).toBe('1');
    expect(Array.from(select.options).map((option) => option.text)).toEqual(['メイン', '次']);
    expect(f.nativeElement.querySelector('.workspace-name')).toBeNull();
  });

  it('disables delete when only one project remains', () => {
    const { f } = setup({
      listProjects: () => of({ projects: [projects[0]] }),
    });
    expect((f.nativeElement.querySelector('#project-delete') as HTMLButtonElement).disabled).toBe(
      true,
    );
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

  it('does not add a project when create fails', () => {
    const { f, session } = setup({
      createProject: () => throwError(() => ({ error: { message: '作成失敗' } })),
    });
    vi.spyOn(window, 'prompt').mockReturnValue('新規');
    (f.nativeElement.querySelector('#project-add') as HTMLButtonElement).click();
    f.detectChanges();
    expect(session.projects().map((p) => p.name)).toEqual(['メイン', '次']);
    expect(f.nativeElement.querySelector('.project-error')?.textContent).toContain('作成失敗');
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
    (f.nativeElement.querySelector('#project-delete') as HTMLButtonElement).click();
    f.detectChanges();
    expect(session.projects()).toHaveLength(2);
    expect(f.nativeElement.querySelector('.project-error')?.textContent).toContain('削除できません');
  });
});
