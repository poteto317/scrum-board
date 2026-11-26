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
  it('boardMeta GETs /api/board/meta without items or query', () => {
    let body: unknown;
    api.boardMeta().subscribe((b) => (body = b));
    const req = http.expectOne('/api/board/meta');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual([]);
    req.flush({ columns: [{ id: 1, name: 'Todo' }], settings: { cardLayout: 'pack' } });
    expect(body).toEqual({ columns: [{ id: 1, name: 'Todo' }], settings: { cardLayout: 'pack' } });
  });
  it('boardMetaConditional sends If-None-Match and maps 304 to notModified', () => {
    let result: unknown;
    api.boardMetaConditional('"abc"').subscribe((r) => (result = r));
    const req = http.expectOne('/api/board/meta');
    expect(req.request.headers.get('If-None-Match')).toBe('"abc"');
    req.flush(null, { status: 304, statusText: 'Not Modified', headers: { ETag: '"abc"' } });
    expect(result).toEqual({ status: 'notModified', etag: '"abc"' });
  });
  it('boardMetaConditional returns ok with the ETag on 200', () => {
    let result: unknown;
    api.boardMetaConditional(null).subscribe((r) => (result = r));
    const req = http.expectOne('/api/board/meta');
    expect(req.request.headers.has('If-None-Match')).toBe(false);
    req.flush({ columns: [], settings: { cardLayout: 'pack' } }, { headers: { ETag: '"v1"' } });
    expect(result).toEqual({
      status: 'ok',
      etag: '"v1"',
      body: { columns: [], settings: { cardLayout: 'pack' } },
    });
  });
  it('gets the latest project AI conversation of the caller with its messages', () => {
    let body: unknown;
    api.getLatestProjectAIChat(4).subscribe((b) => (body = b));
    const req = http.expectOne('/api/projects/4/ai-chat');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual([]);
    const view = {
      conversation: {
        id: 9,
        projectId: 4,
        title: 'q',
        createdAt: '2026-11-26T00:00:00Z',
        updatedAt: '2026-11-26T00:00:00Z',
      },
      messages: [
        {
          id: 1,
          projectId: 4,
          conversationId: 9,
          role: 'user',
          body: 'q',
          createdAt: '2026-11-26T00:00:00Z',
        },
      ],
    };
    req.flush(view);
    expect(body).toEqual(view);
  });
  it('maps no project AI conversation to null and an empty list', () => {
    let body: unknown;
    api.getLatestProjectAIChat(4).subscribe((b) => (body = b));
    http.expectOne('/api/projects/4/ai-chat').flush({ conversation: null, messages: [] });
    expect(body).toEqual({ conversation: null, messages: [] });
  });
  it('does not show messages that belong to no conversation', () => {
    let body: unknown;
    api.getLatestProjectAIChat(4).subscribe((b) => (body = b));
    http.expectOne('/api/projects/4/ai-chat').flush({ messages: [{ id: 1, body: 'q' }] });
    expect(body).toEqual({ conversation: null, messages: [] });
  });
  it('lists the project AI conversations of the caller', () => {
    let body: unknown;
    api.listProjectAIConversations(4).subscribe((b) => (body = b));
    const req = http.expectOne('/api/projects/4/ai-conversations');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual([]);
    const conversations = [{ id: 9, projectId: 4, title: 'q', createdAt: 't', updatedAt: 't' }];
    req.flush({ conversations });
    expect(body).toEqual(conversations);
  });
  it('maps a missing project AI conversation list to an empty list', () => {
    let body: unknown;
    api.listProjectAIConversations(4).subscribe((b) => (body = b));
    http.expectOne('/api/projects/4/ai-conversations').flush({});
    expect(body).toEqual([]);
  });
  it('gets one project AI conversation with its messages', () => {
    let body: unknown;
    api.getProjectAIConversation(4, 9).subscribe((b) => (body = b));
    const req = http.expectOne('/api/projects/4/ai-conversations/9');
    expect(req.request.method).toBe('GET');
    const view = { conversation: { id: 9 }, messages: [] };
    req.flush(view);
    expect(body).toEqual(view);
  });
  it('deletes one project AI conversation', () => {
    let done = false;
    api.deleteProjectAIConversation(4, 9).subscribe(() => (done = true));
    const req = http.expectOne('/api/projects/4/ai-conversations/9');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(done).toBe(true);
  });
  it('posts a project AI chat message to an existing conversation', () => {
    api.postProjectAIChat(4, '期限が近いものは', 9).subscribe();
    const req = http.expectOne('/api/projects/4/ai-chat');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ message: '期限が近いものは', conversationId: 9 });
    req.flush({ conversation: {}, assistant: {}, messages: [] });
  });
  it('posts a project AI chat message as a new conversation', () => {
    api.postProjectAIChat(4, '期限が近いものは', 'new').subscribe();
    const req = http.expectOne('/api/projects/4/ai-chat');
    expect(req.request.body).toEqual({ message: '期限が近いものは', newConversation: true });
    req.flush({ conversation: {}, assistant: {}, messages: [] });
  });
  it('posts a project AI chat message with the open item number', () => {
    api.postProjectAIChat(4, '要約して', 9, 12).subscribe();
    const req = http.expectOne('/api/projects/4/ai-chat');
    expect(req.request.body).toEqual({ message: '要約して', focusItemNumber: 12, conversationId: 9 });
    req.flush({ conversation: {}, assistant: {}, messages: [] });
  });
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
  it('passes projectId when resolving by number within a project', () => {
    api.itemByNumber(5, 3).subscribe();
    const req = http.expectOne('/api/items/by-number/5?projectId=3');
    expect(req.request.method).toBe('GET');
    req.flush({ id: 18, number: 5, projectId: 3, columnId: 1, title: 'Task', description: '' });
  });
  it('patches assignee by public number', () => {
    api.updateAssigneeByNumber(7, 'Claude').subscribe((card) => expect(card.assignee).toBe('Claude'));
    const req = http.expectOne('/api/items/by-number/7/assignee');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ assignee: 'Claude' });
    req.flush({ id: 22, number: 7, assignee: 'Claude' });
  });
  it('sends PUT /api/projects/order with projectIds and returns reordered projects', () => {
    let result: unknown;
    api.reorderProjects([3, 1, 2]).subscribe((res) => (result = res));
    const req = http.expectOne('/api/projects/order');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ projectIds: [3, 1, 2] });
    const payload = {
      projects: [
        { id: 3, name: 'C', position: 0 },
        { id: 1, name: 'A', position: 1 },
        { id: 2, name: 'B', position: 2 },
      ],
    };
    req.flush(payload);
    expect(result).toEqual(payload);
  });
  it('propagates project reorder conflict errors', () => {
    let status = 0;
    api.reorderProjects([1, 2]).subscribe({ error: (e) => (status = e.status) });
    http
      .expectOne('/api/projects/order')
      .flush({ message: '競合' }, { status: 409, statusText: 'Conflict' });
    expect(status).toBe(409);
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
  it('sends PUT /api/items/order with optional offsetYs', () => {
    const columns = [{ columnId: 1, itemIds: [2, 1], offsetYs: [40, 10] }];
    api.reorderItems(columns).subscribe();
    const req = http.expectOne('/api/items/order');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ columns });
    req.flush({ items: [] });
  });
  it('patches board settings with cardLayout only', () => {
    let result: unknown;
    api.patchBoardSettings({ cardLayout: 'free' }).subscribe((res) => (result = res));
    const req = http.expectOne('/api/board/settings');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ cardLayout: 'free' });
    const payload = { settings: { cardLayout: 'free' } };
    req.flush(payload);
    expect(result).toEqual(payload);
  });
  it('patches board settings with mobileBoardColumnId only', () => {
    let result: unknown;
    api.patchBoardSettings({ mobileBoardColumnId: 2 }).subscribe((res) => (result = res));
    const req = http.expectOne('/api/board/settings');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ mobileBoardColumnId: 2 });
    const payload = { settings: { cardLayout: 'pack', mobileBoardColumnId: 2 } };
    req.flush(payload);
    expect(result).toEqual(payload);
  });
  it('accepts pack settings responses that include items', () => {
    let result: unknown;
    api.patchBoardSettings({ cardLayout: 'pack' }).subscribe((res) => (result = res));
    const req = http.expectOne('/api/board/settings');
    const payload = {
      settings: { cardLayout: 'pack' },
      items: [{ id: 1, number: 1, columnId: 1, title: 'a', position: 0, offsetY: 12 }],
    };
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
  it('patches board settings with activeProjectId only', () => {
    let result: unknown;
    api.patchBoardSettings({ activeProjectId: 3 }).subscribe((res) => (result = res));
    const req = http.expectOne('/api/board/settings');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ activeProjectId: 3 });
    const payload = {
      settings: { cardLayout: 'pack', mobileBoardColumnId: 1, activeProjectId: 3 },
    };
    req.flush(payload);
    expect(result).toEqual(payload);
  });
  it('lists, creates, renames, and deletes projects', () => {
    api.listProjects().subscribe();
    const list = http.expectOne('/api/projects');
    expect(list.request.method).toBe('GET');
    list.flush({ projects: [{ id: 1, name: 'メイン', position: 0 }] });

    api.createProject('次').subscribe();
    const created = http.expectOne('/api/projects');
    expect(created.request.method).toBe('POST');
    expect(created.request.body).toEqual({ name: '次' });
    created.flush({ id: 2, name: '次', position: 1 });

    api.patchProject(2, '改名').subscribe();
    const renamed = http.expectOne('/api/projects/2');
    expect(renamed.request.method).toBe('PATCH');
    expect(renamed.request.body).toEqual({ name: '改名' });
    renamed.flush({ id: 2, name: '改名', position: 1 });

    api.deleteProject(2).subscribe();
    const removed = http.expectOne('/api/projects/2');
    expect(removed.request.method).toBe('DELETE');
    removed.flush(null);
  });
  it('lists and mutates sprints with projectId query and velocity tri-state', () => {
    api.listSprints(3).subscribe();
    const list = http.expectOne('/api/sprints?projectId=3');
    expect(list.request.method).toBe('GET');
    list.flush({ sprints: [] });

    api
      .createSprint({
        name: 'Sprint 1',
        startDate: '2026-11-21',
        endDate: '2026-12-04',
        projectId: 3,
      })
      .subscribe();
    const created = http.expectOne('/api/sprints');
    expect(created.request.method).toBe('POST');
    expect(created.request.body).toEqual({
      name: 'Sprint 1',
      startDate: '2026-11-21',
      endDate: '2026-12-04',
      projectId: 3,
    });
    created.flush({
      id: 1,
      projectId: 3,
      name: 'Sprint 1',
      goal: '',
      startDate: '2026-11-21',
      endDate: '2026-12-04',
      status: 'planned',
      velocity: null,
      suggestedVelocity: 0,
      itemCount: 0,
      items: [],
      createdAt: '',
      updatedAt: '',
    });

    api.getSprint(1, 3).subscribe();
    const got = http.expectOne('/api/sprints/1?projectId=3');
    expect(got.request.method).toBe('GET');
    got.flush({
      id: 1,
      projectId: 3,
      name: 'Sprint 1',
      goal: '',
      startDate: '2026-11-21',
      endDate: '2026-12-04',
      status: 'completed',
      velocity: 4,
      suggestedVelocity: 2,
      itemCount: 2,
      items: [],
      createdAt: '',
      updatedAt: '',
    });

    api.patchSprint(1, { goal: 'g' }).subscribe();
    const omitVelocity = http.expectOne('/api/sprints/1');
    expect(omitVelocity.request.method).toBe('PATCH');
    expect(omitVelocity.request.body).toEqual({ goal: 'g' });
    expect(Object.prototype.hasOwnProperty.call(omitVelocity.request.body, 'velocity')).toBe(false);
    omitVelocity.flush({ id: 1, goal: 'g' });

    api.patchSprint(1, { velocity: null }, 3).subscribe();
    const clearVelocity = http.expectOne('/api/sprints/1?projectId=3');
    expect(clearVelocity.request.body).toEqual({ velocity: null });
    clearVelocity.flush({ id: 1, velocity: null });

    api.patchSprint(1, { velocity: 5 }).subscribe();
    const setVelocity = http.expectOne('/api/sprints/1');
    expect(setVelocity.request.body).toEqual({ velocity: 5 });
    setVelocity.flush({ id: 1, velocity: 5 });

    api.replaceSprintItems(1, [10, 11], 3).subscribe();
    const putItems = http.expectOne('/api/sprints/1/items?projectId=3');
    expect(putItems.request.method).toBe('PUT');
    expect(putItems.request.body).toEqual({ itemIds: [10, 11] });
    putItems.flush({ id: 1, items: [] });

    api.activateSprint(1).subscribe();
    const activate = http.expectOne('/api/sprints/1/activate');
    expect(activate.request.method).toBe('POST');
    activate.flush({ id: 1, status: 'active' });

    api.completeSprint(1, 5, 3).subscribe();
    const complete = http.expectOne('/api/sprints/1/complete?projectId=3');
    expect(complete.request.method).toBe('POST');
    expect(complete.request.body).toEqual({ velocity: 5 });
    complete.flush({ id: 1, status: 'completed', velocity: 5 });

    api.completeSprint(1).subscribe();
    const completeOmit = http.expectOne('/api/sprints/1/complete');
    expect(completeOmit.request.body).toEqual({});
    completeOmit.flush({ id: 1, status: 'completed' });

    api.deleteSprint(1, 3).subscribe();
    const removed = http.expectOne('/api/sprints/1?projectId=3');
    expect(removed.request.method).toBe('DELETE');
    removed.flush(null);
  });
  it('gets and puts header menu', () => {
    api.headerMenu().subscribe();
    http.expectOne('/api/header-menu').flush({
      board: { hiddenIds: [] },
      backlog: { hiddenIds: [] },
      itemDetail: { hiddenIds: [] },
    });
    api
      .putHeaderMenu({
        board: { hiddenIds: ['open_projects'] },
        backlog: { hiddenIds: [] },
        itemDetail: { hiddenIds: [] },
      })
      .subscribe();
    const req = http.expectOne('/api/header-menu');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body.board.hiddenIds).toEqual(['open_projects']);
    req.flush(req.request.body);
  });
  it('gets and puts list filter', () => {
    api.listFilter().subscribe();
    http.expectOne('/api/list-filter').flush({
      board: { query: '', statusIds: [] },
      backlog: { query: '', statusIds: [] },
    });
    api
      .putListFilter({
        board: { query: 'x', statusIds: [1] },
        backlog: { query: '', statusIds: [] },
      })
      .subscribe();
    const req = http.expectOne('/api/list-filter');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      board: { query: 'x', statusIds: [1] },
      backlog: { query: '', statusIds: [] },
    });
    req.flush(req.request.body);
  });

  it('PUTs AI credits with explicit limitTokens null for unlimited', () => {
    api.putAICredits({ limitTokens: null }).subscribe();
    const req = http.expectOne('/api/ai/credits');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ limitTokens: null });
    expect(JSON.stringify(req.request.body)).toContain('"limitTokens":null');
    req.flush({
      limitTokens: null,
      usedTokens: 0,
      remainingTokens: null,
      unlimited: true,
      approximate: true,
      period: 'cumulative',
      configured: true,
    });
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
