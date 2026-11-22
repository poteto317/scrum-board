import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const keys = ['SCRUM_BOARD_BASE_URL', 'SCRUM_BOARD_AUTH_USER', 'SCRUM_BOARD_AUTH_PASSWORD'] as const;

afterEach(() => {
  for (const k of keys) delete process.env[k];
});

describe('loadConfig', () => {
  it('defaults baseUrl and strips trailing slash', () => {
    process.env.SCRUM_BOARD_BASE_URL = 'http://example.test/board/';
    expect(loadConfig().baseUrl).toBe('http://example.test/board');
  });

  it('builds Basic auth only when both user and password are set', () => {
    process.env.SCRUM_BOARD_AUTH_USER = 'u';
    process.env.SCRUM_BOARD_AUTH_PASSWORD = 'p';
    const h = loadConfig().authHeader;
    expect(h).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`);
  });

  it('omits auth when only user is set', () => {
    process.env.SCRUM_BOARD_AUTH_USER = 'u';
    expect(loadConfig().authHeader).toBeNull();
  });

  it('rejects non-http(s) base URLs', () => {
    process.env.SCRUM_BOARD_BASE_URL = 'file:///etc/passwd';
    expect(() => loadConfig()).toThrow('invalid_base_url');
  });

  it('rejects Basic auth over http to non-loopback hosts', () => {
    process.env.SCRUM_BOARD_BASE_URL = 'http://evil.example/board';
    process.env.SCRUM_BOARD_AUTH_USER = 'u';
    process.env.SCRUM_BOARD_AUTH_PASSWORD = 'p';
    expect(() => loadConfig()).toThrow('insecure_auth_transport');
  });

  it('allows Basic auth over http to loopback hosts', () => {
    process.env.SCRUM_BOARD_AUTH_USER = 'u';
    process.env.SCRUM_BOARD_AUTH_PASSWORD = 'p';
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
      process.env.SCRUM_BOARD_BASE_URL = `http://${host}:4200`;
      expect(loadConfig().authHeader).toContain('Basic ');
    }
  });

  it('allows Basic auth over https to remote hosts', () => {
    process.env.SCRUM_BOARD_BASE_URL = 'https://scrum-board.example.run.app';
    process.env.SCRUM_BOARD_AUTH_USER = 'u';
    process.env.SCRUM_BOARD_AUTH_PASSWORD = 'p';
    expect(loadConfig().authHeader).toContain('Basic ');
  });
});
