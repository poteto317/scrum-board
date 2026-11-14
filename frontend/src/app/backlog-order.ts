import { Card } from './models';

export interface RowBound {
  top: number;
  height: number;
}

const AUTO_SCROLL_EDGE_PX = 48;
const AUTO_SCROLL_STEP_PX = 16;

export function computeDropSlot(clientY: number, rowBounds: readonly RowBound[]): number {
  for (let i = 0; i < rowBounds.length; i++) {
    const bound = rowBounds[i];
    if (clientY < bound.top + bound.height / 2) {
      return i;
    }
  }
  return rowBounds.length;
}

export function targetIndex(fromIndex: number, dropSlot: number, length: number): number | null {
  if (fromIndex < 0 || fromIndex >= length || dropSlot < 0 || dropSlot > length) {
    return null;
  }
  const insertAt = dropSlot > fromIndex ? dropSlot - 1 : dropSlot;
  return insertAt === fromIndex ? null : insertAt;
}

export function moveCard(cards: readonly Card[], fromIndex: number, toIndex: number): Card[] {
  if (
    fromIndex < 0 ||
    fromIndex >= cards.length ||
    toIndex < 0 ||
    toIndex >= cards.length ||
    fromIndex === toIndex
  ) {
    return cards as Card[];
  }
  const next = [...cards];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next.map((card, index) => ({ ...card, backlogPosition: index }));
}

export function computeAutoScrollDelta(
  clientY: number,
  containerTop: number,
  containerBottom: number,
): number {
  if (containerBottom <= containerTop) return 0;
  if (clientY < containerTop + AUTO_SCROLL_EDGE_PX) return -AUTO_SCROLL_STEP_PX;
  if (clientY > containerBottom - AUTO_SCROLL_EDGE_PX) return AUTO_SCROLL_STEP_PX;
  return 0;
}
