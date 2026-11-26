import { describe, expect, it } from 'vitest';
import { diffLines, MAX_DIFF_CELLS } from './project-ai-proposal-diff';

const show = (before: string, after: string) =>
  diffLines(before, after).map((l) => `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`);

describe('diffLines', () => {
  it('marks nothing when the texts are the same', () => {
    expect(show('a\nb', 'a\nb')).toEqual([' a', ' b']);
  });

  it('shows added and removed lines in place', () => {
    expect(show('a\nb\nc', 'a\nc\nd')).toEqual([' a', '-b', ' c', '+d']);
  });

  it('shows a replaced line as removed then added', () => {
    expect(show('目的\n古い手順\n期限', '目的\n新しい手順\n期限')).toEqual([' 目的', '-古い手順', '+新しい手順', ' 期限']);
  });

  it('treats an empty text as no lines', () => {
    expect(show('', 'x\ny')).toEqual(['+x', '+y']);
    expect(show('x', '')).toEqual(['-x']);
    expect(show('', '')).toEqual([]);
  });

  it('compares CRLF and LF lines as the same', () => {
    expect(show('a\r\nb', 'a\nb')).toEqual([' a', ' b']);
  });

  it('replaces the whole text when the table would be too large', () => {
    const big = Array.from({ length: Math.ceil(Math.sqrt(MAX_DIFF_CELLS)) + 1 }, (_, i) => `l${i}`).join('\n');
    const out = diffLines(big, `${big}\nend`);
    expect(out.every((l) => l.kind !== 'same')).toBe(true);
    expect(out.at(-1)).toEqual({ kind: 'add', text: 'end' });
  });
});
