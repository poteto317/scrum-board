import type { BoardSettings } from './models';
import type { ProjectSession } from './project-session';

/**
 * Apply a board (or board meta) payload after syncing active project from settings
 * (single hydrate path). Accepts anything with normalized settings, so the items-free
 * GET /api/board/meta result can use it too.
 */
export function applyBoardDataWithActiveSync<T extends { settings: BoardSettings }>(
  session: Pick<ProjectSession, 'syncActiveFromBoard'>,
  board: T,
  apply: (board: T) => void,
): void {
  session.syncActiveFromBoard(board.settings.activeProjectId, false);
  apply(board);
}
