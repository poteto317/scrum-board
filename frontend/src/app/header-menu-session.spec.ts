import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HEADER_MENU_LOAD_FAILURE,
  HeaderMenuSession,
} from './header-menu-session';

const emptyWs = {
  board: { hiddenIds: [] as string[] },
  backlog: { hiddenIds: [] as string[] },
  itemDetail: { hiddenIds: [] as string[] },
};

describe('HeaderMenuSession', () => {
  let session: HeaderMenuSession;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    session = TestBed.inject(HeaderMenuSession);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('loads all pageKinds into drafts', () => {
    session.load();
    http.expectOne('/api/header-menu').flush({
      board: { hiddenIds: ['project_delete'] },
      backlog: { hiddenIds: [] },
      itemDetail: { hiddenIds: ['item_history'] },
    });
    expect(session.pagePrefs('board').hiddenIds).toEqual(['project_delete']);
    expect(session.pagePrefs('itemDetail').hiddenIds).toEqual(['item_history']);
    expect(session.loadError()).toBe('');
  });

  it('sets loadError on GET failure', () => {
    session.load();
    http.expectOne('/api/header-menu').flush({ message: 'x' }, { status: 500, statusText: 'err' });
    expect(session.loadError()).toBe(HEADER_MENU_LOAD_FAILURE);
    expect(session.pagePrefs('board').hiddenIds).toEqual([]);
  });

  it('debounces PUT with all three keys', async () => {
    vi.useFakeTimers();
    session.load();
    http.expectOne('/api/header-menu').flush(emptyWs);
    session.setHidden('board', 'project_add', true);
    await vi.advanceTimersByTimeAsync(300);
    const req = http.expectOne('/api/header-menu');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      board: { hiddenIds: ['project_add'] },
      backlog: { hiddenIds: [] },
      itemDetail: { hiddenIds: [] },
    });
    req.flush(req.request.body);
  });

  it('does not PUT before hydrate', async () => {
    vi.useFakeTimers();
    session.setHidden('board', 'project_add', true);
    await vi.advanceTimersByTimeAsync(300);
    http.expectNone('/api/header-menu');
  });

  it('PUT failure reverts to confirmed', async () => {
    vi.useFakeTimers();
    session.load();
    http.expectOne('/api/header-menu').flush({
      board: { hiddenIds: [] },
      backlog: { hiddenIds: [] },
      itemDetail: { hiddenIds: ['item_favorite'] },
    });
    session.setHidden('itemDetail', 'item_favorite', false);
    await vi.advanceTimersByTimeAsync(300);
    http
      .expectOne('/api/header-menu')
      .flush({ message: 'x' }, { status: 500, statusText: 'err' });
    expect(session.pagePrefs('itemDetail').hiddenIds).toEqual(['item_favorite']);
    expect(session.saveError()).not.toBe('');
  });

  it('keeps dirty board draft when reloading', () => {
    vi.useFakeTimers();
    session.setHidden('board', 'project_rename', true);
    session.load();
    http.expectOne('/api/header-menu').flush({
      board: { hiddenIds: [] },
      backlog: { hiddenIds: ['project_delete'] },
      itemDetail: { hiddenIds: [] },
    });
    expect(session.pagePrefs('board').hiddenIds).toEqual(['project_rename']);
    expect(session.pagePrefs('backlog').hiddenIds).toEqual(['project_delete']);
  });

  it('ignores stale GET after local edits', () => {
    session.load();
    const req = http.expectOne('/api/header-menu');
    session.setHidden('backlog', 'project_add', true);
    req.flush(emptyWs);
    expect(session.pagePrefs('backlog').hiddenIds).toEqual(['project_add']);
  });

  it('in-flight PUT does not rewind newer draft', async () => {
    vi.useFakeTimers();
    session.load();
    http.expectOne('/api/header-menu').flush(emptyWs);
    session.setHidden('board', 'project_add', true);
    await vi.advanceTimersByTimeAsync(300);
    const first = http.expectOne('/api/header-menu');
    session.setHidden('board', 'project_delete', true);
    await vi.advanceTimersByTimeAsync(300);
    const second = http.expectOne('/api/header-menu');
    first.flush({
      board: { hiddenIds: ['project_add'] },
      backlog: emptyWs.backlog,
      itemDetail: emptyWs.itemDetail,
    });
    expect(session.pagePrefs('board').hiddenIds).toContain('project_delete');
    second.flush({
      board: { hiddenIds: ['project_add', 'project_delete'] },
      backlog: emptyWs.backlog,
      itemDetail: emptyWs.itemDetail,
    });
  });

  it('retryLoad forces GET even when dirty', () => {
    session.setHidden('board', 'project_add', true);
    session.retryLoad();
    http.expectOne('/api/header-menu').flush({
      board: { hiddenIds: [] },
      backlog: emptyWs.backlog,
      itemDetail: emptyWs.itemDetail,
    });
    expect(session.pagePrefs('board').hiddenIds).toEqual([]);
  });

  it('does not auto-PUT on load', () => {
    session.load();
    http.expectOne('/api/header-menu').flush(emptyWs);
    http.expectNone('/api/header-menu');
  });
});