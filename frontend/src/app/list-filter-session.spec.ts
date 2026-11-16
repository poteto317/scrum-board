import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIST_FILTER_LOAD_FAILURE,
  ListFilterSession,
} from './list-filter-session';

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

  it('loads filter into draft and confirmed', () => {
    session.load();
    http.expectOne('/api/list-filter').flush({ query: 'hi', statusIds: [1] });
    expect(session.filter()).toEqual({ query: 'hi', statusIds: [1] });
    expect(session.loadError()).toBe('');
  });

  it('sets loadError on GET failure without treating as empty success', () => {
    session.load();
    http.expectOne('/api/list-filter').flush({ message: 'x' }, { status: 500, statusText: 'err' });
    expect(session.loadError()).toBe(LIST_FILTER_LOAD_FAILURE);
    expect(session.filter()).toEqual({ query: '', statusIds: [] });
  });

  it('retryLoad clears loadError on success', () => {
    session.load();
    http.expectOne('/api/list-filter').flush({ message: 'x' }, { status: 500, statusText: 'err' });
    session.retryLoad();
    http.expectOne('/api/list-filter').flush({ query: '', statusIds: [] });
    expect(session.loadError()).toBe('');
  });

  it('ignores stale GET after a newer load', () => {
    session.load();
    const first = http.expectOne('/api/list-filter');
    session.load();
    const second = http.expectOne('/api/list-filter');
    second.flush({ query: 'new', statusIds: [] });
    first.flush({ query: 'old', statusIds: [9] });
    expect(session.filter()).toEqual({ query: 'new', statusIds: [] });
  });

  it('ignores stale GET after user edits', () => {
    session.load();
    const req = http.expectOne('/api/list-filter');
    session.setQuery('typed');
    req.flush({ query: 'server', statusIds: [] });
    expect(session.filter().query).toBe('typed');
  });

  it('debounces PUT and applies response body', async () => {
    vi.useFakeTimers();
    session.setQuery('ab');
    await vi.advanceTimersByTimeAsync(300);
    const req = http.expectOne('/api/list-filter');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ query: 'ab', statusIds: [] });
    req.flush({ query: 'ab', statusIds: [] });
    expect(session.filter()).toEqual({ query: 'ab', statusIds: [] });
    expect(session.saveError()).toBe('');
  });

  it('PUT failure reverts draft to confirmed', async () => {
    vi.useFakeTimers();
    session.load();
    http.expectOne('/api/list-filter').flush({ query: 'ok', statusIds: [1] });
    session.setQuery('bad');
    await vi.advanceTimersByTimeAsync(300);
    http
      .expectOne('/api/list-filter')
      .flush({ message: 'x' }, { status: 500, statusText: 'err' });
    expect(session.filter()).toEqual({ query: 'ok', statusIds: [1] });
    expect(session.saveError()).not.toBe('');
  });

  it('in-flight PUT does not rewind a newer draft', async () => {
    vi.useFakeTimers();
    session.setQuery('one');
    await vi.advanceTimersByTimeAsync(300);
    const first = http.expectOne('/api/list-filter');
    session.setQuery('two');
    await vi.advanceTimersByTimeAsync(300);
    const second = http.expectOne('/api/list-filter');
    first.flush({ query: 'one', statusIds: [] });
    expect(session.filter().query).toBe('two');
    second.flush({ query: 'two', statusIds: [] });
    expect(session.filter().query).toBe('two');
  });

  it('in-flight PUT before next debounce does not rewind typed draft', async () => {
    vi.useFakeTimers();
    session.setQuery('one');
    await vi.advanceTimersByTimeAsync(300);
    const first = http.expectOne('/api/list-filter');
    session.setQuery('two');
    first.flush({ query: 'one', statusIds: [] });
    expect(session.filter().query).toBe('two');
    await vi.advanceTimersByTimeAsync(300);
    http.expectOne('/api/list-filter').flush({ query: 'two', statusIds: [] });
  });

  it('clear schedules empty PUT', async () => {
    vi.useFakeTimers();
    session.toggleStatus(2);
    await vi.advanceTimersByTimeAsync(300);
    http.expectOne('/api/list-filter').flush({ query: '', statusIds: [2] });
    session.clear();
    await vi.advanceTimersByTimeAsync(300);
    const req = http.expectOne('/api/list-filter');
    expect(req.request.body).toEqual({ query: '', statusIds: [] });
    req.flush({ query: '', statusIds: [] });
  });

  it('skips load while draft is dirty so navigation does not drop edits', async () => {
    vi.useFakeTimers();
    session.setQuery('keep');
    session.load();
    http.expectNone('/api/list-filter');
    expect(session.filter().query).toBe('keep');
    await vi.advanceTimersByTimeAsync(300);
    http.expectOne('/api/list-filter').flush({ query: 'keep', statusIds: [] });
  });

  it('clips query to 200 characters', () => {
    session.setQuery('あ'.repeat(201));
    expect([...session.filter().query]).toHaveLength(200);
  });

  it('retryLoad forces GET even when dirty', () => {
    session.setQuery('draft');
    session.retryLoad();
    http.expectOne('/api/list-filter').flush({ query: 'server', statusIds: [] });
    expect(session.filter().query).toBe('server');
  });
});
