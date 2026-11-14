import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Api } from './api';

describe('Api', () => {
  let api: Api;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(Api);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('sends the selected status as columnId', () => {
    api.updateCard(7, { columnId: 3 }).subscribe();
    const req = http.expectOne('/api/cards/7');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ columnId: 3 });
    req.flush({ id: 7, columnId: 3, title: '学習', description: '' });
  });
  it('propagates save failures so inputs can be retained', () => {
    let status = 0;
    api.updateCard(7, { title: '編集中' }).subscribe({ error: (e) => (status = e.status) });
    http.expectOne('/api/cards/7').flush({ message: '失敗' }, { status: 500, statusText: 'Error' });
    expect(status).toBe(500);
  });
  it('resolves a public number through the number-specific endpoint', () => {
    api.cardByNumber(3).subscribe((card) => expect(card.id).toBe(18));
    const req = http.expectOne('/api/cards/by-number/3');
    expect(req.request.method).toBe('GET');
    req.flush({ id: 18, number: 3, columnId: 1, title: 'Task', description: '' });
  });
  it('sends PUT /api/columns/order with columnIds and returns reordered columns', () => {
    let result: unknown;
    api.reorderColumns([1, 2, 9, 3]).subscribe((res) => (result = res));
    const req = http.expectOne('/api/columns/order');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ columnIds: [1, 2, 9, 3] });
    const payload = {
      columns: [
        { id: 1, name: 'Todo', position: 0 },
        { id: 2, name: 'Doing', position: 1 },
        { id: 9, name: 'Review', position: 2 },
        { id: 3, name: 'Done', position: 3 },
      ],
    };
    req.flush(payload);
    expect(result).toEqual(payload);
  });
  it('propagates column reorder conflict errors', () => {
    let status = 0;
    api.reorderColumns([1, 2, 3]).subscribe({ error: (e) => (status = e.status) });
    http
      .expectOne('/api/columns/order')
      .flush({ message: '競合' }, { status: 409, statusText: 'Conflict' });
    expect(status).toBe(409);
  });
  it('sends PUT /api/cards/order with column cardIds', () => {
    let result: unknown;
    const columns = [
      { columnId: 1, cardIds: [2, 1] },
      { columnId: 2, cardIds: [3] },
    ];
    api.reorderCards(columns).subscribe((res) => (result = res));
    const req = http.expectOne('/api/cards/order');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ columns });
    const payload = { cards: [{ id: 2, number: 2, columnId: 1, title: 'x', position: 0 }] };
    req.flush(payload);
    expect(result).toEqual(payload);
  });
  it('fetches backlog cards', () => {
    let result: unknown;
    api.backlog().subscribe((res) => (result = res));
    const req = http.expectOne('/api/backlog');
    expect(req.request.method).toBe('GET');
    const payload = {
      cards: [{ id: 2, number: 2, columnId: 1, title: 'B', backlogPosition: 0 }],
    };
    req.flush(payload);
    expect(result).toEqual(payload);
  });
  it('sends PUT /api/backlog/order with cardIds and returns reordered cards', () => {
    let result: unknown;
    api.reorderBacklog([3, 1, 2]).subscribe((res) => (result = res));
    const req = http.expectOne('/api/backlog/order');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ cardIds: [3, 1, 2] });
    const payload = {
      cards: [
        { id: 3, backlogPosition: 0 },
        { id: 1, backlogPosition: 1 },
        { id: 2, backlogPosition: 2 },
      ],
    };
    req.flush(payload);
    expect(result).toEqual(payload);
  });
  it('propagates backlog reorder conflict errors', () => {
    let status = 0;
    api.reorderBacklog([1, 2]).subscribe({ error: (e) => (status = e.status) });
    http
      .expectOne('/api/backlog/order')
      .flush({ message: '競合' }, { status: 409, statusText: 'Conflict' });
    expect(status).toBe(409);
  });
});

it('requests history by public number and an optional event cursor', () => {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const api = TestBed.inject(Api),
    http = TestBed.inject(HttpTestingController);
  api.history(13, 42).subscribe();
  const req = http.expectOne('/api/cards/by-number/13/history?before=42');
  expect(req.request.method).toBe('GET');
  req.flush({ events: [], nextBefore: 0 });
  http.verify();
});
