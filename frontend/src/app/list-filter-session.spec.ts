import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIST_FILTER_LOAD_FAILURE,
  ListFilterSession,
} from './list-filter-session';

const emptyWs = {
  board: { query: '', statusIds: [] as number[], labelIds: [] as number[] },
  backlog: { query: '', statusIds: [] as number[], labelIds: [] as number[] },
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
      board: { query: 'hi', statusIds: [1], labelIds: [3] },
      backlog: { query: '', statusIds: [2] },
    });
    expect(session.filter('board')).toEqual({ query: 'hi', statusIds: [1], labelIds: [3] });
    expect(session.filter('backlog')).toEqual({ query: '', statusIds: [2], labelIds: [] });
    expect(session.loadError()).toBe('');
  });

  it('sets loadError on GET failure without treating as empty success', () => {
    session.load();
    http.expectOne('/api/list-filter').flush({ message: 'x' }, { status: 500, statusText: 'err' });
    expect(session.loadError()).toBe(LIST_FILTER_LOAD_FAILURE);
    expect(session.filter('board')).toEqual({ query: '', statusIds: [], labelIds: [] });
  });

  it('board edits do not change backlog draft', async () => {
    vi.useFakeTimers();
    session.load();
    http.expectOne('/api/list-filter').flush({
      board: { query: '', statusIds: [] },
      backlog: { query: '', statusIds: [1] },
    });
    session.setQuery('board', 'only-board');
    expect(session.filter('backlog')).toEqual({ query: '', statusIds: [1], labelIds: [] });
    await vi.advanceTimersByTimeAsync(300);
    const req = http.expectOne('/api/list-filter');
    expect(req.request.body).toEqual({
      board: { query: 'only-board', statusIds: [], labelIds: [] },
      backlog: { query: '', statusIds: [1], labelIds: [] },
    });
    req.flush(req.request.body);
  });

  it('clear affects only one view', async () => {
    vi.useFakeTimers();
    session.load();
    http.expectOne('/api/list-filter').flush({
      board: { query: 'b', statusIds: [2], labelIds: [10] },
      backlog: { query: 'k', statusIds: [1] },
    });
    session.clear('board');
    await vi.advanceTimersByTimeAsync(300);
    const req = http.expectOne('/api/list-filter');
    expect(req.request.body.board).toEqual({ query: '', statusIds: [], labelIds: [] });
    expect(req.request.body.backlog).toEqual({ query: 'k', statusIds: [1], labelIds: [] });
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
    expect(session.filter('board')).toEqual({ query: 'ok', statusIds: [1], labelIds: [] });
    expect(session.filter('backlog')).toEqual({ query: '', statusIds: [1], labelIds: [] });
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
      board: { query: 'ab', statusIds: [], labelIds: [] },
      backlog: { query: '', statusIds: [], labelIds: [] },
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
      board: { query: 'early', statusIds: [], labelIds: [] },
      backlog: { query: 'kept', statusIds: [1], labelIds: [] },
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

  it('toggles labelIds and prunes deleted label from drafts without extra PUT', async () => {
    vi.useFakeTimers();
    session.load();
    http.expectOne('/api/list-filter').flush({
      board: { query: '', statusIds: [], labelIds: [5] },
      backlog: { query: '', statusIds: [], labelIds: [5, 7] },
    });
    session.toggleLabel('board', 7);
    expect(session.filter('board').labelIds).toEqual([5, 7]);
    await vi.advanceTimersByTimeAsync(300);
    const req = http.expectOne('/api/list-filter');
    expect(req.request.body.board.labelIds).toEqual([5, 7]);
    req.flush(req.request.body);

    session.pruneDeletedLabel(5);
    await vi.advanceTimersByTimeAsync(300);
    http.expectNone('/api/list-filter');
    expect(session.filter('board').labelIds).toEqual([7]);
    expect(session.filter('backlog').labelIds).toEqual([7]);
  });

  it('does not resurrect pruned label when an in-flight GET or PUT completes later', async () => {
    vi.useFakeTimers();
    session.load();
    const inFlightGet = http.expectOne('/api/list-filter');

    // Label 5 was deleted while GET is in flight.
    session.pruneDeletedLabel(5);
    inFlightGet.flush({
      board: { query: '', statusIds: [], labelIds: [5, 7] },
      backlog: { query: '', statusIds: [], labelIds: [5] },
    });
    expect(session.filter('board').labelIds).toEqual([7]);
    expect(session.filter('backlog').labelIds).toEqual([]);

    // In-flight PUT containing label 7 finishes after label 7 is also deleted -> 7 must not return.
    session.toggleLabel('board', 8);
    await vi.advanceTimersByTimeAsync(300);
    const inFlightPut = http.expectOne('/api/list-filter');
    session.pruneDeletedLabel(7);
    inFlightPut.flush({
      board: { query: '', statusIds: [], labelIds: [7, 8] },
      backlog: { query: '', statusIds: [], labelIds: [] },
    });
    expect(session.filter('board').labelIds).toEqual([8]);
  });
});
