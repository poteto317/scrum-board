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
    http.expectNone('/api/board');
    http.expectOne('/api/board/meta').flush({
      columns: [],
      settings: { cardLayout: 'pack', activeProjectId, futureFlag: true },
    });
  }

  it('loads projects and keeps the resolved activeProjectId', () => {
    session.load();
    flushLoad(2);
    expect(session.projects().map((p) => p.id)).toEqual([1, 2]);
    expect(session.activeId()).toBe(2);
    expect(session.bootstrapped()).toBe(true);
    expect(session.error()).toBe('');
  });

  it('sets activeId before projects on load', () => {
    const order: string[] = [];
    const activeSet = session.activeId.set.bind(session.activeId);
    const projectsSet = session.projects.set.bind(session.projects);
    session.activeId.set = (value: number | null) => {
      order.push(`active:${value}`);
      activeSet(value);
    };
    session.projects.set = (value: Project[]) => {
      order.push(`projects:${value.map((p) => p.id).join(',')}`);
      projectsSet(value);
    };
    session.load();
    flushLoad(2);
    expect(order[0]).toBe('active:2');
    expect(order[1]).toBe('projects:1,2');
    expect(session.bootstrapped()).toBe(true);
  });

  it('does not clear a positive activeId when clearIfMissing sees a missing id', () => {
    session.activeId.set(2);
    session.syncActiveFromBoard(undefined, true);
    expect(session.activeId()).toBe(2);
    session.syncActiveFromBoard(0, true);
    expect(session.activeId()).toBe(2);
  });

  it('clears activeId on clearIfMissing only when it was not a positive id', () => {
    session.activeId.set(null);
    session.syncActiveFromBoard(undefined, true);
    expect(session.activeId()).toBeNull();
  });

  it('ignores board active sync while switching (deep-link / late GET race)', () => {
    session.activeId.set(2);
    session.switching.set(true);
    session.syncActiveFromBoard(1, false);
    expect(session.activeId()).toBe(2);
    session.switching.set(false);
    session.syncActiveFromBoard(1, false);
    expect(session.activeId()).toBe(1);
  });

  it('does not replace the list when load fails', () => {
    session.projects.set([main]);
    session.activeId.set(1);
    session.load();
    http.expectOne('/api/projects').flush({ message: '失敗' }, { status: 500, statusText: 'Error' });
    http.expectNone('/api/board');
    const board = http.match('/api/board/meta');
    for (const req of board) {
      if (!req.cancelled) req.flush({ columns: [] });
    }
    expect(session.projects()).toEqual([main]);
    expect(session.activeId()).toBe(1);
    expect(session.bootstrapped()).toBe(false);
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
    http.expectNone('/api/board');
    http.expectOne('/api/board/meta').flush({
      columns: [],
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
    http.expectNone('/api/board');
    http
      .expectOne('/api/board/meta')
      .flush({ message: '読込失敗' }, { status: 500, statusText: 'Error' });
    expect(session.projects().map((p) => p.id)).toEqual([2]);
    expect(session.activeId()).toBe(2);
    expect(session.switching()).toBe(false);
    expect(session.error()).toContain('読込失敗');
  });

  it('reorders projects and updates the list only on success', () => {
    session.projects.set([main, next]);
    let got: Project[] | undefined;
    session.reorder([2, 1]).subscribe((list) => (got = list));
    expect(session.mutating()).toBe(true);
    http.expectOne({ method: 'PUT', url: '/api/projects/order' }).flush({
      projects: [
        { ...next, position: 0 },
        { ...main, position: 1 },
      ],
    });
    expect(got?.map((p) => p.id)).toEqual([2, 1]);
    expect(session.projects().map((p) => p.id)).toEqual([2, 1]);
    expect(session.mutating()).toBe(false);
  });

  it('does not change the list when reorder fails', () => {
    session.projects.set([main, next]);
    let status = 0;
    session.reorder([2, 1]).subscribe({ error: (e) => (status = e.status) });
    http
      .expectOne('/api/projects/order')
      .flush({ message: '競合' }, { status: 409, statusText: 'Conflict' });
    expect(status).toBe(409);
    expect(session.projects().map((p) => p.id)).toEqual([1, 2]);
    expect(session.mutating()).toBe(false);
    expect(session.error()).toContain('競合');
  });

  it('returns EMPTY without HTTP when reorder ids are incomplete or busy', () => {
    session.projects.set([main, next]);
    let nextCount = 0;
    session.reorder([1]).subscribe({ next: () => nextCount++ });
    session.reorder([1, 1]).subscribe({ next: () => nextCount++ });
    session.reorder([1, 99]).subscribe({ next: () => nextCount++ });
    session.mutating.set(true);
    session.reorder([2, 1]).subscribe({ next: () => nextCount++ });
    http.expectNone('/api/projects/order');
    expect(nextCount).toBe(0);
  });

  it('returns EMPTY without HTTP when reorder is called while switching', () => {
    session.projects.set([main, next]);
    session.switching.set(true);
    let nextCount = 0;
    session.reorder([2, 1]).subscribe({ next: () => nextCount++ });
    http.expectNone('/api/projects/order');
    expect(nextCount).toBe(0);
    expect(session.mutating()).toBe(false);
  });

  it('viewFromDeepLink sets ephemeral view and notifies listeners', () => {
    session.projects.set([main, next]);
    session.activeId.set(1);
    const seen: number[] = [];
    session.onSwitched((id) => {
      seen.push(id);
      session.endSwitch();
    });
    session.viewFromDeepLink(2);
    expect(session.activeId()).toBe(2);
    expect(session.ephemeralActiveView()).toBe(true);
    expect(seen).toEqual([2]);
    expect(session.switching()).toBe(false);
    session.syncActiveFromBoard(1, false);
    expect(session.activeId()).toBe(2);
  });

  it('switchTo from ephemeral view with same id persists and clears ephemeral', () => {
    session.projects.set([main, next]);
    session.activeId.set(1);
    session.viewFromDeepLink(2);
    session.onSwitched(() => session.endSwitch());
    let nextId: number | undefined;
    session.switchTo(2).subscribe({ next: (id) => (nextId = id) });
    http.expectOne('/api/board/settings').flush({
      settings: { cardLayout: 'pack', activeProjectId: 2 },
    });
    expect(nextId).toBe(2);
    expect(session.ephemeralActiveView()).toBe(false);
  });

  it('clearSubjectState resets project workspace signals', () => {
    session.projects.set([main, next]);
    session.activeId.set(2);
    session.bootstrapped.set(true);
    session.switching.set(true);
    session.mutating.set(true);
    session.error.set('x');
    session.clearSubjectState();
    expect(session.projects()).toEqual([]);
    expect(session.activeId()).toBeNull();
    expect(session.bootstrapped()).toBe(false);
    expect(session.switching()).toBe(false);
    expect(session.mutating()).toBe(false);
    expect(session.error()).toBe('');
  });
});
