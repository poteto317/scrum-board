export type StatusKind = 'doing' | 'review' | 'todo';

/** Presence dots for a project select option. Empty columns → [] (L-002). */
export function projectStatusDots(
  columns: { id: number; name: string }[],
  items: { columnId: number }[],
): StatusKind[] {
  if (!columns.length) return [];
  const idByName = new Map(columns.map((c) => [c.name, c.id]));
  const count = (name: string) => {
    const id = idByName.get(name);
    if (id == null) return 0;
    return items.reduce((n, it) => n + (it.columnId === id ? 1 : 0), 0);
  };
  const doing = count('Doing');
  const review = count('Review');
  const todo = count('Todo');
  if (doing > 0 || review > 0) {
    const out: StatusKind[] = [];
    if (doing > 0) out.push('doing');
    if (review > 0) out.push('review');
    return out;
  }
  if (todo > 0) return ['todo'];
  return [];
}

export function projectStatusAriaLabel(name: string, dots: StatusKind[]): string {
  if (!dots.length) return name;
  if (dots.length === 1) {
    const label =
      dots[0] === 'doing' ? 'Doing' : dots[0] === 'review' ? 'Review' : 'Todo';
    return `${name}, ${label}`;
  }
  // Only Doing+Review can appear together per projectStatusDots.
  return `${name}, Doing と Review`;
}
