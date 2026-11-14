/**
 * Preset assignee labels (case-insensitive match on the server).
 * Keep in sync with backend PresetAssignees (assignee.go).
 */
export const ASSIGNEE_PRESETS = ['Cursor', 'Claude', 'Codex', 'Antigravity'] as const;
export type AssigneePreset = (typeof ASSIGNEE_PRESETS)[number];

const MAX_ASSIGNEE_LENGTH = 60;

export function isAssigneePreset(value: string): value is AssigneePreset {
  return (ASSIGNEE_PRESETS as readonly string[]).includes(value);
}

/** CSS `data-assignee` token for chips (preset lowercased, else `custom`). */
export function assigneeKind(value: string): string {
  return isAssigneePreset(value) ? value.toLowerCase() : 'custom';
}

/** Cc controls (C0 + DEL + C1), aligned with Go unicode.IsControl for BMP. */
function hasControlChar(value: string): boolean {
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) return true;
  }
  return false;
}

/** Client-side check before PATCH. Empty string clears. */
export function validAssignee(raw: string): boolean {
  const value = raw.trim();
  if (!value) return true;
  return [...value].length <= MAX_ASSIGNEE_LENGTH && !hasControlChar(value);
}
