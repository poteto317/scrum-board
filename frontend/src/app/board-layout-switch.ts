import { firstValueFrom, Observable } from 'rxjs';
import { errorMessage } from './api-error';
import { normalizeBoardData, NormalizedBoardData, normalizeItem } from './board-data';
import { buildAllColumnsOffsetPayload, ItemOrderColumn } from './item-order';
import { BoardSettings, CardLayout, Item } from './models';

/** Narrow deps for pack↔free switch orchestration (Board wires signals/API). */
export type LayoutSwitchDeps = {
  isBusy: () => boolean;
  setLayoutSwitching: (busy: boolean) => void;
  setSettingsSaving: (busy: boolean) => void;
  getData: () => NormalizedBoardData;
  setData: (data: NormalizedBoardData) => void;
  updateData: (fn: (data: NormalizedBoardData) => NormalizedBoardData) => void;
  setReorderError: (message: string) => void;
  setReorderConflict: (conflict: boolean) => void;
  setReorderAnnouncement: (message: string) => void;
  measurePackOffsetsAsItems: () => Item[];
  scheduleCardHeightMeasure: () => void;
  reorderItems: (columns: ItemOrderColumn[]) => Observable<{ items: Item[] }>;
  patchBoardSettings: (body: {
    cardLayout: CardLayout;
  }) => Observable<{ settings: BoardSettings; items?: Item[] }>;
};

function beginSwitch(deps: LayoutSwitchDeps): NormalizedBoardData | null {
  if (deps.isBusy()) return null;
  const previous = deps.getData();
  deps.setLayoutSwitching(true);
  deps.setReorderError('');
  deps.setReorderConflict(false);
  return previous;
}

function failSwitch(
  deps: LayoutSwitchDeps,
  previous: NormalizedBoardData,
  e: unknown,
  announcement: string,
) {
  deps.setData(previous);
  deps.setReorderError(errorMessage(e));
  deps.setReorderConflict((e as { status?: number } | null)?.status === 409);
  deps.setReorderAnnouncement(announcement);
  deps.scheduleCardHeightMeasure();
}

async function patchSettings(
  deps: LayoutSwitchDeps,
  cardLayout: CardLayout,
): Promise<{ settings: BoardSettings; items?: Item[] }> {
  deps.setSettingsSaving(true);
  try {
    return await firstValueFrom(deps.patchBoardSettings({ cardLayout }));
  } finally {
    deps.setSettingsSaving(false);
  }
}

/** Optimistic pack→free: measure tops, PUT offsets, then PATCH settings. */
export async function switchPackToFree(deps: LayoutSwitchDeps): Promise<void> {
  const previous = beginSwitch(deps);
  if (!previous) return;
  const measured = deps.measurePackOffsetsAsItems();
  deps.updateData((d) => ({
    ...d,
    items: measured,
    settings: { ...d.settings, cardLayout: 'free' },
  }));
  deps.scheduleCardHeightMeasure();
  try {
    const columnIds = previous.columns.map((c) => c.id);
    const orderRes = await firstValueFrom(
      deps.reorderItems(buildAllColumnsOffsetPayload(measured, columnIds)),
    );
    const orderedItems = (orderRes.items ?? []).map((item) => normalizeItem(item));
    deps.updateData((d) => ({ ...d, items: orderedItems }));
    const settingsRes = await patchSettings(deps, 'free');
    deps.updateData((d) =>
      normalizeBoardData({
        ...d,
        settings: settingsRes.settings,
        items: settingsRes.items ? settingsRes.items.map((item) => normalizeItem(item)) : d.items,
      }),
    );
    deps.setReorderAnnouncement('自由配置に切り替えました');
    deps.scheduleCardHeightMeasure();
  } catch (e) {
    failSwitch(deps, previous, e, '自由配置への切り替えを保存できませんでした');
  } finally {
    deps.setLayoutSwitching(false);
  }
}

/** Optimistic free→pack: PATCH settings (server reassigns positions). */
export async function switchFreeToPack(deps: LayoutSwitchDeps): Promise<void> {
  const previous = beginSwitch(deps);
  if (!previous) return;
  deps.updateData((d) => ({
    ...d,
    settings: { ...d.settings, cardLayout: 'pack' },
  }));
  try {
    const settingsRes = await patchSettings(deps, 'pack');
    const items = settingsRes.items
      ? settingsRes.items.map((item) => normalizeItem(item))
      : previous.items;
    deps.updateData((d) =>
      normalizeBoardData({
        ...d,
        settings: settingsRes.settings,
        items,
      }),
    );
    deps.setReorderAnnouncement('上詰め配置に切り替えました');
    deps.scheduleCardHeightMeasure();
  } catch (e) {
    failSwitch(deps, previous, e, '上詰め配置への切り替えを保存できませんでした');
  } finally {
    deps.setLayoutSwitching(false);
  }
}
