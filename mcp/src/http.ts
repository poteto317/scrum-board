import type { Config } from './config.js';

export type ApiOk<T> = { ok: true; status: number; data: T };
export type ApiErr = { ok: false; status: number | null; reason: string };

export type HttpClient = {
  request<T>(method: string, path: string, body?: unknown): Promise<ApiOk<T> | ApiErr>;
};

export function createHttpClient(config: Config): HttpClient {
  return {
    async request<T>(method: string, path: string, body?: unknown): Promise<ApiOk<T> | ApiErr> {
      const headers: Record<string, string> = {};
      if (config.authHeader) {
        headers.Authorization = config.authHeader;
      }
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }

      let response: Response;
      try {
        response = await fetch(`${config.baseUrl}${path}`, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
      } catch {
        return { ok: false, status: null, reason: 'network_error' };
      }

      if (response.status < 200 || response.status >= 300) {
        return { ok: false, status: response.status, reason: `HTTP ${response.status}` };
      }

      try {
        const data = (await response.json()) as T;
        return { ok: true, status: response.status, data };
      } catch {
        return { ok: false, status: response.status, reason: 'invalid_json' };
      }
    },
  };
}
