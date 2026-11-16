export type BoardLoadState = 'loading' | 'failed' | 'ready';
export type IdleOrSaving = 'idle' | 'saving';
export type LayoutSwitchSeq = 'idle' | 'in progress';
export type ItemDraggingState = 'idle' | 'dragging';

export type CardLayoutToggleGateInput = {
  boardLoad: BoardLoadState;
  settingsSave: IdleOrSaving;
  itemReorder: IdleOrSaving;
  layoutSwitchSeq: LayoutSwitchSeq;
  itemDragging: ItemDraggingState;
};

export type CardLayoutToggleGateResult = {
  allowed: boolean;
  reason: string;
};

/** 要件 4 の直積表。allowed === false のとき reason は必ず非空（L-094, L-669）。 */
export function cardLayoutToggleGate(
  state: CardLayoutToggleGateInput,
): CardLayoutToggleGateResult {
  if (state.boardLoad === 'loading') {
    return { allowed: false, reason: 'ボードを読み込み中のため切り替えできません' };
  }
  if (state.boardLoad === 'failed') {
    return { allowed: false, reason: 'ボードの読み込みに失敗しているため切り替えできません' };
  }
  if (state.settingsSave === 'saving') {
    return { allowed: false, reason: '設定の保存中のため切り替えできません' };
  }
  if (state.itemReorder === 'saving') {
    return { allowed: false, reason: 'アイテムの並び替え保存中のため切り替えできません' };
  }
  if (state.layoutSwitchSeq === 'in progress') {
    return { allowed: false, reason: 'レイアウト切替の処理中のため切り替えできません' };
  }
  if (state.itemDragging === 'dragging') {
    return { allowed: false, reason: 'カードをドラッグ中のため切り替えできません' };
  }
  return { allowed: true, reason: '' };
}
