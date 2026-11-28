import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LABEL_COLOR,
  LABEL_COLOR_PRESETS,
  applyLabelCatalogChangeToItems,
  isValidLabelColor,
  labelBadgeVars,
  normalizeLabel,
  normalizeLabels,
  validateLabelInput,
} from './label';

describe('label helpers', () => {
  it('exposes 9 preset colors', () => {
    expect(LABEL_COLOR_PRESETS).toHaveLength(9);
    for (const c of LABEL_COLOR_PRESETS) {
      expect(isValidLabelColor(c)).toBe(true);
    }
    expect(isValidLabelColor('#ABCDEF')).toBe(true);
    expect(isValidLabelColor('#fff')).toBe(false);
    expect(isValidLabelColor('3b82f6')).toBe(false);
  });

  it('normalizes and sorts labels by id ASC without duplicates', () => {
    expect(normalizeLabels(undefined)).toEqual([]);
    expect(normalizeLabels(null)).toEqual([]);
    const out = normalizeLabels([
      { id: 5, name: ' API ', color: '#3B82F6' },
      { id: 2, name: 'Bug', color: '#EF4444' },
      { id: 5, name: 'Duplicate', color: '#000000' },
      { id: 0, name: 'bad', color: '#000000' },
      { id: 3, name: '   ', color: '#000000' },
      { id: 4, name: 'Fallback', color: 'invalid' },
    ]);
    expect(out).toEqual([
      { id: 2, name: 'Bug', color: '#ef4444' },
      { id: 4, name: 'Fallback', color: '#64748b' },
      { id: 5, name: 'API', color: '#3b82f6' },
    ]);
  });

  it('rejects missing id/name in normalizeLabel', () => {
    expect(normalizeLabel(null)).toBeNull();
    expect(normalizeLabel({ id: -1, name: 'x', color: DEFAULT_LABEL_COLOR })).toBeNull();
  });

  it('builds CSS custom properties with darkened high-contrast ink', () => {
    const yellow = labelBadgeVars('#eab308');
    expect(yellow['--label-color']).toBe('#eab308');
    expect(yellow['--label-bg']).toContain('rgba(234, 179, 8');
    expect(yellow['--label-ink']).toMatch(/^#[0-9a-f]{6}$/);
    expect(labelBadgeVars('invalid')['--label-color']).toBe('#64748b');
  });

  it('applies label catalog updates/deletions without mutating untouched items', () => {
    const first = { id: 1, labels: [{ id: 10, name: 'Bug', color: '#ef4444' }] };
    const second = { id: 2, labels: [{ id: 20, name: 'Docs', color: '#3b82f6' }] };
    const list = [first, second];

    const noop = applyLabelCatalogChangeToItems(list, {
      kind: 'updated',
      label: { id: 99, name: 'Other', color: '#22c55e' },
    });
    expect(noop.changed).toBe(false);
    expect(noop.items).toBe(list);

    const updated = applyLabelCatalogChangeToItems(list, {
      kind: 'updated',
      label: { id: 10, name: 'Fix', color: '#22c55e' },
    });
    expect(updated.changed).toBe(true);
    expect(updated.items[0].labels).toEqual([{ id: 10, name: 'Fix', color: '#22c55e' }]);
    expect(updated.items[1]).toBe(second);

    const deleted = applyLabelCatalogChangeToItems(updated.items, { kind: 'deleted', id: 20 });
    expect(deleted.changed).toBe(true);
    expect(deleted.items[1].labels).toEqual([]);
  });

  it('validates and normalizes label name and hex color', () => {
    expect(validateLabelInput('  Feature ', '#3B82F6')).toEqual({
      ok: true,
      value: { name: 'Feature', color: '#3b82f6' },
    });
    expect(validateLabelInput('   ', '#3b82f6').ok).toBe(false);
    expect(validateLabelInput('a'.repeat(41), '#3b82f6').ok).toBe(false);
    expect(validateLabelInput('Bug', 'red').ok).toBe(false);
  });
});
