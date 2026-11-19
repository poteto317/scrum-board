import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectSession, PROJECT_NAME_REQUIRED } from './project-session';
import type { Project } from './models';

const main = { id: 1, name: 'メイン', position: 0 };
const next = { id: 2, name: '次', position: 1 };

describe('ProjectSession', () => {
  let session: ProjectSession;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    session = TestBed.inject(ProjectSession);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  function flushLoad(activeProjectId = 1) {
    http.expectOne('/api/projects').flush({ projects: [main, next] });
    http.expectOne('/api/board').flush({
      columns: [],
      items: [],
      settings: { cardLayout: 'pack', activeProjectId, futureFlag: true },
    });
  }

  it('loads projects and keeps the resolved activeProjectId', () => {
    session.load();
    flushLoad(2);
    expect(session.projects().map((p) => p.id)).toEqual([1, 2]);
    expect(session.activeId()).toBe(2);
    expect(session.error()).toBe('');
  });

  it('does not replace the list when load fails', () => {
    session.projects.set([main]);
    session.activeId.set(1);
    session.load();
    http.expectOne('/api/projects').flush({ message: '失敗' }, { status: 500, statusText: 'Error' });
    const board = http.match('/api/board');
    for (const req of board) {
      if (!req.cancelled) req.flush({ columns: [], items: [] });
    }
    expect(session.projects()).toEqual([main]);
    expect(session.activeId()).toBe(1);
    expect(session.error()).not.toBe('');
  });

  it('sets switching before the optimistic active id (L-842)', () => {
    session.activeId.set(1);
    const order: string[] = [];
    const switchingSet = session.switching.set.bind(session.switching);
    const activeSet = session.activeId.set.bind(session.activeId);
    session.switching.set = (value: boolean) => {
      order.push(`switching:${value}:active:${session.activeId()}`);
      switchingSet(value);
    };
    session.activeId.set = (value: number | null) => {
      order.push(`active:${value}:switching:${session.switching()}`);
      activeSet(value);
    };

    let completedWhileBusy = false;
    session.onSwitched(() => {
      expect(session.switching()).toBe(true);
    });
    session.switchTo(2).subscribe({
      complete: () => {
        completedWhileBusy = session.switching();
      },
    });

    expect(order.slice(0, 2)).toEqual(['switching:true:active:1', 'active:2:switching:true']);
    expect(session.switching()).toBe(true);

    const req = http.expectOne('/api/board/settings');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ activeProjectId: 2 });
    req.flush({ settings: { cardLayout: 'pack', activeProjectId: 2 } });

    expect(completedWhileBusy).toBe(true);
    expect(session.activeId()).toBe(2);
    expect(session.switching()).toBe(true);
    session.endSwitch();
    expect(session.switching()).toBe(false);
  });

  it('restores the previous id and clears switching when the switch PATCH fails', () => {
    session.activeId.set(1);
    session.projects.set([main, next]);
    let notified = false;
    session.onSwitched(() => {
      notified = true;
    });
    let failed = false;
    session.switchTo(2).subscribe({ error: () => (failed = true) });
    http
      .expectOne('/api/board/settings')
      .flush({ message: '切替失敗' }, { status: 400, statusText: 'Bad Request' });
    expect(failed).toBe(true);
    expect(notified).toBe(false);
    expect(session.activeId()).toBe(1);
    expect(session.switching()).toBe(false);
    expect(session.error()).toContain('切替失敗');
    expect(session.projects()).toEqual([main, next]);
  });

  it('keeps the same activeProjectId after another load', () => {
    session.activeId.set(1);
    session.onSwitched(() => session.endSwitch());
    session.switchTo(2).subscribe();
    http.expectOne('/api/board/settings').flush({
      settings: { cardLayout: 'pack', activeProjectId: 2 },
    });
    expect(session.activeId()).toBe(2);

    session.load();
    flushLoad(2);
    expect(session.activeId()).toBe(2);
  });

  it('does not confirm create or rename when the request fails', () => {
    session.projects.set([main]);
    session.activeId.set(1);
    let emptyFailed = false;
    let emptyMsg = '';
    session.create('   ').subscribe({
      error: (e) => {
        emptyFailed = true;
        emptyMsg = e instanceof Error ? e.message : '';
      },
    });
    http.expectNone('/api/projects');
    expect(emptyFailed).toBe(true);
    expect(emptyMsg).toBe(PROJECT_NAME_REQUIRED);
    expect(session.projects()).toEqual([main]);

    let createFailed = false;
    session.create('次').subscribe({ error: () => (createFailed = true) });
    http
      .expectOne('/api/projects')
      .flush({ message: '作成失敗' }, { status: 500, statusText: 'Error' });
    expect(createFailed).toBe(true);
    expect(session.projects()).toEqual([main]);
    expect(session.mutating()).toBe(false);

    session.projects.set([main]);
    session.rename(1, '改名');
    http
      .expectOne('/api/projects/1')
      .flush({ message: '改名失敗' }, { status: 500, statusText: 'Error' });
    expect(session.projects()[0].name).toBe('メイン');
    expect(session.error()).toContain('改名失敗');
  });

  it('emits the project on create success and keeps mutating true', () => {
    session.projects.set([main]);
    session.activeId.set(1);
    let emitted: Project | undefined;
    session.create('次').subscribe((p) => (emitted = p));
    http.expectOne('/api/projects').flush({ id: 2, name: '次', position: 1 });
    expect(emitted).toEqual(next);
    expect(session.projects()).toEqual([main, next]);
    expect(session.activeId()).toBe(1);
    expect(session.mutating()).toBe(true);
    session.endMutating();
    expect(session.mutating()).toBe(false);
  });

  it('rejects names over 80 code points without POST', () => {
    session.projects.set([main]);
    let failed = false;
    let msg = '';
    session.create('a'.repeat(81)).subscribe({
      error: (e) => {
        failed = true;
        msg = e instanceof Error ? e.message : '';
      },
    });
    http.expectNone('/api/projects');
    expect(failed).toBe(true);
    expect(msg).toBe(PROJECT_NAME_REQUIRED);
  });

  it('returns EMPTY without POST when create is busy', () => {
    session.projects.set([main]);
    session.mutating.set(true);
    let next = false;
    let errored = false;
    let completed = false;
    session.create('次').subscribe({
      next: () => (next = true),
      error: () => (errored = true),
      complete: () => (completed = true),
    });
    http.expectNone('/api/projects');
    expect(next).toBe(false);
    expect(errored).toBe(false);
    expect(completed).toBe(true);

    session.mutating.set(false);
    session.switching.set(true);
    completed = false;
    session.create('次').subscribe({ complete: () => (completed = true) });
    http.expectNone('/api/projects');
    expect(completed).toBe(true);
  });

  it('disables delete of the last project and keeps the list on 409', () => {
    session.projects.set([main]);
    session.activeId.set(1);
    expect(session.canDelete()).toBe(false);
    session.delete(1);
    http.expectNone('/api/projects/1');

    session.projects.set([main, next]);
    session.activeId.set(1);
    expect(session.canDelete()).toBe(true);
    session.delete(1);
    http
      .expectOne('/api/projects/1')
      .flush({ message: 'アイテムがあるため削除できません' }, { status: 409, statusText: 'Conflict' });
    expect(session.projects().map((p) => p.id)).toEqual([1, 2]);
    expect(session.activeId()).toBe(1);
    expect(session.switching()).toBe(false);
    expect(session.error()).toContain('削除できません');
  });

  it('resolves a new active id after deleting the active project and stays busy until endSwitch', () => {
    session.projects.set([main, next]);
    session.activeId.set(1);
    let busyDuringReload = false;
    session.onSwitched((id) => {
      busyDuringReload = session.switching() && id === 2;
    });
    session.delete(1);
    http.expectOne({ method: 'DELETE', url: '/api/projects/1' }).flush(null);
    expect(session.switching()).toBe(true);
    expect(session.projects().map((p) => p.id)).toEqual([2]);
    http.expectOne('/api/board').flush({
      columns: [],
      items: [],
      settings: { cardLayout: 'pack', activeProjectId: 2 },
    });
    expect(busyDuringReload).toBe(true);
    expect(session.activeId()).toBe(2);
    expect(session.switching()).toBe(true);
    session.endSwitch();
    expect(session.switching()).toBe(false);
  });

  it('falls back activeId when board reload fails after deleting the active project', () => {
    session.projects.set([main, next]);
    session.activeId.set(1);
    session.delete(1);
    http.expectOne({ method: 'DELETE', url: '/api/projects/1' }).flush(null);
    http
      .expectOne('/api/board')
      .flush({ message: '読込失敗' }, { status: 500, statusText: 'Error' });
    expect(session.projects().map((p) => p.id)).toEqual([2]);
    expect(session.activeId()).toBe(2);
    expect(session.switching()).toBe(false);
    expect(session.error()).toContain('読込失敗');
  });
});
