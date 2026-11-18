import { describe, expect, it } from 'vitest';
import { normalizeBoardData, normalizeItem, normalizeOffsetY } from './board-data';

describe('normalizeBoardData', () => {
  it('defaults missing settings to pack and missing offsetY to 0', () => {
    const board = normalizeBoardData({
      columns: [{ id: 1, name: 'Todo', position: 0 }],
      items: [{ id: 9, number: 1, columnId: 1, title: 'A', position: 0 } as never],
    });
    expect(board.settings!.cardLayout).toBe('pack');
    expect(board.items[0].offsetY).toBe(0);
  });

  it('keeps free layout and offsetY through poll-style replacement', () => {
    const board = normalizeBoardData({
      columns: [{ id: 1, name: 'Todo', position: 0 }],
      items: [
        {
          id: 2,
          projectId: 0,
          number: 2,
          columnId: 1,
          title: 'B',
          description: '',
          position: 0,
          backlogPosition: 0,
          offsetY: 48,
          prUrls: [],
          relatedItems: [],
          assignee: '',
          closeReason: '',
          solution: '',
          favorite: false,
          dueAt: null,
          createdAt: '',
          updatedAt: '',
        },
      ],
      settings: { cardLayout: 'free', futureFlag: true },
    });
    expect(board.settings.cardLayout).toBe('free');
    expect(board.settings['futureFlag']).toBe(true);
    expect(board.items[0].offsetY).toBe(48);
  });

  it('falls back unknown cardLayout values to pack', () => {
    expect(
      normalizeBoardData({ settings: { cardLayout: 'grid' as never } }).settings.cardLayout,
    ).toBe('pack');
  });

  it('keeps mobileBoardColumnId through normalize', () => {
    const board = normalizeBoardData({
      settings: { cardLayout: 'pack', mobileBoardColumnId: 3 },
    });
    expect(board.settings.mobileBoardColumnId).toBe(3);
  });

  it('keeps activeProjectId and unknown settings keys', () => {
    const board = normalizeBoardData({
      settings: { cardLayout: 'pack', activeProjectId: 4.9, futureFlag: true },
    });
    expect(board.settings.activeProjectId).toBe(4);
    expect(board.settings['futureFlag']).toBe(true);
  });

  it('drops a non-numeric activeProjectId and still keeps unknown keys', () => {
    const board = normalizeBoardData({
      settings: { cardLayout: 'free', activeProjectId: '1' as never, futureFlag: 1 },
    });
    expect(board.settings.activeProjectId).toBeUndefined();
    expect('activeProjectId' in board.settings).toBe(false);
    expect(board.settings['futureFlag']).toBe(1);
    expect(board.settings.cardLayout).toBe('free');
  });
});

describe('normalizeOffsetY / normalizeItem', () => {
  it('clamps negative, caps at MAX_OFFSET_Y, and truncates non-integers', () => {
    expect(normalizeOffsetY(-3)).toBe(0);
    expect(normalizeOffsetY(12.9)).toBe(12);
    expect(normalizeOffsetY(100_001)).toBe(100_000);
    expect(normalizeOffsetY(100_000)).toBe(100_000);
    expect(normalizeItem({ id: 1, offsetY: -1 }).offsetY).toBe(0);
    expect(normalizeItem({ id: 1, offsetY: 200_000 }).offsetY).toBe(100_000);
    expect(normalizeItem({ id: 1 }).closeReason).toBe('');
    expect(normalizeItem({ id: 1, closeReason: 'x' }).closeReason).toBe('x');
    expect(normalizeItem({ id: 1 }).solution).toBe('');
    expect(normalizeItem({ id: 1, solution: 'done' }).solution).toBe('done');
  });

  it('defaults missing projectId to 0 and truncates numeric ids', () => {
    expect(normalizeItem({ id: 1 }).projectId).toBe(0);
    expect(normalizeItem({ id: 1, projectId: 3.8 }).projectId).toBe(3);
    expect(normalizeItem({ id: 1, projectId: '2' as never }).projectId).toBe(0);
  });

  it('normalizes missing dueAt to null (not empty string)', () => {
    expect(normalizeItem({ id: 1 }).dueAt).toBeNull();
    expect(normalizeItem({ id: 1, dueAt: null }).dueAt).toBeNull();
    expect(normalizeItem({ id: 1, dueAt: '' }).dueAt).toBeNull();
    expect(normalizeItem({ id: 1, dueAt: '2026-11-17T08:30:00Z' }).dueAt).toBe(
      '2026-11-17T08:30:00Z',
    );
  });

  it('normalizes favorite with === true only (L-002)', () => {
    expect(normalizeItem({ id: 1 }).favorite).toBe(false);
    expect(normalizeItem({ id: 1, favorite: true }).favorite).toBe(true);
    expect(normalizeItem({ id: 1, favorite: false }).favorite).toBe(false);
    expect(normalizeItem({ id: 1, favorite: 'true' as never }).favorite).toBe(false);
    expect(normalizeItem({ id: 1, favorite: 1 as never }).favorite).toBe(false);
  });
});
