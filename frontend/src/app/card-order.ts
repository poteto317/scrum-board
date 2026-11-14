import { Card } from './models';

export const CARD_DRAG_THRESHOLD_PX = 8;

/** While a card is held at an edge, scroll once per this interval (a column drag's dragover repeats about as often). */
export const CARD_AUTO_SCROLL_INTERVAL_MS = 50;
/**
 * A finger must rest on a card this long before a move drags it. Cards fill most of the board, so
 * without the hold the first swipe over a card would start a drag (and cancel the scroll) instead of
 * scrolling the list or the board. A mouse drags at once.
 */
export const CARD_TOUCH_DRAG_DELAY_MS = 200;

export function dropListIdForColumn(columnId: number): string {
  return `card-list-${columnId}`;
}

/** Parses `card-list-<id>` from a CDK drop list element id. */
export function columnIdFromDropListId(listId: string): number | null {
  const match = /^card-list-(\d+)$/.exec(listId);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Returns null when indexes are out of range or the drop is a no-op. */
export function applyCardDrop(
  cards: readonly Card[],
  previousColumnId: number,
  currentColumnId: number,
  previousIndex: number,
  currentIndex: number,
): Card[] | null {
  const source = cards
    .filter((c) => c.columnId === previousColumnId)
    .slice()
    .sort((a, b) => a.position - b.position || a.id - b.id);
  if (previousIndex < 0 || previousIndex >= source.length) return null;

  if (previousColumnId === currentColumnId) {
    if (currentIndex < 0 || currentIndex >= source.length) return null;
    if (previousIndex === currentIndex) return null;
    const next = source.slice();
    const [moved] = next.splice(previousIndex, 1);
    next.splice(currentIndex, 0, moved);
    return replaceColumnCards(cards, previousColumnId, next);
  }

  const dest = cards
    .filter((c) => c.columnId === currentColumnId)
    .slice()
    .sort((a, b) => a.position - b.position || a.id - b.id);
  if (currentIndex < 0 || currentIndex > dest.length) return null;
  const moved = { ...source[previousIndex], columnId: currentColumnId };
  const nextSource = source.slice();
  nextSource.splice(previousIndex, 1);
  const nextDest = dest.slice();
  nextDest.splice(currentIndex, 0, moved);
  let next = replaceColumnCards(cards, previousColumnId, nextSource);
  next = replaceColumnCards(next, currentColumnId, nextDest);
  return next;
}

export function buildCardOrderPayload(
  cards: readonly Card[],
  columnIds: readonly number[],
): { columnId: number; cardIds: number[] }[] {
  return columnIds.map((columnId) => ({
    columnId,
    cardIds: cards
      .filter((c) => c.columnId === columnId)
      .slice()
      .sort((a, b) => a.position - b.position || a.id - b.id)
      .map((c) => c.id),
  }));
}

function replaceColumnCards(
  cards: readonly Card[],
  columnId: number,
  ordered: readonly Card[],
): Card[] {
  const others = cards.filter((c) => c.columnId !== columnId);
  const positioned = ordered.map((c, position) => ({ ...c, columnId, position }));
  return [...others, ...positioned];
}

export function affectedColumnIds(previousColumnId: number, currentColumnId: number): number[] {
  return previousColumnId === currentColumnId
    ? [currentColumnId]
    : [previousColumnId, currentColumnId];
}
