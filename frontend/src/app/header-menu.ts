export type PageKind = 'board' | 'backlog' | 'itemDetail';

export type HeaderMenuItemId =
  | 'project_add'
  | 'project_rename'
  | 'project_delete'
  | 'open_trash'
  | 'open_users'
  | 'open_recurring'
  | 'open_settings'
  | 'item_history'
  | 'item_solution'
  | 'item_favorite';

export type HeaderMenuPagePrefs = { hiddenIds: string[] };

export type WorkspaceHeaderMenu = {
  board: HeaderMenuPagePrefs;
  backlog: HeaderMenuPagePrefs;
  itemDetail: HeaderMenuPagePrefs;
};

export type MenuCatalogEntry = {
  id: HeaderMenuItemId;
  label: string;
  pageKinds: readonly PageKind[];
};

export const HEADER_MENU_CATALOG: readonly MenuCatalogEntry[] = [
  { id: 'project_add', label: 'プロジェクトを追加', pageKinds: ['board', 'backlog'] },
  { id: 'project_rename', label: '名称変更', pageKinds: ['board', 'backlog'] },
  { id: 'project_delete', label: '削除', pageKinds: ['board', 'backlog'] },
  { id: 'open_trash', label: 'ゴミ箱', pageKinds: ['board', 'backlog', 'itemDetail'] },
  { id: 'open_users', label: 'ユーザー', pageKinds: ['board', 'backlog', 'itemDetail'] },
  { id: 'open_recurring', label: '繰り返し', pageKinds: ['board', 'backlog', 'itemDetail'] },
  { id: 'open_settings', label: '設定', pageKinds: ['board', 'backlog', 'itemDetail'] },
  { id: 'item_history', label: '更新履歴', pageKinds: ['itemDetail'] },
  { id: 'item_solution', label: 'ソリューション', pageKinds: ['itemDetail'] },
  { id: 'item_favorite', label: 'お気に入り', pageKinds: ['itemDetail'] },
] as const;

const CATALOG_IDS = new Set(HEADER_MENU_CATALOG.map((c) => c.id));

export function emptyHeaderMenuPagePrefs(): HeaderMenuPagePrefs {
  return { hiddenIds: [] };
}

export function emptyWorkspaceHeaderMenu(): WorkspaceHeaderMenu {
  return {
    board: emptyHeaderMenuPagePrefs(),
    backlog: emptyHeaderMenuPagePrefs(),
    itemDetail: emptyHeaderMenuPagePrefs(),
  };
}

export function resolvePageKind(url: string): PageKind | null {
  const path = url.split('?')[0].split('#')[0];
  const normalized =
    path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path === '' ? '/' : path;
  if (normalized === '/' || normalized === '') return 'board';
  if (normalized === '/backlog') return 'backlog';
  if (
    normalized === '/trash' ||
    normalized === '/users' ||
    normalized === '/recurring' ||
    normalized === '/settings' ||
    normalized === '/login'
  ) {
    return null;
  }
  if (/^\/items\/\d+$/.test(normalized)) return 'itemDetail';
  if (/^\/items\/\d+\/solution$/.test(normalized)) return 'itemDetail';
  return null;
}

export function catalogForPageKind(pageKind: PageKind): MenuCatalogEntry[] {
  return HEADER_MENU_CATALOG.filter((e) => e.pageKinds.includes(pageKind));
}

export function catalogIdsForPageKind(pageKind: PageKind): HeaderMenuItemId[] {
  return catalogForPageKind(pageKind).map((e) => e.id);
}

export function visibleMenuItemIds(
  pageKind: PageKind,
  prefs: HeaderMenuPagePrefs,
): HeaderMenuItemId[] {
  const hidden = new Set(prefs.hiddenIds);
  return catalogIdsForPageKind(pageKind).filter((id) => !hidden.has(id));
}

export function isCatalogItemId(id: string): id is HeaderMenuItemId {
  return CATALOG_IDS.has(id as HeaderMenuItemId);
}

export function isItemVisible(prefs: HeaderMenuPagePrefs, itemId: HeaderMenuItemId): boolean {
  return !prefs.hiddenIds.includes(itemId);
}

export function cloneHeaderMenuPagePrefs(
  p: HeaderMenuPagePrefs | null | undefined,
): HeaderMenuPagePrefs {
  return { hiddenIds: [...(p?.hiddenIds ?? [])] };
}

export function cloneWorkspaceHeaderMenu(
  m: WorkspaceHeaderMenu | null | undefined,
): WorkspaceHeaderMenu {
  return {
    board: cloneHeaderMenuPagePrefs(m?.board),
    backlog: cloneHeaderMenuPagePrefs(m?.backlog),
    itemDetail: cloneHeaderMenuPagePrefs(m?.itemDetail),
  };
}

export function pagePrefsEqual(a: HeaderMenuPagePrefs, b: HeaderMenuPagePrefs): boolean {
  if (a.hiddenIds.length !== b.hiddenIds.length) return false;
  return a.hiddenIds.every((id, i) => id === b.hiddenIds[i]);
}

export type ProjectMenuDisabledState = {
  switching: boolean;
  mutating: boolean;
  saving: boolean;
  modalOpen: boolean;
  canRename: boolean;
  canDelete: boolean;
};

/** Pure disabled rules for project_* menu items (same as former header buttons). */
export function projectMenuActionDisabled(
  id: HeaderMenuItemId,
  state: ProjectMenuDisabledState,
): boolean {
  if (id === 'project_add') {
    return state.switching || state.mutating || state.saving || state.modalOpen;
  }
  if (id === 'project_rename') {
    return !state.canRename || state.modalOpen || state.saving;
  }
  if (id === 'project_delete') {
    return !state.canDelete || state.modalOpen || state.saving;
  }
  return false;
}

export function catalogLabel(
  id: HeaderMenuItemId,
  pageKind: PageKind | null,
  options?: { favoriteDynamic?: string },
): string {
  if (id === 'item_favorite') {
    return options?.favoriteDynamic ?? 'お気に入り';
  }
  const kind = pageKind ?? 'board';
  return catalogForPageKind(kind).find((e) => e.id === id)?.label ?? id;
}

