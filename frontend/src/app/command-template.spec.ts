import { describe, it, expect } from 'vitest';
import {
  COMMAND_MENU_EMPTY,
  COPY_COMMAND_FAILURE,
  COPY_COMMAND_SUCCESS,
  resolveCommand,
} from './command-template';

describe('resolveCommand', () => {
  it('replaces every {{url}} and leaves other placeholders', () => {
    expect(resolveCommand('open {{url}} then {{url}}', 'http://x/cards/1')).toBe(
      'open http://x/cards/1 then http://x/cards/1',
    );
    expect(resolveCommand('keep {{x}} and {{URL}}', 'http://u')).toBe('keep {{x}} and {{URL}}');
    expect(resolveCommand('no placeholder', 'http://u')).toBe('no placeholder');
  });

  it('exports the empty-menu and copy messages', () => {
    expect(COMMAND_MENU_EMPTY).toBe('コマンドが未登録です。詳細画面で追加できます。');
    expect(COPY_COMMAND_SUCCESS).toBe('コマンドをコピーしました');
    expect(COPY_COMMAND_FAILURE).toBe('コマンドをコピーできませんでした');
  });
});
