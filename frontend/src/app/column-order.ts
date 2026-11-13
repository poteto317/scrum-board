import { Column } from './models';

export interface ColumnBound {
  left: number;
  width: number;
}

const AUTO_SCROLL_EDGE_PX = 48;
const AUTO_SCROLL_STEP_PX = 16;

export function computeDropSlot(clientX: number, columnBounds: readonly ColumnBound[]): number {
  for (let i = 0; i < columnBounds.length; i++) {
    const bound = columnBounds[i];
    if (clientX < bound.left + bound.width / 2) {
      return i;
    }
  }
  return columnBounds.length;
}

export function targetColumnIndex(
  fromIndex: number,
  dropSlot: number,
  length: number,
): number | null {
  if (fromIndex < 0 || fromIndex >= length || dropSlot < 0 || dropSlot > length) {
    return null;
  }
  const insertAt = dropSlot > fromIndex ? dropSlot - 1 : dropSlot;
  return insertAt === fromIndex ? null : insertAt;
}

export function moveColumn(
  columns: readonly Column[],
  fromIndex: number,
  toIndex: number,
): Column[] {
  if (
    fromIndex < 0 ||
    fromIndex >= columns.length ||
    toIndex < 0 ||
    toIndex >= columns.length ||
    fromIndex === toIndex
  ) {
    return columns as Column[];
  }
  const next = [...columns];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next.map((column, index) => ({ ...column, position: index }));
}

export function computeAutoScrollDelta(
  clientX: number,
  containerLeft: number,
  containerRight: number,
): number {
  if (containerRight <= containerLeft) return 0;
  if (clientX < containerLeft + AUTO_SCROLL_EDGE_PX) return -AUTO_SCROLL_STEP_PX;
  if (clientX > containerRight - AUTO_SCROLL_EDGE_PX) return AUTO_SCROLL_STEP_PX;
  return 0;
}
