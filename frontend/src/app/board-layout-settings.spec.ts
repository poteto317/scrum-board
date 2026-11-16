import { describe, expect, it } from 'vitest';
import {
  CardLayoutToggleGateInput,
  cardLayoutToggleGate,
} from './board-layout-settings';

const readyIdle: CardLayoutToggleGateInput = {
  boardLoad: 'ready',
  settingsSave: 'idle',
  itemReorder: 'idle',
  layoutSwitchSeq: 'idle',
  itemDragging: 'idle',
};

describe('cardLayoutToggleGate', () => {
  it('allows only when every gate input is idle/ready', () => {
    expect(cardLayoutToggleGate(readyIdle)).toEqual({ allowed: true, reason: '' });
  });

  it.each([
    [{ boardLoad: 'loading' as const }, 'ボードを読み込み中'],
    [{ boardLoad: 'failed' as const }, 'ボードの読み込みに失敗'],
    [{ settingsSave: 'saving' as const }, '設定の保存中'],
    [{ itemReorder: 'saving' as const }, '並び替え保存中'],
    [{ layoutSwitchSeq: 'in progress' as const }, 'レイアウト切替の処理中'],
    [{ itemDragging: 'dragging' as const }, 'ドラッグ中'],
  ])('blocks %# and returns a non-empty reason', (partial, reasonFragment) => {
    const result = cardLayoutToggleGate({ ...readyIdle, ...partial });
    expect(result.allowed).toBe(false);
    expect(result.reason.length).toBeGreaterThan(0);
    expect(result.reason).toContain(reasonFragment);
  });

  it('boardLoad loading/failed wins over other idle fields', () => {
    expect(
      cardLayoutToggleGate({
        ...readyIdle,
        boardLoad: 'loading',
        settingsSave: 'saving',
        itemDragging: 'dragging',
      }).allowed,
    ).toBe(false);
    expect(
      cardLayoutToggleGate({
        ...readyIdle,
        boardLoad: 'failed',
        itemReorder: 'saving',
      }).allowed,
    ).toBe(false);
  });
});
