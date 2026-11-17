import { DueAtLocalParts, fromLocalParts, toLocalParts } from './due-at';

/** Year options for the picker: currentYear−1 … currentYear+5. */
export function dueAtYearOptions(now = new Date()): number[] {
  const y = now.getFullYear();
  return Array.from({ length: 7 }, (_, i) => y - 1 + i);
}

/** Clamp year into dueAtYearOptions range (keeps other parts). */
export function clampDueAtPartsToYearRange(parts: DueAtLocalParts, now = new Date()): DueAtLocalParts {
  const years = dueAtYearOptions(now);
  const year = Math.min(Math.max(parts.year, years[0]), years[years.length - 1]);
  return toLocalParts(fromLocalParts({ ...parts, year }));
}
