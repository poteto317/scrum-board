import { normalizeBoardData, NormalizedBoardData } from './board-data';
import { BoardData } from './models';

export type { NormalizedBoardData };

/** Board mobile 1-column mode breakpoint; keep in sync with board.css `@media (max-width: 700px)`. */
export const BOARD_MOBILE_MAX_PX = 700;

export function boardMobileMediaQuery(): string {
  return `(max-width: ${BOARD_MOBILE_MAX_PX}px)`;
}

export type MobileColumnRef = { id: number; name: string; position: number };

export function fallbackMobileColumnId(columns: MobileColumnRef[]): number {
  const todo = columns.find((c) => c.name === 'Todo');
  if (todo) return todo.id;
  if (!columns.length) return 0;
  return [...columns].sort((a, b) => a.position - b.position || a.id - b.id)[0].id;
}

export function resolveMobileColumnId(
  saved: unknown,
  columns: MobileColumnRef[],
): number {
  const n = typeof saved === 'number' && Number.isFinite(saved) ? Math.trunc(saved) : NaN;
  if (n > 0 && columns.some((c) => c.id === n)) return n;
  return fallbackMobileColumnId(columns);
}

/** normalizeBoardData + resolve mobileBoardColumnId（load/poll/settings マージの共通入口）. */
export function applyBoardMobileSettings(
  raw: Partial<BoardData> | NormalizedBoardData | null | undefined,
): NormalizedBoardData {
  const normalized = normalizeBoardData(raw);
  return withResolvedMobileColumnId(normalized);
}

/** 既に正規化済みのボードに mobile 列 ID のフォールバックだけ適用（ローカル状態更新用）. */
export function withResolvedMobileColumnId(data: NormalizedBoardData): NormalizedBoardData {
  const mobileBoardColumnId = resolveMobileColumnId(
    data.settings.mobileBoardColumnId,
    data.columns,
  );
  if (data.settings.mobileBoardColumnId === mobileBoardColumnId) return data;
  return {
    ...data,
    settings: { ...data.settings, mobileBoardColumnId },
  };
}

export function visibleMobileColumns<T extends MobileColumnRef>(
  columns: T[],
  isMobile: boolean,
  selectedId: number,
): T[] {
  if (!isMobile) return columns;
  const col = columns.find((c) => c.id === selectedId);
  return col ? [col] : [];
}
