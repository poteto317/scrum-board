import { describe, expect, it } from 'vitest';
import { errorMessage } from './api-error';
describe('API error presentation', () => {
  it('preserves the server message and falls back for disconnected requests', () => {
    expect(errorMessage({ error: { message: '同じ名前の列がすでにあります。' } })).toBe(
      '同じ名前の列がすでにあります。',
    );
    expect(errorMessage({ status: 0 })).toContain('通信に失敗');
    expect(errorMessage(null)).toContain('通信に失敗');
  });
});
