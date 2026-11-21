import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIST_FILTER_LOAD_FAILURE,
  ListFilterSession,
} from './list-filter-session';

const emptyWs = {
  board: { query: '', statusIds: [] as number[] },
  backlog: { query: '', statusIds: [] as number[] },
};

describe('ListFilterSession', () => {
  let session: ListFilterSession;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    session = TestBed.inject(ListFilterSession);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  it('loads both views into drafts', () => {
    session.load();
    http.expectOne('/api/list-filter').flush({
      board: { query: 'hi', statusIds: [1] },
      backlog: { query: '', statusIds: [2] },
    });
    expect(session.filter('board')).toEqual({ query: 'hi', statusIds: [1] });
    expect(session.filter('backlog')).toEqual({ query: '', statusIds: [2] });
    expect(session.loadError()).toBe('');
  });

  it('sets loadError on GET failure without treating as empty success', () => {
    session.load();
    http.expectOne('/api/list-filter').flush({ message: 'x' }, { status: 500, statusText: 'err' });
    expect(session.loadError()).toBe(LIST_FILTER_LOAD_FAILURE);
    expect(session.filter('board')).toEqual({ query: '', statusIds: [] });
  });

  it('board edits do not change backlog draft', async () => {
    vi.useFakeTimers();
    session.load();
    http.expectOne('/api/list-filter').flush({
      board: { query: '', statusIds: [] },
      backlog: { query: '', statusIds: [1] },
    });
    session.setQuery('board', 'only-board');
    expect(session.filter('backlog')).toEqual({ query: '', statusIds: [1] });
    await vi.advanceTimersByTimeAsync(300);
    const req = http.expectOne('/api/list-filter');
    expect(req.request.body).toEqual({
      board: { query: 'only-board', statusIds: [] },
      backlog: { query: '', statusIds: [1] },
    });
    req.flush(req.request.body);
  });

  it('clear affects only one view', async () => {
    vi.useFakeTimers();
    session.load();
    http.expectOne('/api/list-filter').flush({
      board: { query: 'b', statusIds: [2] },
      backlog: { query: 'k', statusIds: [1] },
    });
    session.clear('board');
    await vi.advanceTimersByTimeAsync(300);
    const req = http.expectOne('/api/list-filter');
    expect(req.request.body.board).toEqual({ query: '', statusIds: [] });
    expect(req.request.body.backlog).toEqual({ query: 'k', statusIds: [1] });
    req.flush(req.request.body);
  });

  it('keeps board dirty draft when backlog loads', () => {
    vi.useFakeTimers();
    session.setQuery('board', 'keep');
    session.load();
    http.expectOne('/api/list-filter').flush({
      board: { query: 'server-board', statusIds: [] },
      backlog: { query: 'server-backlog', statusIds: [1] },
    });
    expect(session.filter('board').query).toBe('keep');
    expect(session.filter('backlog').query).toBe('server-backlog');
  });

  it('does not drop pending debounce PUT when the other view loads', async () => {
    vi.useFakeTimers();
    session.setQuery('board', 'keep');
    session.load();
    http.expectOne('/api/list-filter').flush({
      board: { query: 'server-board', statusIds: [] },
      backlog: { query: 'server-backlog', statusIds: [1] },
    });
    await vi.advanceTimersByTimeAsync(300);
    const req = http.expectOne('/api/list-filter');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.board.query).toBe('keep');
    expect(req.request.body.backlog.query).toBe('server-backlog');
    req.flush(req.request.body);
  });

  it('does not auto-PUT on load', () => {
    session.load();
    http.expectOne('/api/list-filter').flush({
      board: emptyWs.board,
      backlog: { query: '', statusIds: [1] },
    });
    http.expectNone('/api/list-filter');
  });

  it('PUT failure reverts drafts to confirmed', async () => {
    vi.useFakeTimers();
    session.load();
    http.expectOne('/api/list-filter').flush({
      board: { query: 'ok', statusIds: [1] },
      backlog: { query: '', statusIds: [1] },
    });
    session.setQuery('board', 'bad');
    await vi.advanceTimersByTimeAsync(300);
    http
      .expectOne('/api/list-filter')
      .flush({ message: 'x' }, { status: 500, statusText: 'err' });
    expect(session.filter('board')).toEqual({ query: 'ok', statusIds: [1] });
    expect(session.filter('backlog')).toEqual({ query: '', statusIds: [1] });
    expect(session.saveError()).not.toBe('');
  });

  it('ignores stale GET after user edits', () => {
    session.load();
    const req = http.expectOne('/api/list-filter');
    session.setQuery('board', 'typed');
    req.flush({
      board: { query: 'server', statusIds: [] },
      backlog: emptyWs.backlog,
    });
    expect(session.filter('board').query).toBe('typed');
  });

  it('debounces PUT with both views', async () => {
    vi.useFakeTimers();
    session.load();
    http.expectOne('/api/list-filter').flush(emptyWs);
    session.setQuery('board', 'ab');
    await vi.advanceTimersByTimeAsync(300);
    const req = http.expectOne('/api/list-filter');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      board: { query: 'ab', statusIds: [] },
      backlog: { query: '', statusIds: [] },
    });
    req.flush(req.request.body);
  });

  it('does not PUT before the first successful GET (avoids wiping the other view)', async () => {
    vi.useFakeTimers();
    session.setQuery('board', 'early');
    await vi.advanceTimersByTimeAsync(300);
    http.expectNone('/api/list-filter');
    session.load();
    http.expectOne('/api/list-filter').flush({
      board: { query: '', statusIds: [] },
      backlog: { query: 'kept', statusIds: [1] },
    });
    await vi.advanceTimersByTimeAsync(300);
    const req = http.expectOne('/api/list-filter');
    expect(req.request.body).toEqual({
      board: { query: 'early', statusIds: [] },
      backlog: { query: 'kept', statusIds: [1] },
    });
    req.flush(req.request.body);
  });

  it('in-flight PUT does not rewind a newer draft', async () => {
    vi.useFakeTimers();
    session.load();
    http.expectOne('/api/list-filter').flush(emptyWs);
    session.setQuery('board', 'one');
    await vi.advanceTimersByTimeAsync(300);
    const first = http.expectOne('/api/list-filter');
    session.setQuery('board', 'two');
    await vi.advanceTimersByTimeAsync(300);
    const second = http.expectOne('/api/list-filter');
    first.flush({
      board: { query: 'one', statusIds: [] },
      backlog: emptyWs.backlog,
    });
    expect(session.filter('board').query).toBe('two');
    second.flush({
      board: { query: 'two', statusIds: [] },
      backlog: emptyWs.backlog,
    });
  });

  it('clips query to 200 characters', () => {
    session.setQuery('board', 'あ'.repeat(201));
    expect([...session.filter('board').query]).toHaveLength(200);
  });

  it('retryLoad forces GET even when dirty', () => {
    session.setQuery('board', 'draft');
    session.retryLoad();
    http.expectOne('/api/list-filter').flush({
      board: { query: 'server', statusIds: [] },
      backlog: emptyWs.backlog,
    });
    expect(session.filter('board').query).toBe('server');
  });
});
