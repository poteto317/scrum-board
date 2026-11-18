import { describe, expect, it, vi, afterEach } from 'vitest';
import { createHttpClient } from './http.js';

afterEach(() => vi.unstubAllGlobals());

describe('createHttpClient', () => {
  it('returns data on 2xx JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ id: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ));
    const client = createHttpClient({ baseUrl: 'http://x', authHeader: null });
    const res = await client.request<{ id: number }>('GET', '/api/projects');
    expect(res).toEqual({ ok: true, status: 200, data: { id: 1 } });
  });

  it('maps non-2xx to fixed reason without body text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('secret-token-in-body', { status: 401 }),
    ));
    const res = await createHttpClient({ baseUrl: 'http://x', authHeader: null })
      .request('GET', '/api/board');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('HTTP 401');
      expect(JSON.stringify(res)).not.toContain('secret');
    }
  });

  it('maps network failure to network_error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED secret'); }));
    const res = await createHttpClient({ baseUrl: 'http://x', authHeader: null })
      .request('GET', '/api/board');
    expect(res).toEqual({ ok: false, status: null, reason: 'network_error' });
  });

  it('maps 2xx non-JSON to invalid_json', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('not-json', { status: 200, headers: { 'content-type': 'text/plain' } }),
    ));
    const res = await createHttpClient({ baseUrl: 'http://x', authHeader: null })
      .request('GET', '/api/board');
    expect(res).toEqual({ ok: false, status: 200, reason: 'invalid_json' });
  });

  it('sends Authorization when configured', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await createHttpClient({ baseUrl: 'http://x', authHeader: 'Basic abc' })
      .request('GET', '/api/board');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Basic abc');
  });

  it('omits Authorization when authHeader is null', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await createHttpClient({ baseUrl: 'http://x', authHeader: null }).request('GET', '/api/board');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
