import { describe, expect, it } from 'vitest';
import { normalizeBoardData, normalizeBoardMeta } from './board-data';

describe('normalizeBoardData settings (characterization)', () => {
  it('fills cardLayout with pack when settings are missing', () => {
    expect(normalizeBoardData({ columns: [], items: [] }).settings).toEqual({ cardLayout: 'pack' });
  });

  it('truncates numeric ids and drops undefined optional keys', () => {
    const { settings } = normalizeBoardData({
      columns: [],
      items: [],
      settings: {
        cardLayout: 'free',
        mobileBoardColumnId: 3.9,
        activeProjectId: undefined,
      },
    });
    expect(settings).toEqual({ cardLayout: 'free', mobileBoardColumnId: 3 });
    expect('activeProjectId' in settings).toBe(false);
  });

  it('treats a non-finite id as missing', () => {
    const { settings } = normalizeBoardData({
      columns: [],
      items: [],
      settings: { cardLayout: 'pack', activeProjectId: Number.NaN },
    });
    expect('activeProjectId' in settings).toBe(false);
  });
});

describe('normalizeBoardMeta', () => {
  it('returns only columns and settings, never items', () => {
    const meta = normalizeBoardMeta({
      columns: [{ id: 1, name: 'Todo', position: 0 }],
      settings: { cardLayout: 'pack', activeProjectId: 2 },
    });
    expect(Object.keys(meta).sort()).toEqual(['columns', 'settings']);
    expect(meta.columns).toEqual([{ id: 1, name: 'Todo', position: 0 }]);
    expect(meta.settings).toEqual({ cardLayout: 'pack', activeProjectId: 2 });
  });

  it('fills pack and an empty column list when the response is missing fields', () => {
    expect(normalizeBoardMeta({})).toEqual({ columns: [], settings: { cardLayout: 'pack' } });
    expect(normalizeBoardMeta(null)).toEqual({ columns: [], settings: { cardLayout: 'pack' } });
  });

  it('normalizes settings exactly like normalizeBoardData', () => {
    const raw = {
      columns: [],
      settings: { cardLayout: 'free' as const, mobileBoardColumnId: 4.7, activeProjectId: 9.2 },
    };
    expect(normalizeBoardMeta(raw).settings).toEqual(
      normalizeBoardData({ ...raw, items: [] }).settings,
    );
  });

  it('copies the columns array', () => {
    const columns = [{ id: 1, name: 'Todo', position: 0 }];
    expect(normalizeBoardMeta({ columns }).columns).not.toBe(columns);
  });
});
