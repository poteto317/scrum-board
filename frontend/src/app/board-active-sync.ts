import type { NormalizedBoardData } from './board-data';
import type { ProjectSession } from './project-session';

/** Apply board payload after syncing active project from settings (single hydrate path). */
export function applyBoardDataWithActiveSync(
  session: Pick<ProjectSession, 'syncActiveFromBoard'>,
  board: NormalizedBoardData,
  apply: (board: NormalizedBoardData) => void,
): void {
  session.syncActiveFromBoard(board.settings.activeProjectId, false);
  apply(board);
}
