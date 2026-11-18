export type UpdateItemArgs = {
  number: number;
  projectId?: number;
  title?: string;
  description?: string;
  dueAt?: string | null;
  closeReason?: string;
  prUrls?: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Build PATCH body; `projectId` on args is lookup-only and never included. */
export function collectUpdatePatch(args: UpdateItemArgs): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (args.title !== undefined) patch.title = args.title;
  if (args.description !== undefined) patch.description = args.description;
  if (args.dueAt !== undefined) patch.dueAt = args.dueAt;
  if (args.closeReason !== undefined) patch.closeReason = args.closeReason;
  if (args.prUrls !== undefined) patch.prUrls = args.prUrls;
  return Object.keys(patch).length === 0 ? null : patch;
}

export function resolvedItemId(
  data: unknown,
  number: number,
  projectId?: number,
): number | null {
  if (!isRecord(data)) return null;
  const id = data.id;
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return null;
  if (data.number !== number) return null;
  if (projectId !== undefined && data.projectId !== projectId) return null;
  return id;
}

export function patchedItemMatches(
  data: unknown,
  resolvedId: number,
  number: number,
): boolean {
  if (!isRecord(data)) return false;
  return data.id === resolvedId && data.number === number;
}

export function findColumnId(columns: unknown, columnName: string): number | null {
  if (!Array.isArray(columns)) return null;
  for (const c of columns) {
    if (!isRecord(c)) continue;
    if (c.name === columnName && typeof c.id === 'number') return c.id;
  }
  return null;
}

/** Resolve column id from a GET /api/board JSON body. */
export function resolveColumnIdFromBoard(boardData: unknown, columnName: string): number | null {
  if (!isRecord(boardData)) return null;
  return findColumnId(boardData.columns, columnName);
}
