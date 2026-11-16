import { afterNextRender, DestroyRef, Injector } from '@angular/core';
import { clampOffsetY } from './board-data';
import { measureCardOffsetY } from './board-layout-y';
import { dropListIdForColumn } from './item-order';
import { Item } from './models';

/** pack→free: DOM 上のカード上端から id→offsetY を測る。 */
export function measurePackOffsets(
  root: HTMLElement | null | undefined,
  columns: readonly { id: number }[],
): Map<number, number> {
  const byId = new Map<number, number>();
  if (!root) return byId;
  for (const column of columns) {
    const listEl = root.querySelector<HTMLElement>(`#${dropListIdForColumn(column.id)}`);
    if (!listEl) continue;
    const listTop = listEl.getBoundingClientRect().top;
    const scrollTop = listEl.scrollTop;
    for (const cardEl of Array.from(
      listEl.querySelectorAll<HTMLElement>(':scope > .task-card[data-card-id]'),
    )) {
      if (cardEl.classList.contains('cdk-drag-preview')) continue;
      const id = Number(cardEl.getAttribute('data-card-id'));
      if (!Number.isSafeInteger(id)) continue;
      byId.set(id, measureCardOffsetY(listTop, cardEl.getBoundingClientRect().top, scrollTop));
    }
  }
  return byId;
}

/** 測定 Map を items の offsetY に反映（未測定は既存/0）。 */
export function applyMeasuredOffsets(items: readonly Item[], byId: Map<number, number>): Item[] {
  return items.map((item) => ({
    ...item,
    offsetY: clampOffsetY(byId.get(item.id) ?? item.offsetY ?? 0),
  }));
}

/** pack→free: DOM 上のカード上端から offsetY を測り items を返す。 */
export function measurePackOffsetsAsItems(
  root: HTMLElement | null | undefined,
  columns: readonly { id: number }[],
  items: readonly Item[],
): Item[] {
  return applyMeasuredOffsets(items, measurePackOffsets(root, columns));
}

export type ScheduleCardHeightMeasureDeps = {
  destroyRef: DestroyRef;
  injector: Injector;
  getRoot: () => HTMLElement | null | undefined;
  setHeights: (heights: Map<number, number>) => void;
};

/** 次フレームでカード高さを測り setHeights へ渡す。 */
export function scheduleCardHeightMeasure(deps: ScheduleCardHeightMeasureDeps): void {
  if (deps.destroyRef.destroyed) return;
  afterNextRender(
    () => {
      if (deps.destroyRef.destroyed) return;
      const root = deps.getRoot();
      if (!root) return;
      const next = new Map<number, number>();
      for (const cardEl of Array.from(root.querySelectorAll<HTMLElement>('.task-card[data-card-id]'))) {
        if (
          cardEl.classList.contains('cdk-drag-preview') ||
          cardEl.classList.contains('cdk-drag-placeholder')
        ) {
          continue;
        }
        const id = Number(cardEl.getAttribute('data-card-id'));
        if (!Number.isSafeInteger(id)) continue;
        next.set(id, cardEl.getBoundingClientRect().height);
      }
      deps.setHeights(next);
    },
    { injector: deps.injector },
  );
}
