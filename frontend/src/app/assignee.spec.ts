import { describe, it, expect } from 'vitest';
import { ASSIGNEE_PRESETS, assigneeKind, isAssigneePreset, validAssignee } from './assignee';

describe('assignee helpers', () => {
  it('lists the four presets matching backend PresetAssignees', () => {
    expect(ASSIGNEE_PRESETS).toEqual(['Cursor', 'Claude', 'Codex', 'Antigravity']);
  });
  it('detects presets and chip kinds', () => {
    expect(isAssigneePreset('Cursor')).toBe(true);
    expect(isAssigneePreset('mash')).toBe(false);
    expect(assigneeKind('Claude')).toBe('claude');
    expect(assigneeKind('mash')).toBe('custom');
  });
  it('accepts empty and rejects overlong or control characters', () => {
    expect(validAssignee('')).toBe(true);
    expect(validAssignee('  Claude  ')).toBe(true);
    expect(validAssignee('x'.repeat(60))).toBe(true);
    expect(validAssignee('x'.repeat(61))).toBe(false);
    expect(validAssignee('a\nb')).toBe(false);
    expect(validAssignee('x\u0085y')).toBe(false);
  });
});
