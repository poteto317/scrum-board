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
    api.updateItem(7, { columnId: 3 }).subscribe();
    const req = http.expectOne('/api/items/7');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ columnId: 3 });
    req.flush({ id: 7, columnId: 3, title: '学習', description: '' });
  });
  it('propagates save failures so inputs can be retained', () => {
    let status = 0;
    api.updateItem(7, { title: '編集中' }).subscribe({ error: (e) => (status = e.status) });
    http.expectOne('/api/items/7').flush({ message: '失敗' }, { status: 500, statusText: 'Error' });
    expect(status).toBe(500);
  });
  it('resolves a public number through the number-specific endpoint', () => {
    api.itemByNumber(3).subscribe((card) => expect(card.id).toBe(18));
    const req = http.expectOne('/api/items/by-number/3');
    expect(req.request.method).toBe('GET');
    req.flush({ id: 18, number: 3, columnId: 1, title: 'Task', description: '' });
  });
  it('patches assignee by public number', () => {
    api.updateAssigneeByNumber(7, 'Claude').subscribe((card) => expect(card.assignee).toBe('Claude'));
    const req = http.expectOne('/api/items/by-number/7/assignee');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ assignee: 'Claude' });
    req.flush({ id: 22, number: 7, assignee: 'Claude' });
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
  it('sends PUT /api/items/order with column itemIds', () => {
    let result: unknown;
    const columns = [
      { columnId: 1, itemIds: [2, 1] },
      { columnId: 2, itemIds: [3] },
    ];
    api.reorderItems(columns).subscribe((res) => (result = res));
    const req = http.expectOne('/api/items/order');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ columns });
    const payload = { items: [{ id: 2, number: 2, columnId: 1, title: 'x', position: 0 }] };
    req.flush(payload);
    expect(result).toEqual(payload);
  });
  it('fetches backlog cards', () => {
    let result: unknown;
    api.backlog().subscribe((res) => (result = res));
    const req = http.expectOne('/api/backlog');
    expect(req.request.method).toBe('GET');
    const payload = {
      items: [{ id: 2, number: 2, columnId: 1, title: 'B', backlogPosition: 0 }],
    };
    req.flush(payload);
    expect(result).toEqual(payload);
  });
  it('sends PUT /api/backlog/order with itemIds and returns reordered cards', () => {
    let result: unknown;
    api.reorderBacklog([3, 1, 2]).subscribe((res) => (result = res));
    const req = http.expectOne('/api/backlog/order');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ itemIds: [3, 1, 2] });
    const payload = {
      items: [
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
  it('lists command templates', () => {
    let result: unknown;
    api.listCommandTemplates().subscribe((res) => (result = res));
    const req = http.expectOne('/api/command-templates');
    expect(req.request.method).toBe('GET');
    const payload = {
      templates: [{ id: 1, name: 'gh', template: 'gh pr view {{url}}', position: 0 }],
    };
    req.flush(payload);
    expect(result).toEqual(payload);
  });
  it('creates a command template', () => {
    const input = { name: 'gh', template: 'gh pr view {{url}}' };
    let result: unknown;
    api.createCommandTemplate(input).subscribe((res) => (result = res));
    const req = http.expectOne('/api/command-templates');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(input);
    const created = { id: 4, name: 'gh', template: 'gh pr view {{url}}', position: 1 };
    req.flush(created);
    expect(result).toEqual(created);
  });
  it('patches a command template', () => {
    api.updateCommandTemplate(4, { name: 'gh2' }).subscribe();
    const req = http.expectOne('/api/command-templates/4');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'gh2' });
    req.flush({ id: 4, name: 'gh2', template: 'gh pr view {{url}}', position: 1 });
  });
  it('deletes a command template', () => {
    api.deleteCommandTemplate(4).subscribe();
    const req = http.expectOne('/api/command-templates/4');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
  it('lists card command templates by number', () => {
    api.listItemCommandTemplatesByNumber(3).subscribe();
    const req = http.expectOne('/api/items/by-number/3/command-templates');
    expect(req.request.method).toBe('GET');
    req.flush({ templates: [] });
  });
  it('replaces card command templates by number', () => {
    api.replaceItemCommandTemplatesByNumber(3, [1, 2]).subscribe();
    const req = http.expectOne('/api/items/by-number/3/command-templates');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ templateIds: [1, 2] });
    req.flush({ templates: [] });
  });
  it('gets and puts command template defaults', () => {
    api.listCommandTemplateDefaults().subscribe();
    http.expectOne('/api/command-template-defaults').flush({ templateIds: [1] });
    api.replaceCommandTemplateDefaults([2]).subscribe();
    const req = http.expectOne('/api/command-template-defaults');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ templateIds: [2] });
    req.flush({ templateIds: [2] });
  });
  it('applies command templates to all cards', () => {
    api.applyCommandTemplatesToAllItems([1]).subscribe();
    const req = http.expectOne('/api/command-templates/apply-to-all-items');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ templateIds: [1] });
    req.flush(null);
  });
});

it('requests history by public number and an optional event cursor', () => {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const api = TestBed.inject(Api),
    http = TestBed.inject(HttpTestingController);
  api.history(13, 42).subscribe();
  const req = http.expectOne('/api/items/by-number/13/history?before=42');
  expect(req.request.method).toBe('GET');
  req.flush({ events: [], nextBefore: 0 });
  http.verify();
});
