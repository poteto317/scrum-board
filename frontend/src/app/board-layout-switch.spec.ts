import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { normalizeBoardData } from './board-data';
import { LayoutSwitchDeps, switchFreeToPack, switchPackToFree } from './board-layout-switch';
import { Item } from './models';

function card(id: number, columnId: number, position: number, offsetY = 0): Item {
  return {
    id,
    projectId: 1,
    number: id,
    columnId,
    title: `c${id}`,
    description: '',
    position,
    backlogPosition: position,
    offsetY,
    prUrls: [],
    relatedItems: [],
    assignee: '',
    closeReason: '',
    solution: '',
    dueAt: null,
    createdAt: '',
    updatedAt: '',
  };
}

function board(layout: 'pack' | 'free', items: Item[]) {
  return normalizeBoardData({
    columns: [{ id: 1, name: 'Todo', position: 0 }],
    items,
    settings: { cardLayout: layout },
  });
}

function deps(
  overrides: Partial<LayoutSwitchDeps> & {
    state: {
      data: ReturnType<typeof board>;
      layoutSwitching: boolean;
      settingsSaving: boolean;
      settingsSavingLog?: boolean[];
    };
  },
): LayoutSwitchDeps {
  const { state } = overrides;
  return {
    isBusy: () => state.layoutSwitching || state.settingsSaving,
    setLayoutSwitching: (busy) => {
      state.layoutSwitching = busy;
    },
    setSettingsSaving: (busy) => {
      state.settingsSaving = busy;
      state.settingsSavingLog?.push(busy);
    },
    getData: () => state.data,
    setData: (data) => {
      state.data = data;
    },
    updateData: (fn) => {
      state.data = fn(state.data);
    },
    setReorderError: vi.fn(),
    setReorderConflict: vi.fn(),
    setReorderAnnouncement: vi.fn(),
    measurePackOffsetsAsItems: () => state.data.items.map((c) => ({ ...c, offsetY: 40 })),
    scheduleCardHeightMeasure: vi.fn(),
    reorderItems: vi.fn(() => of({ items: state.data.items })),
    patchBoardSettings: vi.fn(() => of({ settings: { cardLayout: 'free' as const } })),
    ...overrides,
  };
}

describe('switchPackToFree / switchFreeToPack', () => {
  it('optimistically measures then persists free layout', async () => {
    const state = {
      data: board('pack', [card(1, 1, 0)]),
      layoutSwitching: false,
      settingsSaving: false,
      settingsSavingLog: [] as boolean[],
    };
    const reorderItems = vi.fn(() => of({ items: [card(1, 1, 0, 40)] }));
    const patchBoardSettings = vi.fn(() => of({ settings: { cardLayout: 'free' as const } }));
    const d = deps({ state, reorderItems, patchBoardSettings });
    await switchPackToFree(d);
    expect(reorderItems).toHaveBeenCalled();
    expect(patchBoardSettings).toHaveBeenCalledWith({ cardLayout: 'free' });
    expect(state.data.settings.cardLayout).toBe('free');
    expect(state.layoutSwitching).toBe(false);
    expect(state.settingsSaving).toBe(false);
    expect(state.settingsSavingLog).toEqual([true, false]);
  });

  it('keeps layoutSwitching true while settingsSaving only wraps patch', async () => {
    const state = {
      data: board('pack', [card(1, 1, 0)]),
      layoutSwitching: false,
      settingsSaving: false,
    };
    let sawLayoutDuringReorder = false;
    let sawSettingsDuringReorder = false;
    let sawLayoutDuringPatch = false;
    let sawSettingsDuringPatch = false;
    const reorderItems = vi.fn(() => {
      sawLayoutDuringReorder = state.layoutSwitching;
      sawSettingsDuringReorder = state.settingsSaving;
      return of({ items: [card(1, 1, 0, 40)] });
    });
    const patchBoardSettings = vi.fn(() => {
      sawLayoutDuringPatch = state.layoutSwitching;
      sawSettingsDuringPatch = state.settingsSaving;
      return of({ settings: { cardLayout: 'free' as const } });
    });
    await switchPackToFree(deps({ state, reorderItems, patchBoardSettings }));
    expect(sawLayoutDuringReorder).toBe(true);
    expect(sawSettingsDuringReorder).toBe(false);
    expect(sawLayoutDuringPatch).toBe(true);
    expect(sawSettingsDuringPatch).toBe(true);
  });

  it('reverts pack→free on reorder failure', async () => {
    const previous = board('pack', [card(1, 1, 0)]);
    const state = { data: previous, layoutSwitching: false, settingsSaving: false };
    const setReorderError = vi.fn();
    const d = deps({
      state,
      setReorderError,
      reorderItems: vi.fn(() => throwError(() => ({ status: 409, message: 'conflict' }))),
    });
    await switchPackToFree(d);
    expect(state.data).toEqual(previous);
    expect(setReorderError).toHaveBeenCalled();
    expect(state.layoutSwitching).toBe(false);
    expect(state.settingsSaving).toBe(false);
  });

  it('reverts pack→free when order succeeds but patchBoardSettings fails', async () => {
    const previous = board('pack', [card(1, 1, 0)]);
    const state = { data: previous, layoutSwitching: false, settingsSaving: false };
    const setReorderError = vi.fn();
    const reorderItems = vi.fn(() => of({ items: [card(1, 1, 0, 40)] }));
    const patchBoardSettings = vi.fn(() => throwError(() => ({ status: 500, message: 'fail' })));
    const d = deps({ state, setReorderError, reorderItems, patchBoardSettings });
    await switchPackToFree(d);
    expect(reorderItems).toHaveBeenCalled();
    expect(patchBoardSettings).toHaveBeenCalledWith({ cardLayout: 'free' });
    expect(state.data).toEqual(previous);
    expect(state.data.settings.cardLayout).toBe('pack');
    expect(setReorderError).toHaveBeenCalled();
    expect(state.layoutSwitching).toBe(false);
    expect(state.settingsSaving).toBe(false);
  });

  it('switches free→pack and applies server items', async () => {
    const state = {
      data: board('free', [card(1, 1, 0, 80)]),
      layoutSwitching: false,
      settingsSaving: false,
      settingsSavingLog: [] as boolean[],
    };
    const packed = [card(1, 1, 0, 80)];
    const d = deps({
      state,
      patchBoardSettings: vi.fn(() =>
        of({ settings: { cardLayout: 'pack' as const }, items: packed }),
      ),
    });
    await switchFreeToPack(d);
    expect(state.data.settings.cardLayout).toBe('pack');
    expect(state.data.items).toEqual(packed);
    expect(state.settingsSavingLog).toEqual([true, false]);
  });

  it('reverts free→pack when patchBoardSettings fails', async () => {
    const previous = board('free', [card(1, 1, 0, 80)]);
    const state = { data: previous, layoutSwitching: false, settingsSaving: false };
    const setReorderError = vi.fn();
    const d = deps({
      state,
      setReorderError,
      patchBoardSettings: vi.fn(() => throwError(() => ({ status: 500, message: 'fail' }))),
    });
    await switchFreeToPack(d);
    expect(state.data).toEqual(previous);
    expect(state.data.settings.cardLayout).toBe('free');
    expect(setReorderError).toHaveBeenCalled();
    expect(state.layoutSwitching).toBe(false);
    expect(state.settingsSaving).toBe(false);
  });

  it('no-ops when already busy', async () => {
    const state = {
      data: board('pack', [card(1, 1, 0)]),
      layoutSwitching: true,
      settingsSaving: false,
    };
    const reorderItems = vi.fn();
    await switchPackToFree(deps({ state, reorderItems }));
    expect(reorderItems).not.toHaveBeenCalled();
  });
});
