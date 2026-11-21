import { describe, expect, it } from 'vitest';
import { projectStatusAriaLabel, projectStatusDots } from './project-status-dots';

const cols = [
  { id: 1, name: 'Todo' },
  { id: 2, name: 'Doing' },
  { id: 9, name: 'Review' },
  { id: 3, name: 'Done' },
];

describe('projectStatusDots', () => {
  it('returns doing only', () => {
    expect(projectStatusDots(cols, [{ columnId: 2 }])).toEqual(['doing']);
  });

  it('returns review only', () => {
    expect(projectStatusDots(cols, [{ columnId: 9 }])).toEqual(['review']);
  });

  it('returns doing then review when both present', () => {
    expect(projectStatusDots(cols, [{ columnId: 9 }, { columnId: 2 }])).toEqual([
      'doing',
      'review',
    ]);
  });

  it('falls back to todo when neither doing nor review', () => {
    expect(projectStatusDots(cols, [{ columnId: 1 }, { columnId: 3 }])).toEqual(['todo']);
  });

  it('returns empty when only done/close-like columns have items', () => {
    expect(projectStatusDots(cols, [{ columnId: 3 }])).toEqual([]);
  });

  it('returns empty when columns are empty (L-002)', () => {
    expect(projectStatusDots([], [{ columnId: 1 }])).toEqual([]);
  });

  it('returns empty when column names do not match', () => {
    expect(
      projectStatusDots([{ id: 1, name: 'Backlog' }], [{ columnId: 1 }]),
    ).toEqual([]);
  });
});

describe('projectStatusAriaLabel', () => {
  it('name only when no dots', () => {
    expect(projectStatusAriaLabel('Alpha', [])).toBe('Alpha');
  });

  it('single status labels', () => {
    expect(projectStatusAriaLabel('Alpha', ['doing'])).toBe('Alpha, Doing');
    expect(projectStatusAriaLabel('Alpha', ['review'])).toBe('Alpha, Review');
    expect(projectStatusAriaLabel('Alpha', ['todo'])).toBe('Alpha, Todo');
  });

  it('doing and review together', () => {
    expect(projectStatusAriaLabel('Alpha', ['doing', 'review'])).toBe(
      'Alpha, Doing と Review',
    );
  });
});
