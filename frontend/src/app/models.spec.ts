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
  });

  it('normalizes missing dueAt to null (not empty string)', () => {
    expect(normalizeItem({ id: 1 }).dueAt).toBeNull();
    expect(normalizeItem({ id: 1, dueAt: null }).dueAt).toBeNull();
    expect(normalizeItem({ id: 1, dueAt: '' }).dueAt).toBeNull();
    expect(normalizeItem({ id: 1, dueAt: '2026-11-17T08:30:00Z' }).dueAt).toBe(
      '2026-11-17T08:30:00Z',
    );
  });
});
