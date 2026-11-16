import { Item } from './models';

export const ITEM_DRAG_THRESHOLD_PX = 8;

/** While a card is held at an edge, scroll once per this interval (a column drag's dragover repeats about as often). */
export const ITEM_AUTO_SCROLL_INTERVAL_MS = 50;
/**
 * A finger must rest on a card's drag handle this long before a move drags it, so a quick swipe over the handle
 * scrolls the list or the board instead of starting a drag. A mouse drags from the handle once past the threshold.
 */
export const ITEM_TOUCH_DRAG_DELAY_MS = 200;

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
export function applyItemDrop(
  cards: readonly Item[],
  previousColumnId: number,
  currentColumnId: number,
  previousIndex: number,
  currentIndex: number,
): Item[] | null {
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
    return replaceColumnItems(cards, previousColumnId, next);
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
  let next = replaceColumnItems(cards, previousColumnId, nextSource);
  next = replaceColumnItems(next, currentColumnId, nextDest);
  return next;
}

export function buildItemOrderPayload(
  cards: readonly Item[],
  columnIds: readonly number[],
): { columnId: number; itemIds: number[] }[] {
  return columnIds.map((columnId) => ({
    columnId,
    itemIds: cards
      .filter((c) => c.columnId === columnId)
      .slice()
      .sort((a, b) => a.position - b.position || a.id - b.id)
      .map((c) => c.id),
  }));
}

function replaceColumnItems(
  cards: readonly Item[],
  columnId: number,
  ordered: readonly Item[],
): Item[] {
  const others = cards.filter((c) => c.columnId !== columnId);
  const positioned = ordered.map((c, position) => ({ ...c, columnId, position }));
  return [...others, ...positioned];
}

export function affectedColumnIds(previousColumnId: number, currentColumnId: number): number[] {
  return previousColumnId === currentColumnId
    ? [currentColumnId]
    : [previousColumnId, currentColumnId];
}
