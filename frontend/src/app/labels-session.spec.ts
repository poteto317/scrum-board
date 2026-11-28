import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LabelsSession } from './labels-session';
import { ListFilterSession } from './list-filter-session';
import { ProjectBoardCache } from './project-board-cache';
import { Column, Item } from './models';

const cols: Column[] = [{ id: 1, name: 'Todo', position: 0 }];

function itemWithLabels(labels: { id: number; name: string; color: string }[]): Item {
  return {
    id: 1,
    number: 1,
    projectId: 1,
    columnId: 1,
    title: 'A',
    description: '',
    solution: '',
    position: 0,
    backlogPosition: 0,
    offsetY: 0,
    prUrls: [],
    relatedItems: [],
    labels,
    assignee: '',
    closeReason: '',
    favorite: false,
    dueAt: null,
    createdAt: '',
    updatedAt: '',
  };
}

describe('LabelsSession', () => {
  let session: LabelsSession;
  let cache: ProjectBoardCache;
  let filterSession: ListFilterSession;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    session = TestBed.inject(LabelsSession);
    cache = TestBed.inject(ProjectBoardCache);
    filterSession = TestBed.inject(ListFilterSession);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    try {
      http.verify();
    } finally {
      TestBed.resetTestingModule();
    }
  });

  it('tracks loaded vs loading state and preserves existing labels when refresh fails (L-002)', () => {
    expect(session.loaded()).toBe(false);
    expect(session.loading()).toBe(false);

    session.load();
    expect(session.loading()).toBe(true);
    http
      .expectOne('/api/labels')
      .flush({ labels: [{ id: 1, name: 'Bug', color: '#ef4444' }] });
    expect(session.loaded()).toBe(true);
    expect(session.loading()).toBe(false);
    expect(session.labels()).toEqual([{ id: 1, name: 'Bug', color: '#ef4444' }]);

    // Refresh failure must keep previous labels intact.
    session.load({ force: true });
    http
      .expectOne('/api/labels')
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
    expect(session.loaded()).toBe(true);
    expect(session.loading()).toBe(false);
    expect(session.loadError()).toBe('boom');
    expect(session.labels()).toEqual([{ id: 1, name: 'Bug', color: '#ef4444' }]);
  });

  it('keeps loaded false when initial GET fails', () => {
    session.load();
    http
      .expectOne('/api/labels')
      .flush({ message: 'fail' }, { status: 500, statusText: 'Server Error' });
    expect(session.loaded()).toBe(false);
    expect(session.loadError()).toBe('fail');
  });

  it('does not update labels/cache/filter on CRUD failures and propagates successes (L-001)', () => {
    session.load();
    http
      .expectOne('/api/labels')
      .flush({ labels: [{ id: 1, name: 'Bug', color: '#ef4444' }] });
    cache.putBoard(1, [itemWithLabels([{ id: 1, name: 'Bug', color: '#ef4444' }])], cols);
    filterSession.filters.set({
      board: { query: '', statusIds: [], labelIds: [1] },
      backlog: { query: '', statusIds: [], labelIds: [1] },
    });

    const events: unknown[] = [];
    session.changes$.subscribe((e) => events.push(e));

    // Update failure must leave catalog and cache untouched.
    let errored = false;
    session.update(1, { name: 'Dup' }).subscribe({ error: () => (errored = true) });
    http
      .expectOne('/api/labels/1')
      .flush({ message: 'dup' }, { status: 409, statusText: 'Conflict' });
    expect(errored).toBe(true);
    expect(session.labels()[0].name).toBe('Bug');
    expect(cache.getBoard(1)?.[0].labels?.[0].name).toBe('Bug');
    expect(events).toHaveLength(0);

    // Update success propagates to catalog, cache, and changes$.
    session.update(1, { name: 'Crash', color: '#3b82f6' }).subscribe();
    http.expectOne('/api/labels/1').flush({ id: 1, name: 'Crash', color: '#3b82f6' });
    expect(session.labels()).toEqual([{ id: 1, name: 'Crash', color: '#3b82f6' }]);
    expect(cache.getBoard(1)?.[0].labels).toEqual([{ id: 1, name: 'Crash', color: '#3b82f6' }]);
    expect(events).toEqual([{ kind: 'updated', label: { id: 1, name: 'Crash', color: '#3b82f6' } }]);

    // Delete success prunes catalog, cache, and list filter.
    session.remove(1).subscribe();
    http.expectOne('/api/labels/1').flush(null);
    expect(session.labels()).toEqual([]);
    expect(cache.getBoard(1)?.[0].labels).toEqual([]);
    expect(filterSession.filter('board').labelIds).toEqual([]);
    expect(filterSession.filter('backlog').labelIds).toEqual([]);
  });

  it('syncWithObservedItems reloads when observed items contain unknown or renamed labels', () => {
    session.load();
    http
      .expectOne('/api/labels')
      .flush({ labels: [{ id: 1, name: 'Bug', color: '#ef4444' }] });

    // Same label -> no extra GET.
    session.syncWithObservedItems([itemWithLabels([{ id: 1, name: 'Bug', color: '#ef4444' }])]);
    http.expectNone('/api/labels');

    // Renamed by another user -> triggers background load.
    session.syncWithObservedItems([itemWithLabels([{ id: 1, name: 'Defect', color: '#ef4444' }])]);
    http
      .expectOne('/api/labels')
      .flush({ labels: [{ id: 1, name: 'Defect', color: '#ef4444' }] });
    expect(session.labels()[0].name).toBe('Defect');
  });

  it('ignores in-flight GET response when create/update/remove completes first', () => {
    session.load();
    http.expectOne('/api/labels').flush({ labels: [{ id: 1, name: 'Old', color: '#64748b' }] });

    session.load({ force: true });
    const staleGet = http.expectOne('/api/labels');

    // Create completes while refresh GET /api/labels is still in flight.
    session.create({ name: 'NewLabel', color: '#22c55e' }).subscribe();
    http.expectOne({ method: 'POST', url: '/api/labels' }).flush({
      id: 9,
      name: 'NewLabel',
      color: '#22c55e',
    });
    expect(session.labels()).toEqual([
      { id: 1, name: 'Old', color: '#64748b' },
      { id: 9, name: 'NewLabel', color: '#22c55e' },
    ]);
    expect(session.loading()).toBe(false);

    // Stale GET finishes afterward -> must NOT overwrite newly created label.
    staleGet.flush({ labels: [{ id: 1, name: 'Old', color: '#64748b' }] });
    expect(session.labels()).toEqual([
      { id: 1, name: 'Old', color: '#64748b' },
      { id: 9, name: 'NewLabel', color: '#22c55e' },
    ]);
  });

  it('drops in-flight create/update/remove results after clear() and reloads when created before initial load', () => {
    // Flight cancelled across logout clear().
    session.create({ name: 'Ghost', color: '#ef4444' }).subscribe();
    const postGhost = http.expectOne({ method: 'POST', url: '/api/labels' });
    session.clear();
    postGhost.flush({ id: 42, name: 'Ghost', color: '#ef4444' });
    expect(session.labels()).toEqual([]);
    expect(session.loaded()).toBe(false);

    // Create while !loaded() keeps loaded=false and triggers GET /api/labels to hydrate full catalog.
    session.create({ name: 'First', color: '#3b82f6' }).subscribe();
    http.expectOne({ method: 'POST', url: '/api/labels' }).flush({ id: 1, name: 'First', color: '#3b82f6' });
    expect(session.loaded()).toBe(false);
    http.expectOne({ method: 'GET', url: '/api/labels' }).flush({
      labels: [
        { id: 1, name: 'First', color: '#3b82f6' },
        { id: 2, name: 'Existing', color: '#22c55e' },
      ],
    });
    expect(session.loaded()).toBe(true);
    expect(session.labels()).toHaveLength(2);
  });
});
