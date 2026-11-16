import { clampOffsetY } from './board-data';
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

function sortPack(a: Item, b: Item): number {
  return a.position - b.position || a.id - b.id;
}

function sortFree(a: Item, b: Item): number {
  return (a.offsetY ?? 0) - (b.offsetY ?? 0) || a.position - b.position || a.id - b.id;
}

export function sortColumnItems(cards: readonly Item[], free: boolean): Item[] {
  return cards.slice().sort(free ? sortFree : sortPack);
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
    .sort(sortPack);
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
    .sort(sortPack);
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

/**
 * free レイアウトの drop: 列間は offsetY 維持、同列は nextOffsetY。
 * 影響列を offsetY 順に position 振り直し。変化が無ければ null。
 */
export function applyFreeItemDrop(
  cards: readonly Item[],
  previousColumnId: number,
  currentColumnId: number,
  itemId: number,
  nextOffsetY: number,
): Item[] | null {
  const moved = cards.find((c) => c.id === itemId);
  if (!moved || moved.columnId !== previousColumnId) return null;
  const offsetY = clampOffsetY(nextOffsetY);
  if (previousColumnId === currentColumnId && (moved.offsetY ?? 0) === offsetY) return null;

  const without = cards.filter((c) => c.id !== itemId);
  const placed: Item = { ...moved, columnId: currentColumnId, offsetY };
  const next = [...without, placed];
  const columnIds =
    previousColumnId === currentColumnId
      ? [currentColumnId]
      : [previousColumnId, currentColumnId];
  return reassignPositionsByOffsetY(next, columnIds);
}

export function reassignPositionsByOffsetY(
  cards: readonly Item[],
  columnIds: readonly number[],
): Item[] {
  let next = [...cards];
  for (const columnId of columnIds) {
    const ordered = next
      .filter((c) => c.columnId === columnId)
      .slice()
      .sort(sortFree);
    next = replaceColumnItems(next, columnId, ordered);
  }
  return next;
}

/** PUT /api/items/order column payload (canonical; api re-exports). */
export type ItemOrderColumn = {
  columnId: number;
  itemIds: number[];
  offsetYs?: number[];
};

export function buildItemOrderPayload(
  cards: readonly Item[],
  columnIds: readonly number[],
  options?: { includeOffsetYs?: boolean },
): ItemOrderColumn[] {
  const includeOffsetYs = options?.includeOffsetYs === true;
  return columnIds.map((columnId) => {
    const ordered = cards
      .filter((c) => c.columnId === columnId)
      .slice()
      .sort(sortPack);
    const payload: ItemOrderColumn = {
      columnId,
      itemIds: ordered.map((c) => c.id),
    };
    if (includeOffsetYs) {
      payload.offsetYs = ordered.map((c) => clampOffsetY(c.offsetY ?? 0));
    }
    return payload;
  });
}

/** 全列の itemIds + offsetYs（pack→free 計測後の一括 PUT）。 */
export function buildAllColumnsOffsetPayload(
  cards: readonly Item[],
  columnIds: readonly number[],
): ItemOrderColumn[] {
  return buildItemOrderPayload(cards, columnIds, { includeOffsetYs: true });
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
