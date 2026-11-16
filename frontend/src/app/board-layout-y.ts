import { Item } from './models';

/** Empty / free-layout floor for `.card-list` min-height (matches CSS). */
export const CARD_LIST_MIN_HEIGHT_PX = 72;

export type ComputeFreeOffsetYInput = {
  listTop: number;
  pointerY: number;
  grabOffsetY: number;
  scrollTop: number;
};

/**
 * 自由配置のカード上端 Y（列リスト上端・スクロール込み、整数 px）。
 * プレビューと drop 確定で同じ入力から求める（L-612）。`< 0` は 0 にクランプ。
 */
export function computeFreeOffsetY(input: ComputeFreeOffsetYInput): number {
  const raw = input.pointerY - input.grabOffsetY - input.listTop + input.scrollTop;
  const rounded = Math.round(raw);
  return rounded < 0 ? 0 : rounded;
}

/** pack→free 切替時: カード上端の list 相対 Y（整数、`< 0` → 0）。 */
export function measureCardOffsetY(listRectTop: number, cardRectTop: number, scrollTop: number): number {
  const raw = Math.round(cardRectTop - listRectTop + scrollTop);
  return raw < 0 ? 0 : raw;
}

export function pointerClientY(event: MouseEvent | TouchEvent): number | null {
  if (typeof TouchEvent !== 'undefined' && event instanceof TouchEvent) {
    const touch = event.touches[0] ?? event.changedTouches[0];
    return touch ? touch.clientY : null;
  }
  if (typeof MouseEvent !== 'undefined' && event instanceof MouseEvent) {
    return event.clientY;
  }
  // jsdom / synthetic events may not be real MouseEvent instances.
  const anyEvent = event as { clientY?: number; touches?: ArrayLike<{ clientY: number }>; changedTouches?: ArrayLike<{ clientY: number }> };
  if (typeof anyEvent.clientY === 'number') return anyEvent.clientY;
  const touch = anyEvent.touches?.[0] ?? anyEvent.changedTouches?.[0];
  return touch ? touch.clientY : null;
}

/** When a card's measured height is unknown (jsdom / first paint), estimate with this px. */
export const FREE_CARD_FALLBACK_HEIGHT_PX = 120;

/** free 列の min-height: max(72, 各カード offsetY + 高さ)。ドラッグ preview は含めない想定。 */
export function freeListMinHeightPx(
  cards: readonly Item[],
  heightById: ReadonlyMap<number, number>,
  fallbackHeight = FREE_CARD_FALLBACK_HEIGHT_PX,
): number {
  let maxBottom = 0;
  for (const card of cards) {
    const h = heightById.get(card.id) ?? fallbackHeight;
    maxBottom = Math.max(maxBottom, card.offsetY + h);
  }
  return Math.max(CARD_LIST_MIN_HEIGHT_PX, maxBottom);
}
