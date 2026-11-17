/** Local wall-clock parts for the due-at picker (month 1–12). */
export type DueAtLocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

/** Local display `YYYY/MM/DD HH:mm`; empty when unset/invalid. */
export function formatDueAtLocal(iso: string | null | undefined): string {
  const date = parseDueAt(iso);
  if (!date) return '';
  const p = toLocalParts(date);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}/${pad(p.month)}/${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** Format an Instant as UTC `…Z` with seconds always `00`. */
export function formatDueAtUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}:00Z`;
}

/** Parse a stored dueAt ISO string; invalid/empty → null. */
export function parseDueAt(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function toLocalParts(date: Date): DueAtLocalParts {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

/**
 * Build a Date from local parts. Invalid calendar days clamp to the month's last day.
 * Non-existent DST wall times follow the host Date normalization.
 */
export function fromLocalParts(parts: DueAtLocalParts): Date {
  const daysInMonth = new Date(parts.year, parts.month, 0).getDate();
  const day = Math.min(Math.max(parts.day, 1), daysInMonth);
  return new Date(parts.year, parts.month - 1, day, parts.hour, parts.minute, 0, 0);
}

/** Copy of local wall time with seconds/ms cleared (does not mutate input). */
export function truncateLocalToMinute(date: Date): Date {
  const next = new Date(date.getTime());
  next.setSeconds(0, 0);
  return next;
}
