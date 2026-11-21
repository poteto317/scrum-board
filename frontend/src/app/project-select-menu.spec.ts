import { describe, expect, it } from 'vitest';
import {
  canOpenProjectMenu,
  moveProjectHighlight,
  resolveHighlightedProjectId,
} from './project-select-menu';
import { projectsForSelectDisplay } from './project-select-display';

const main = { id: 1, name: 'メイン', position: 0 };
const next = { id: 2, name: '次', position: 1 };
const third = { id: 3, name: '三', position: 2 };

describe('resolveHighlightedProjectId', () => {
  it('keeps the current highlight when still in the list', () => {
    const list = projectsForSelectDisplay([main, next, third], 3);
    expect(resolveHighlightedProjectId(list, 3, 1)).toBe(1);
  });

  it('clamps to the last display item when the highlight id disappeared', () => {
    const list = projectsForSelectDisplay([main, next], 1);
    expect(resolveHighlightedProjectId(list, 1, 99)).toBe(next.id);
  });

  it('returns null when activeId is missing', () => {
    expect(resolveHighlightedProjectId([main], null, 1)).toBeNull();
  });
});

describe('moveProjectHighlight', () => {
  const list = [third, main, next];

  it('moves down and wraps', () => {
    expect(moveProjectHighlight(list, third.id, 'down')).toBe(main.id);
    expect(moveProjectHighlight(list, next.id, 'down')).toBe(third.id);
  });

  it('moves up and wraps', () => {
    expect(moveProjectHighlight(list, third.id, 'up')).toBe(next.id);
  });
});

describe('canOpenProjectMenu', () => {
  it('requires an active project and idle chrome', () => {
    expect(
      canOpenProjectMenu({
        switching: false,
        modalOpen: false,
        saving: false,
        activeId: 1,
        projectCount: 2,
      }),
    ).toBe(true);
    expect(
      canOpenProjectMenu({
        switching: true,
        modalOpen: false,
        saving: false,
        activeId: 1,
        projectCount: 2,
      }),
    ).toBe(false);
  });
});
