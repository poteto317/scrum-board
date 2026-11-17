import { firstValueFrom, Observable } from 'rxjs';
import { errorMessage } from './api-error';
import { applyBoardMobileSettings, NormalizedBoardData } from './board-mobile';
import { BoardSettings, Item } from './models';

/** Narrow deps for mobile column selection persistence (Board wires signals/API). */
export type MobileColumnSaveDeps = {
  isBusy: () => boolean;
  setSettingsSaving: (busy: boolean) => void;
  getData: () => NormalizedBoardData;
  setData: (data: NormalizedBoardData) => void;
  setReorderError: (message: string) => void;
  setReorderConflict: (conflict: boolean) => void;
  patchBoardSettings: (body: {
    mobileBoardColumnId: number;
  }) => Observable<{ settings: BoardSettings; items?: Item[] }>;
};

/** Optimistic mobile column select → PATCH; rollback on failure (L-001). */
export async function saveMobileBoardColumn(
  deps: MobileColumnSaveDeps,
  columnId: number,
): Promise<void> {
  if (deps.isBusy()) return;
  if (!Number.isFinite(columnId) || columnId <= 0) return;
  const previous = deps.getData();
  const currentId = previous.settings.mobileBoardColumnId;
  if (columnId === currentId) return;
  if (!previous.columns.some((c) => c.id === columnId)) return;

  deps.setSettingsSaving(true);
  deps.setReorderError('');
  deps.setReorderConflict(false);
  deps.setData(
    applyBoardMobileSettings({
      ...previous,
      settings: { ...previous.settings, mobileBoardColumnId: columnId },
    }),
  );
  try {
    const res = await firstValueFrom(deps.patchBoardSettings({ mobileBoardColumnId: columnId }));
    const latest = deps.getData();
    deps.setData(
      applyBoardMobileSettings({
        ...latest,
        settings: res.settings,
        items: res.items ?? latest.items,
      }),
    );
  } catch (e) {
    deps.setData(previous);
    deps.setReorderError(errorMessage(e));
    deps.setReorderConflict((e as { status?: number } | null)?.status === 409);
  } finally {
    deps.setSettingsSaving(false);
  }
}
