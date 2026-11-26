import { describe, expect, it } from 'vitest';
import { errorMessage, isNotFound } from './api-error';
describe('API error presentation', () => {
  it('preserves the server message and falls back for disconnected requests', () => {
    expect(errorMessage({ error: { message: '同じ名前の列がすでにあります。' } })).toBe(
      '同じ名前の列がすでにあります。',
    );
    expect(errorMessage({ status: 0 })).toContain('通信に失敗');
    expect(errorMessage(null)).toContain('通信に失敗');
  });

  it('tells a 404 response from every other failure', () => {
    expect(isNotFound({ status: 404 })).toBe(true);
    expect(isNotFound({ status: 404, error: { message: '会話が見つかりません。' } })).toBe(true);
    expect(isNotFound({ status: 500 })).toBe(false);
    expect(isNotFound({ status: 0 })).toBe(false);
    expect(isNotFound({ status: '404' })).toBe(false);
    expect(isNotFound(null)).toBe(false);
    expect(isNotFound(undefined)).toBe(false);
    expect(isNotFound(new Error('x'))).toBe(false);
  });
});
