export const LIST_RETURN_KEY = 'scrumboard:list-return';
export const BOARD_SCROLL_KEY = 'scrumboard:scroll:board';
export const BACKLOG_SCROLL_KEY = 'scrumboard:scroll:backlog';

export type ListReturnTo = '/' | '/backlog';
export type BoardScroll = { scrollY: number; scrollLeft: number };
export type BacklogScroll = { scrollTop: number; scrollLeft: number };

function storageOrSession(storage?: Storage): Storage {
  return storage ?? sessionStorage;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Parse a JSON object with two finite numeric fields, or null. */
function parseFinitePair<T extends Record<string, number>>(
  raw: string | null,
  keyA: keyof T & string,
  keyB: keyof T & string,
): T | null {
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    const a = record[keyA];
    const b = record[keyB];
    if (!isFiniteNumber(a) || !isFiniteNumber(b)) return null;
    return { [keyA]: a, [keyB]: b } as T;
  } catch {
    return null;
  }
}

export function parseBoardScroll(raw: string | null): BoardScroll | null {
  return parseFinitePair<BoardScroll>(raw, 'scrollY', 'scrollLeft');
}

export function parseBacklogScroll(raw: string | null): BacklogScroll | null {
  return parseFinitePair<BacklogScroll>(raw, 'scrollTop', 'scrollLeft');
}

export function parseReturnTo(raw: string | null): ListReturnTo | null {
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { returnTo } = parsed as Record<string, unknown>;
    if (returnTo === '/' || returnTo === '/backlog') return returnTo;
    return null;
  } catch {
    return null;
  }
}

export function readBoardScroll(storage?: Storage): BoardScroll | null {
  return parseBoardScroll(storageOrSession(storage).getItem(BOARD_SCROLL_KEY));
}

export function readBacklogScroll(storage?: Storage): BacklogScroll | null {
  return parseBacklogScroll(storageOrSession(storage).getItem(BACKLOG_SCROLL_KEY));
}

export function readReturnTo(storage?: Storage): ListReturnTo | null {
  return parseReturnTo(storageOrSession(storage).getItem(LIST_RETURN_KEY));
}

function trySetItem(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // QuotaExceeded / private mode — callers must still navigate.
  }
}

export function saveBoardScroll(scroll: BoardScroll, storage?: Storage): void {
  trySetItem(storageOrSession(storage), BOARD_SCROLL_KEY, JSON.stringify(scroll));
}

export function saveBacklogScroll(scroll: BacklogScroll, storage?: Storage): void {
  trySetItem(storageOrSession(storage), BACKLOG_SCROLL_KEY, JSON.stringify(scroll));
}

export function saveReturnTo(returnTo: ListReturnTo, storage?: Storage): void {
  trySetItem(storageOrSession(storage), LIST_RETURN_KEY, JSON.stringify({ returnTo }));
}

export function clearReturnTo(storage?: Storage): void {
  storageOrSession(storage).removeItem(LIST_RETURN_KEY);
}

export function clearBoardScroll(storage?: Storage): void {
  storageOrSession(storage).removeItem(BOARD_SCROLL_KEY);
}

export function clearBacklogScroll(storage?: Storage): void {
  storageOrSession(storage).removeItem(BACKLOG_SCROLL_KEY);
}
