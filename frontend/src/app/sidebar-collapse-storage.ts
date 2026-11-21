export const SIDEBAR_COLLAPSED_KEY = 'scrumboard:sidebar-collapsed';

function storageOrLocal(storage?: Storage): Storage {
  return storage ?? localStorage;
}

/** Read failure or any value other than `"1"` → expanded (`false`). */
export function readSidebarCollapsed(storage?: Storage): boolean {
  try {
    return storageOrLocal(storage).getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persists collapsed state. Returns whether the write succeeded. Does not throw. */
export function writeSidebarCollapsed(collapsed: boolean, storage?: Storage): boolean {
  try {
    storageOrLocal(storage).setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
