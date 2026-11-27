/** localStorage key and helpers for the cross-project search checkbox. */

export const CROSS_PROJECT_SEARCH_KEY = 'scrum-board.projectAiChat.crossProjectSearch';

export function readCrossProjectSearch(): boolean {
  try {
    return localStorage.getItem(CROSS_PROJECT_SEARCH_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeCrossProjectSearch(on: boolean) {
  try {
    localStorage.setItem(CROSS_PROJECT_SEARCH_KEY, on ? '1' : '0');
  } catch {
    /* ignore quota / private mode */
  }
}
