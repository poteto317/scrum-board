import { describe, expect, it } from 'vitest';
import { SPRINT_GOAL_MAX_SCALARS } from './models';
import { validateSprintMetaForSave } from './sprint-meta';

describe('sprint-meta', () => {
  it('validateSprintMetaForSave rejects long goal and bad dates', () => {
    expect(validateSprintMetaForSave('ok', '', '2026-01-01', '2026-01-02')).toBe('');
    expect(validateSprintMetaForSave('', '', '2026-01-01', '2026-01-02')).toContain('名称');
    expect(
      validateSprintMetaForSave('ok', 'あ'.repeat(SPRINT_GOAL_MAX_SCALARS + 1), '2026-01-01', '2026-01-02'),
    ).toContain(String(SPRINT_GOAL_MAX_SCALARS));
    expect(validateSprintMetaForSave('ok', '', '2026-02-01', '2026-01-01')).toContain('開始日');
  });
});