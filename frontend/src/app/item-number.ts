/** Public display id for a backlog item, e.g. ITEM-003. */
export function formatItemNumber(number: number): string {
  return `ITEM-${Number(number).toString().padStart(3, '0')}`;
}
