import {
  BoardData,
  BoardSettings,
  CardLayout,
  Item,
} from './models';

export type { BoardData, BoardSettings, CardLayout, Item };

export function normalizeCardLayout(value: unknown): CardLayout {
  return value === 'free' ? 'free' : 'pack';
}

/** Inclusive max for free-layout offsetY (CSS px); must match backend MaxOffsetY. */
export const MAX_OFFSET_Y = 100_000;

/** Clamp offsetY to [0, MAX_OFFSET_Y] (truncates non-integers; non-finite → 0). */
export function clampOffsetY(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.trunc(value);
    if (n < 0) return 0;
    if (n > MAX_OFFSET_Y) return MAX_OFFSET_Y;
    return n;
  }
  return 0;
}

export function normalizeOffsetY(value: unknown): number {
  return clampOffsetY(value);
}

export function normalizeItem(raw: Partial<Item> & Pick<Item, 'id'>): Item {
  return {
    number: raw.number ?? 0,
    id: raw.id,
    columnId: raw.columnId ?? 0,
    title: raw.title ?? '',
    description: raw.description ?? '',
    position: raw.position ?? 0,
    backlogPosition: raw.backlogPosition ?? 0,
    projectId: normalizeOptionalInt(raw.projectId) ?? 0,
    offsetY: normalizeOffsetY(raw.offsetY),
    prUrls: raw.prUrls ?? [],
    relatedItems: raw.relatedItems ?? [],
    assignee: raw.assignee ?? '',
    closeReason: raw.closeReason ?? '',
    dueAt: raw.dueAt ? raw.dueAt : null,
    createdAt: raw.createdAt ?? '',
    updatedAt: raw.updatedAt ?? '',
  };
}

export type NormalizedBoardData = BoardData & { settings: BoardSettings; items: Item[] };

/** API / poll 応答を FE 用に正規化。settings・offsetY 欠落時は pack / 0（要件 6）。 */
function normalizeOptionalInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  return undefined;
}

export function normalizeBoardData(raw: Partial<BoardData> | null | undefined): NormalizedBoardData {
  const settingsRaw: BoardSettings =
    raw?.settings && typeof raw.settings === 'object'
      ? {
          ...raw.settings,
          cardLayout: normalizeCardLayout(raw.settings.cardLayout),
          mobileBoardColumnId: normalizeOptionalInt(raw.settings.mobileBoardColumnId),
          activeProjectId: normalizeOptionalInt(raw.settings.activeProjectId),
        }
      : { cardLayout: 'pack' };
  if (settingsRaw.mobileBoardColumnId === undefined) {
    delete settingsRaw.mobileBoardColumnId;
  }
  if (settingsRaw.activeProjectId === undefined) {
    delete settingsRaw.activeProjectId;
  }
  return {
    columns: raw?.columns ? [...raw.columns] : [],
    items: (raw?.items ?? []).map((item) => normalizeItem(item)),
    settings: settingsRaw,
  };
}
