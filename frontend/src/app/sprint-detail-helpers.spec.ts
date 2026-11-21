import { describe, expect, it } from 'vitest';
import type { UserPublic } from './auth';
import { Item, SPRINT_GOAL_MAX_SCALARS, Sprint } from './models';
import {
  buildSprintMemberCandidates,
  buildSprintMetaPatch,
  isSprintMetaDirty,
  sprintMetaDraftFromSprint,
  parseOptionalSprintVelocityInput,
  validateSprintCompleteVelocity,
  validateSprintGoalScalars,
  SPRINT_VELOCITY_INPUT_ERROR,
} from './sprint-detail-helpers';

const admin: UserPublic = {
  id: 1,
  loginName: 'admin',
  displayName: 'Admin',
  role: 'admin',
  disabled: false,
};

function sprint(partial: Partial<Sprint> & Pick<Sprint, 'id' | 'name' | 'status'>): Sprint {
  return {
    projectId: 1,
    goal: '',
    startDate: '2026-11-21',
    endDate: '2026-12-04',
    velocity: null,
    suggestedVelocity: 0,
    itemCount: 0,
    items: [],
    createdAt: '',
    updatedAt: '',
    ...partial,
  };
}

function item(partial: Partial<Item> & Pick<Item, 'id' | 'number' | 'title'>): Item {
  return {
    projectId: 1,
    columnId: 1,
    description: '',
    solution: '',
    position: 0,
    backlogPosition: 0,
    offsetY: 0,
    prUrls: [],
    relatedItems: [],
    assignee: '',
    closeReason: '',
    favorite: false,
    dueAt: null,
    createdAt: '',
    updatedAt: '',
    canEdit: true,
    ...partial,
  };
}

describe('sprint-detail-helpers', () => {
  it('sprintMetaDraftFromSprint maps velocity null to empty', () => {
    const s = sprint({ id: 1, name: 'S', status: 'planned', velocity: null });
    expect(sprintMetaDraftFromSprint(s).velocity).toBe('');
    expect(sprintMetaDraftFromSprint({ ...s, velocity: 5 }).velocity).toBe('5');
  });

  it('isSprintMetaDirty detects goal and velocity drift', () => {
    const s = sprint({ id: 1, name: 'S', status: 'planned', goal: 'g', velocity: 2 });
    const base = sprintMetaDraftFromSprint(s);
    expect(isSprintMetaDirty(s, base)).toBe(false);
    expect(isSprintMetaDirty(s, { ...base, goal: 'other' })).toBe(true);
    expect(isSprintMetaDirty(s, { ...base, velocity: '9' })).toBe(true);
  });

  it('validateSprintGoalScalars matches scalar limit', () => {
    expect(validateSprintGoalScalars('あ'.repeat(SPRINT_GOAL_MAX_SCALARS))).toBe(true);
    expect(validateSprintGoalScalars('あ'.repeat(SPRINT_GOAL_MAX_SCALARS + 1))).toBe(false);
  });

  it('parseOptionalSprintVelocityInput allows empty and rejects bad integers', () => {
    expect(parseOptionalSprintVelocityInput('')).toEqual({ ok: true, velocity: null });
    expect(parseOptionalSprintVelocityInput('  3 ')).toEqual({ ok: true, velocity: 3 });
    const bad = parseOptionalSprintVelocityInput('-1');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBe(SPRINT_VELOCITY_INPUT_ERROR);
    const frac = parseOptionalSprintVelocityInput('1.2');
    expect(frac.ok).toBe(false);
    if (!frac.ok) expect(frac.error).toBe(SPRINT_VELOCITY_INPUT_ERROR);
  });

  it('validateSprintCompleteVelocity requires non-negative integer', () => {
    expect(validateSprintCompleteVelocity(0)).toEqual({ ok: true, velocity: 0 });
    expect(validateSprintCompleteVelocity('5')).toEqual({ ok: true, velocity: 5 });
    const badComplete = validateSprintCompleteVelocity(-1);
    expect(badComplete.ok).toBe(false);
    if (!badComplete.ok) expect(badComplete.error).toBe(SPRINT_VELOCITY_INPUT_ERROR);
  });

  it('buildSprintMetaPatch only includes changed fields', () => {
    const s = sprint({
      id: 1,
      name: 'S',
      status: 'planned',
      goal: 'old',
      startDate: '2026-01-01',
      endDate: '2026-01-14',
    });
    const draft = sprintMetaDraftFromSprint(s);
    expect(buildSprintMetaPatch(s, draft)).toBeNull();
    expect(buildSprintMetaPatch(s, { ...draft, goal: 'new' })).toEqual({ goal: 'new' });
  });

  it('buildSprintMemberCandidates filters project + edit and retains members', () => {
    const s = sprint({
      id: 1,
      name: 'S',
      status: 'planned',
      items: [{ id: 99, number: 99, title: 'Ghost', columnId: 2 }],
    });
    const board = [
      item({ id: 10, number: 10, title: 'In project', canEdit: true }),
      item({ id: 11, number: 11, title: 'Other project', projectId: 2 }),
      item({ id: 12, number: 12, title: 'No edit', canEdit: false }),
    ];
    const candidates = buildSprintMemberCandidates(board, 1, s, admin);
    const ids = candidates.map((c) => c.id);
    expect(ids).toContain(10);
    expect(ids).toContain(99);
    expect(ids).not.toContain(11);
    expect(ids).not.toContain(12);
    expect(candidates.map((c) => c.number)).toEqual([...candidates.map((c) => c.number)].sort((a, b) => a - b));
  });
});