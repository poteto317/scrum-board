import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { applyBoardMobileSettings } from './board-mobile';
import { MobileColumnSaveDeps, saveMobileBoardColumn } from './board-mobile-settings';

function board(mobileBoardColumnId: number) {
  return applyBoardMobileSettings({
    columns: [
      { id: 1, name: 'Todo', position: 0 },
      { id: 2, name: 'Doing', position: 1 },
    ],
    items: [],
    settings: { cardLayout: 'pack', mobileBoardColumnId },
  });
}

describe('saveMobileBoardColumn', () => {
  it('optimistically patches and keeps response settings', async () => {
    const state = {
      data: board(1),
      settingsSaving: false,
      settingsSavingLog: [] as boolean[],
    };
    const patchBoardSettings = vi.fn(() =>
      of({ settings: { cardLayout: 'pack' as const, mobileBoardColumnId: 2 } }),
    );
    const deps: MobileColumnSaveDeps = {
      isBusy: () => state.settingsSaving,
      setSettingsSaving: (busy) => {
        state.settingsSaving = busy;
        state.settingsSavingLog.push(busy);
      },
      getData: () => state.data,
      setData: (data) => {
        state.data = data;
      },
      setReorderError: vi.fn(),
      setReorderConflict: vi.fn(),
      patchBoardSettings,
    };
    await saveMobileBoardColumn(deps, 2);
    expect(patchBoardSettings).toHaveBeenCalledWith({ mobileBoardColumnId: 2 });
    expect(state.data.settings.mobileBoardColumnId).toBe(2);
    expect(state.settingsSavingLog).toEqual([true, false]);
  });

  it('rolls back on failure and no-ops while busy', async () => {
    const state = { data: board(1), settingsSaving: false };
    const setReorderError = vi.fn();
    const deps: MobileColumnSaveDeps = {
      isBusy: () => state.settingsSaving,
      setSettingsSaving: (busy) => {
        state.settingsSaving = busy;
      },
      getData: () => state.data,
      setData: (data) => {
        state.data = data;
      },
      setReorderError,
      setReorderConflict: vi.fn(),
      patchBoardSettings: vi.fn(() => throwError(() => ({ status: 500 }))),
    };
    await saveMobileBoardColumn(deps, 2);
    expect(state.data.settings.mobileBoardColumnId).toBe(1);
    expect(setReorderError).toHaveBeenCalled();

    state.settingsSaving = true;
    const patch = vi.fn();
    await saveMobileBoardColumn({ ...deps, patchBoardSettings: patch }, 2);
    expect(patch).not.toHaveBeenCalled();
  });
});
