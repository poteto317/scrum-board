import { DueAtLocalParts, fromLocalParts, toLocalParts } from './due-at';

/** Year options for the picker: currentYear−1 … currentYear+5 (+ optional existing year). */
export function dueAtYearOptions(now = new Date(), includeYear?: number): number[] {
  const y = now.getFullYear();
  const years = Array.from({ length: 7 }, (_, i) => y - 1 + i);
  if (includeYear != null && !years.includes(includeYear)) {
    years.push(includeYear);
    years.sort((a, b) => a - b);
  }
  return years;
}

/** Clamp year into the default picker range (keeps other parts). For “now” defaults only. */
export function clampDueAtPartsToYearRange(parts: DueAtLocalParts, now = new Date()): DueAtLocalParts {
  const years = dueAtYearOptions(now);
  const year = Math.min(Math.max(parts.year, years[0]), years[years.length - 1]);
  return toLocalParts(fromLocalParts({ ...parts, year }));
}
