/** 最下部付近とみなす余白（px） */
export const AI_CHAT_STICK_THRESHOLD_PX = 48;

export type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

/** スクロール位置が最下部から threshold 以内か */
export function isNearBottom(
  el: ScrollMetrics,
  threshold: number = AI_CHAT_STICK_THRESHOLD_PX,
): boolean {
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  return distance <= threshold;
}

/** 要素を最下部へスクロールする */
export function scrollElementToBottom(el: { scrollTop: number; scrollHeight: number }): void {
  el.scrollTop = el.scrollHeight;
}

/** loading / 読込失敗中は list が無い。stick していなければ予約しない */
export function canScheduleStickScroll(state: {
  loading: boolean;
  loadFailed: boolean;
  stickToBottom: boolean;
}): boolean {
  return !state.loading && !state.loadFailed && state.stickToBottom;
}
