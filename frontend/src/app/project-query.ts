/** Fixed copy when ?project= is present but unusable (L-044). */
export const PROJECT_QUERY_NOT_FOUND = '指定のプロジェクトが見つかりません。';

export type ProjectQueryParse =
  | { kind: 'absent' }
  | { kind: 'invalid' }
  | { kind: 'ok'; id: number };

/** Pure decision for board deep-link apply (no I/O). */
export type ProjectDeepLinkAction =
  | { kind: 'skip' }
  | { kind: 'error'; message: string }
  | { kind: 'switch'; id: number };

/**
 * Parse the `project` query for board deep links.
 * Duplicate keys → invalid (do not take the first). Leading zeros / signs → invalid.
 */
export function parseProjectQueryParam(
  input: string | readonly string[] | null | undefined,
): ProjectQueryParse {
  if (input == null) return { kind: 'absent' };
  if (Array.isArray(input)) {
    if (input.length === 0) return { kind: 'absent' };
    if (input.length >= 2) return { kind: 'invalid' };
    return parseSingleProjectQueryValue(input[0]);
  }
  if (typeof input !== 'string') return { kind: 'invalid' };
  return parseSingleProjectQueryValue(input);
}

function parseSingleProjectQueryValue(raw: string): ProjectQueryParse {
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'invalid' };
  // No leading zeros: "01" must be invalid (design).
  if (!/^[1-9]\d*$/.test(trimmed)) return { kind: 'invalid' };
  const id = Number(trimmed);
  if (!Number.isSafeInteger(id) || id < 1) return { kind: 'invalid' };
  return { kind: 'ok', id };
}

/** Board path only (`''` or `/`). */
export function isBoardPath(path: string): boolean {
  return path === '' || path === '/';
}

export function resolveProjectDeepLinkAction(input: {
  path: string;
  projectValues: readonly string[];
  projectIds: readonly number[];
  activeId: number | null;
}): ProjectDeepLinkAction {
  if (!isBoardPath(input.path)) return { kind: 'skip' };
  const parsed = parseProjectQueryParam(input.projectValues);
  if (parsed.kind === 'absent') return { kind: 'skip' };
  if (parsed.kind === 'invalid') {
    return { kind: 'error', message: PROJECT_QUERY_NOT_FOUND };
  }
  if (!input.projectIds.includes(parsed.id)) {
    return { kind: 'error', message: PROJECT_QUERY_NOT_FOUND };
  }
  if (input.activeId === parsed.id) return { kind: 'skip' };
  return { kind: 'switch', id: parsed.id };
}

/** Merge `project` into query params (pure). */
export function withProjectQueryParam(
  queryParams: Record<string, string | string[] | undefined | null>,
  id: number,
): Record<string, string | string[] | undefined | null> {
  return { ...queryParams, project: String(id) };
}
