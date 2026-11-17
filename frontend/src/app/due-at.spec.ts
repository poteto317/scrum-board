import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatDueAtLocal,
  formatDueAtUtc,
  fromLocalParts,
  parseDueAt,
  toLocalParts,
  truncateLocalToMinute,
} from './due-at';
import { wheelIndex } from './due-at-picker';
import { clampDueAtPartsToYearRange, dueAtYearOptions } from './due-at-year';

describe('due-at helpers', () => {
  it('formats local display as YYYY/MM/DD HH:mm', () => {
    const utc = formatDueAtUtc(fromLocalParts({ year: 2026, month: 11, day: 17, hour: 17, minute: 30 }));
    expect(formatDueAtLocal(utc)).toBe('2026/11/17 17:30');
    expect(formatDueAtLocal(null)).toBe('');
  });

  it('lists years from currentYear-1 through currentYear+5', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 1));
    expect(dueAtYearOptions()).toEqual([2025, 2026, 2027, 2028, 2029, 2030, 2031]);
    vi.useRealTimers();
  });

  it('clamps out-of-range years into picker options', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 1));
    expect(
      clampDueAtPartsToYearRange({ year: 1999, month: 6, day: 15, hour: 10, minute: 0 }),
    ).toMatchObject({ year: 2025 });
    expect(
      clampDueAtPartsToYearRange({ year: 2099, month: 6, day: 15, hour: 10, minute: 0 }),
    ).toMatchObject({ year: 2031 });
    vi.useRealTimers();
  });

  it('round-trips local parts through UTC at minute precision', () => {
    const local = fromLocalParts({ year: 2026, month: 11, day: 17, hour: 17, minute: 30 });
    const utc = formatDueAtUtc(local);
    expect(utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/);
    const again = toLocalParts(parseDueAt(utc)!);
    expect(again).toEqual({
      year: local.getFullYear(),
      month: local.getMonth() + 1,
      day: local.getDate(),
      hour: local.getHours(),
      minute: local.getMinutes(),
    });
  });

  it('clamps calendar end-of-month (Feb 31 → last day of Feb)', () => {
    const date = fromLocalParts({ year: 2026, month: 2, day: 31, hour: 12, minute: 0 });
    const parts = toLocalParts(date);
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(2);
    expect(parts.day).toBe(28);
    expect(parts.hour).toBe(12);
    expect(parts.minute).toBe(0);
  });

  it('truncateLocalToMinute clears seconds without mutating input', () => {
    const raw = new Date(2026, 10, 17, 17, 45, 30, 500);
    const truncated = truncateLocalToMinute(raw);
    expect(truncated.getSeconds()).toBe(0);
    expect(truncated.getMilliseconds()).toBe(0);
    expect(raw.getSeconds()).toBe(30);
  });

  it('wheelIndex clamps scroll position into option range', () => {
    expect(wheelIndex(0, 40, 7)).toBe(0);
    expect(wheelIndex(80, 40, 7)).toBe(2);
    expect(wheelIndex(9999, 40, 7)).toBe(6);
    expect(wheelIndex(10, 0, 7)).toBe(0);
  });
});

describe('due-at DST spring-forward (America/New_York)', () => {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const previousTz = env?.['TZ'];

  beforeEach(() => {
    if (env) env['TZ'] = 'America/New_York';
  });

  afterEach(() => {
    if (!env) return;
    if (previousTz === undefined) delete env['TZ'];
    else env['TZ'] = previousTz;
  });

  it('normalizes skipped local wall time and round-trips at minute precision', () => {
    // 2026-03-08 02:30 never exists in America/New_York (springs forward 02:00 → 03:00).
    const normalized = fromLocalParts({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 });
    if (env?.['TZ'] === 'America/New_York') {
      expect(normalized.getHours()).not.toBe(2);
    }
    const utc = formatDueAtUtc(normalized);
    expect(utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00Z$/);
    const roundTrip = toLocalParts(parseDueAt(utc)!);
    expect(roundTrip).toEqual(toLocalParts(normalized));
    expect(roundTrip.minute).toBe(normalized.getMinutes());
  });
});
