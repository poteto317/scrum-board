export interface Label {
  id: number;
  name: string;
  color: string;
}

export interface LabelInput {
  name: string;
  color: string;
}

export interface LabelPatch {
  name?: string;
  color?: string;
}

export type LabelCatalogChange =
  | { kind: 'updated'; label: Label }
  | { kind: 'deleted'; id: number };

/** Match backend MaxLabelNameRunes / MaxItemLabels. */
export const LABEL_NAME_MAX = 40;
export const MAX_ITEM_LABELS = 20;

export const LABEL_COLOR_PRESETS = [
  '#64748b',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
] as const;

export const DEFAULT_LABEL_COLOR = '#3b82f6';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isValidLabelColor(color: string): boolean {
  return HEX_COLOR_RE.test(color.trim());
}

/** Validate and normalize label creation/edit form input (pure). */
export function validateLabelInput(
  rawName: string,
  rawColor: string,
): { ok: true; value: LabelInput } | { ok: false; error: string } {
  const name = rawName.trim();
  if (!name || [...name].length > LABEL_NAME_MAX) {
    return { ok: false, error: `ラベル名は1〜${LABEL_NAME_MAX}文字で入力してください。` };
  }
  const color = rawColor.trim().toLowerCase();
  if (!isValidLabelColor(color)) {
    return { ok: false, error: '色は #rrggbb 形式で指定してください。' };
  }
  return { ok: true, value: { name, color } };
}

function normalizeLabelColorOrDefault(
  color: unknown,
  fallback: string = DEFAULT_LABEL_COLOR,
): string {
  if (typeof color === 'string') {
    const trimmed = color.trim();
    if (HEX_COLOR_RE.test(trimmed)) {
      return trimmed.toLowerCase();
    }
  }
  return fallback;
}

export function normalizeLabel(raw: Partial<Label> | null | undefined): Label | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'number' && Number.isFinite(raw.id) ? Math.trunc(raw.id) : 0;
  if (id <= 0) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;
  const color = normalizeLabelColorOrDefault(raw.color, '#64748b');
  return { id, name, color };
}

/** Normalize labels array into id ASC sorted, de-duplicated Label[]. */
export function normalizeLabels(
  raw: readonly (Partial<Label> | null | undefined)[] | null | undefined,
): Label[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: Label[] = [];
  for (const entry of raw) {
    const normalized = normalizeLabel(entry);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    out.push(normalized);
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

/** Compute inline CSS custom properties for accessible label badges. */
export function labelBadgeVars(color: string): Record<string, string> {
  const safe = normalizeLabelColorOrDefault(color, '#64748b');
  const r = Number.parseInt(safe.slice(1, 3), 16);
  const g = Number.parseInt(safe.slice(3, 5), 16);
  const b = Number.parseInt(safe.slice(5, 7), 16);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const factor = lum > 110 ? 110 / lum : 0.78;
  const hex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n * factor)))
      .toString(16)
      .padStart(2, '0');
  const ink = `#${hex(r)}${hex(g)}${hex(b)}`;
  return {
    '--label-color': safe,
    '--label-bg': `rgba(${r}, ${g}, ${b}, 0.13)`,
    '--label-border': `rgba(${r}, ${g}, ${b}, 0.36)`,
    '--label-ink': ink,
  };
}

/** Apply a workspace label update/delete to items immutably; keeps references when untouched. */
export function applyLabelCatalogChangeToItems<T extends { labels?: Label[] }>(
  items: readonly T[],
  change: LabelCatalogChange,
): { items: T[]; changed: boolean } {
  let changed = false;
  const next = items.map((item) => {
    if (!item.labels?.length) return item;
    if (change.kind === 'updated') {
      if (!item.labels.some((l) => l.id === change.label.id)) return item;
      changed = true;
      return {
        ...item,
        labels: item.labels.map((l) => (l.id === change.label.id ? { ...change.label } : l)),
      };
    }
    if (!item.labels.some((l) => l.id === change.id)) return item;
    changed = true;
    return { ...item, labels: item.labels.filter((l) => l.id !== change.id) };
  });
  return { items: changed ? next : (items as T[]), changed };
}
