import { Column } from './models';

/** User-facing error when create must target Todo but that column is absent. */
export const TODO_COLUMN_MISSING = 'Todo 列が見つかりません。';

/** Resolves the Todo column id by exact name match, or undefined if missing. */
export function todoColumnId(columns: readonly Pick<Column, 'id' | 'name'>[]): number | undefined {
  return columns.find((c) => c.name === 'Todo')?.id;
}
