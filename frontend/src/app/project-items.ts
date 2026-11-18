import { Item } from './models';

/** Keep only cards belonging to the active project (hide stale cross-project rows). */
export function itemsForActiveProject(
  items: readonly Item[],
  activeId: number | null | undefined,
): Item[] {
  if (typeof activeId !== 'number' || !Number.isInteger(activeId) || activeId <= 0) {
    return [];
  }
  return items.filter((item) => item.projectId === activeId);
}
