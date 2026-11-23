import { ConditionalGetResult } from './conditional-get';

/** Merge conditional backlog+board legs. Returns null when both notModified (skip apply). */
export function mergeBacklogBoardPoll<TItems, TBoard extends { columns: unknown[] }>(
  prev: { items: TItems; columns: TBoard['columns'] },
  backlog: ConditionalGetResult<{ items: TItems }>,
  board: ConditionalGetResult<TBoard>,
): { items: TItems; columns: TBoard['columns'] } | null {
  if (backlog.status === 'notModified' && board.status === 'notModified') {
    return null;
  }
  return {
    items: backlog.status === 'ok' ? backlog.body.items : prev.items,
    columns: board.status === 'ok' ? board.body.columns : prev.columns,
  };
}
