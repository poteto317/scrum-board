import { describe, expect, it } from 'vitest';
import { projectsForSelectDisplay } from './project-select-display';

const main = { id: 1, name: 'メイン', position: 0 };
const next = { id: 2, name: '次', position: 1 };
const third = { id: 3, name: '三', position: 2 };

describe('projectsForSelectDisplay', () => {
  it('puts the active project first even when it is last by position', () => {
    expect(projectsForSelectDisplay([main, next, third], 3).map((p) => p.id)).toEqual([
      3, 1, 2,
    ]);
  });

  it('keeps position order when activeId is null', () => {
    expect(projectsForSelectDisplay([third, main, next], null).map((p) => p.id)).toEqual([
      1, 2, 3,
    ]);
  });

  it('keeps position order when activeId is not in the list', () => {
    expect(projectsForSelectDisplay([main, next], 99).map((p) => p.id)).toEqual([1, 2]);
  });
});
