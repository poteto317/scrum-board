import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from './http.js';
import { createToolHandlers, safeTool } from './tools.js';

describe('createToolHandlers', () => {
  it('list_projects returns JSON on success', async () => {
    const data = { projects: [{ id: 1, name: 'Default' }] };
    const client = {
      request: vi.fn(async () => ({ ok: true, status: 200, data })),
    };
    const result = await createToolHandlers(client as HttpClient).list_projects();
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: JSON.stringify(data),
    });
    expect(client.request).toHaveBeenCalledWith('GET', '/api/projects');
  });

  it('get_item maps HTTP failure to isError without leaking body', async () => {
    const client = {
      request: vi.fn(async () => ({ ok: false, status: 404, reason: 'HTTP 404' })),
    };
    const result = await createToolHandlers(client as HttpClient).get_item({ number: 8 });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'HTTP 404' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('get_item uses by-number path', async () => {
    const client = {
      request: vi.fn(async () => ({
        ok: true,
        status: 200,
        data: { id: 23, number: 8, projectId: 1 },
      })),
    };
    await createToolHandlers(client as HttpClient).get_item({ number: 8, projectId: 1 });
    expect(client.request).toHaveBeenCalledWith(
      'GET',
      '/api/items/by-number/8?projectId=1',
    );
  });

  it('update_status uses by-number status path', async () => {
    const client = {
      request: vi.fn(async () => ({ ok: true, status: 200, data: { number: 8 } })),
    };
    await createToolHandlers(client as HttpClient).update_status({
      number: 8,
      status: 'Doing',
    });
    expect(client.request).toHaveBeenCalledWith(
      'PATCH',
      '/api/items/by-number/8/status',
      { status: 'Doing' },
    );
  });

  it('update_status success returns item JSON', async () => {
    const data = { number: 8, status: 'Doing' };
    const client = {
      request: vi.fn(async () => ({ ok: true, status: 200, data })),
    };
    const result = await createToolHandlers(client as HttpClient).update_status({
      number: 8,
      status: 'Doing',
      projectId: 1,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toMatchObject({ text: JSON.stringify(data) });
    expect(client.request).toHaveBeenCalledWith(
      'PATCH',
      '/api/items/by-number/8/status?projectId=1',
      { status: 'Doing' },
    );
  });

  it('update_assignee uses by-number assignee path', async () => {
    const client = {
      request: vi.fn(async () => ({ ok: true, status: 200, data: { number: 8 } })),
    };
    await createToolHandlers(client as HttpClient).update_assignee({
      number: 8,
      assignee: 'Cursor',
      projectId: 2,
    });
    expect(client.request).toHaveBeenCalledWith(
      'PATCH',
      '/api/items/by-number/8/assignee?projectId=2',
      { assignee: 'Cursor' },
    );
  });

  it('update_assignee sends empty string to clear', async () => {
    const client = {
      request: vi.fn(async () => ({ ok: true, status: 200, data: { number: 8, assignee: '' } })),
    };
    await createToolHandlers(client as HttpClient).update_assignee({ number: 8, assignee: '' });
    expect(client.request).toHaveBeenCalledWith(
      'PATCH',
      '/api/items/by-number/8/assignee',
      { assignee: '' },
    );
  });

  it('set_active_project patches board settings', async () => {
    const data = { activeProjectId: 2 };
    const client = {
      request: vi.fn(async () => ({ ok: true, status: 200, data })),
    };
    const result = await createToolHandlers(client as HttpClient).set_active_project({
      activeProjectId: 2,
    });
    expect(result.isError).toBeUndefined();
    expect(client.request).toHaveBeenCalledWith('PATCH', '/api/board/settings', {
      activeProjectId: 2,
    });
  });

  it('get_board maps network_error to isError', async () => {
    const client = {
      request: vi.fn(async () => ({
        ok: false,
        status: null,
        reason: 'network_error',
      })),
    };
    const result = await createToolHandlers(client as HttpClient).get_board();
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: 'network_error' });
  });

  it('create_item resolves column name and POSTs item', async () => {
    const created = { id: 10, number: 3, title: 'New', columnId: 2 };
    const client = {
      request: vi.fn(async (method: string, path: string) => {
        if (method === 'GET' && path === '/api/board') {
          return {
            ok: true,
            status: 200,
            data: { columns: [{ id: 2, name: 'Doing' }, { id: 1, name: 'Todo' }] },
          };
        }
        return { ok: true, status: 201, data: created };
      }),
    };
    const result = await createToolHandlers(client as HttpClient).create_item({
      title: 'New',
      description: 'desc',
      column: 'Doing',
      projectId: 1,
      assignee: 'Alice',
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toMatchObject({ text: JSON.stringify(created) });
    expect(client.request).toHaveBeenNthCalledWith(1, 'GET', '/api/board');
    expect(client.request).toHaveBeenNthCalledWith(2, 'POST', '/api/items', {
      title: 'New',
      description: 'desc',
      columnId: 2,
      projectId: 1,
      assignee: 'Alice',
    });
  });

  it('create_item maps board GET failure', async () => {
    const client = {
      request: vi.fn(async () => ({ ok: false, status: 500, reason: 'HTTP 500' })),
    };
    const result = await createToolHandlers(client as HttpClient).create_item({
      title: 'New',
      description: '',
      column: 'Todo',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: 'HTTP 500' });
  });

  it('create_item maps POST failure', async () => {
    const client = {
      request: vi.fn(async (method: string) => {
        if (method === 'GET') {
          return { ok: true, status: 200, data: { columns: [{ id: 1, name: 'Todo' }] } };
        }
        return { ok: false, status: 400, reason: 'HTTP 400' };
      }),
    };
    const result = await createToolHandlers(client as HttpClient).create_item({
      title: 'New',
      description: '',
      column: 'Todo',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: 'HTTP 400' });
  });

  it('create_item treats null board data as column_not_found', async () => {
    const client = {
      request: vi.fn(async () => ({ ok: true, status: 200, data: null })),
    };
    const result = await createToolHandlers(client as HttpClient).create_item({
      title: 'New',
      description: '',
      column: 'Todo',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: 'column_not_found' });
  });

  it('create_item returns column_not_found when name missing', async () => {
    const client = {
      request: vi.fn(async () => ({
        ok: true,
        status: 200,
        data: { columns: [{ id: 1, name: 'Todo' }] },
      })),
    };
    const result = await createToolHandlers(client as HttpClient).create_item({
      title: 'New',
      description: '',
      column: 'Review',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: 'column_not_found' });
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it('update_item refuses when no patch fields', async () => {
    const client = { request: vi.fn() };
    const result = await createToolHandlers(client as HttpClient).update_item({ number: 8 });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: 'no_patch_fields' });
    expect(client.request).not.toHaveBeenCalled();
  });

  it('update_item maps GET failure', async () => {
    const client = {
      request: vi.fn(async () => ({ ok: false, status: 404, reason: 'HTTP 404' })),
    };
    const result = await createToolHandlers(client as HttpClient).update_item({
      number: 8,
      title: 'x',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: 'HTTP 404' });
  });

  it('update_item maps PATCH failure', async () => {
    const client = {
      request: vi.fn(async (method: string) => {
        if (method === 'GET') {
          return { ok: true, status: 200, data: { id: 99, number: 8, projectId: 1 } };
        }
        return { ok: false, status: 500, reason: 'HTTP 500' };
      }),
    };
    const result = await createToolHandlers(client as HttpClient).update_item({
      number: 8,
      title: 'x',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: 'HTTP 500' });
  });

  it('update_item identity_mismatch when GET body is null', async () => {
    const client = {
      request: vi.fn(async () => ({ ok: true, status: 200, data: null })),
    };
    const result = await createToolHandlers(client as HttpClient).update_item({
      number: 8,
      title: 'x',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: 'identity_mismatch' });
  });

  it('update_item refuses patch when get number mismatches', async () => {
    const client = {
      request: vi.fn(async () => ({
        ok: true,
        status: 200,
        data: { id: 99, number: 7, projectId: 1 },
      })),
    };
    const handlers = createToolHandlers(client as HttpClient);
    const result = await handlers.update_item({ number: 8, title: 'x' });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: 'identity_mismatch' });
    expect(client.request).toHaveBeenCalledTimes(1); // no PATCH
  });

  it('update_item refuses when PATCH response number mismatches', async () => {
    const client = {
      request: vi.fn(async (method: string) => {
        if (method === 'GET') {
          return { ok: true, status: 200, data: { id: 99, number: 8, projectId: 1 } };
        }
        return { ok: true, status: 200, data: { id: 99, number: 9, projectId: 1 } };
      }),
    };
    const handlers = createToolHandlers(client as HttpClient);
    const result = await handlers.update_item({ number: 8, title: 'x' });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: 'identity_mismatch' });
  });

  it('update_item sends dueAt null for clear', async () => {
    const client = {
      request: vi.fn(async (method: string) => {
        if (method === 'GET') {
          return { ok: true, status: 200, data: { id: 99, number: 8, projectId: 1 } };
        }
        return { ok: true, status: 200, data: { id: 99, number: 8, projectId: 1, dueAt: null } };
      }),
    };
    const handlers = createToolHandlers(client as HttpClient);
    await handlers.update_item({ number: 8, dueAt: null });
    expect(client.request).toHaveBeenCalledWith('PATCH', '/api/items/99', { dueAt: null });
  });

  it('update_item identity_mismatch when get projectId differs', async () => {
    const client = {
      request: vi.fn(async () => ({
        ok: true,
        status: 200,
        data: { id: 99, number: 8, projectId: 2 },
      })),
    };
    const result = await createToolHandlers(client as HttpClient).update_item({
      number: 8,
      projectId: 1,
      title: 'x',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: 'identity_mismatch' });
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it('update_item PATCHes by resolved id and returns data', async () => {
    const patched = { id: 99, number: 8, projectId: 1, title: 'Updated' };
    const client = {
      request: vi.fn(async (method: string) => {
        if (method === 'GET') {
          return { ok: true, status: 200, data: { id: 99, number: 8, projectId: 1 } };
        }
        return { ok: true, status: 200, data: patched };
      }),
    };
    const result = await createToolHandlers(client as HttpClient).update_item({
      number: 8,
      projectId: 1,
      title: 'Updated',
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]).toMatchObject({ text: JSON.stringify(patched) });
    expect(client.request).toHaveBeenNthCalledWith(
      1,
      'GET',
      '/api/items/by-number/8?projectId=1',
    );
    expect(client.request).toHaveBeenNthCalledWith(2, 'PATCH', '/api/items/99', {
      title: 'Updated',
    });
  });

  it('update_item treats projectId-only as no_patch_fields (lookup is not a patch)', async () => {
    const client = { request: vi.fn() };
    const result = await createToolHandlers(client as HttpClient).update_item({
      number: 8,
      projectId: 1,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: 'no_patch_fields' });
    expect(client.request).not.toHaveBeenCalled();
  });

  it('update_item identity_mismatch when get id is missing', async () => {
    const client = {
      request: vi.fn(async () => ({
        ok: true,
        status: 200,
        data: { number: 8, projectId: 1 },
      })),
    };
    const result = await createToolHandlers(client as HttpClient).update_item({
      number: 8,
      title: 'x',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: 'identity_mismatch' });
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it('update_item identity_mismatch when PATCH response id changes', async () => {
    const client = {
      request: vi.fn(async (method: string) => {
        if (method === 'GET') {
          return { ok: true, status: 200, data: { id: 99, number: 8, projectId: 1 } };
        }
        return { ok: true, status: 200, data: { id: 100, number: 8, projectId: 1 } };
      }),
    };
    const result = await createToolHandlers(client as HttpClient).update_item({
      number: 8,
      title: 'x',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: 'identity_mismatch' });
  });
});

describe('safeTool', () => {
  it('maps thrown errors to internal_error without leaking messages', async () => {
    const result = await safeTool(async () => {
      throw new Error('secret-token-in-message');
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: 'internal_error' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});

