import { Project } from './models';

/** Resolve highlighted id after the display list changes (L-035). `list` must already be display-ordered. */
export function resolveHighlightedProjectId(
  list: Project[],
  activeId: number | null,
  currentHighlight: number | null,
): number | null {
  if (activeId == null || list.length === 0) return null;
  if (currentHighlight != null && list.some((p) => p.id === currentHighlight)) {
    return currentHighlight;
  }
  return list[list.length - 1].id;
}

/** Next highlight after ArrowDown / ArrowUp. `list` must already be display-ordered. */
export function moveProjectHighlight(
  list: Project[],
  currentId: number | null,
  direction: 'down' | 'up',
): number | null {
  if (!list.length) return null;
  const idx = list.findIndex((p) => p.id === currentId);
  if (direction === 'down') {
    return (list[(idx < 0 ? -1 : idx) + 1] ?? list[0]).id;
  }
  return (list[(idx < 0 ? list.length : idx) - 1] ?? list[list.length - 1]).id;
}

export function canOpenProjectMenu(input: {
  switching: boolean;
  modalOpen: boolean;
  saving: boolean;
  activeId: number | null;
  projectCount: number;
}): boolean {
  return (
    !input.switching &&
    !input.modalOpen &&
    !input.saving &&
    input.activeId != null &&
    input.projectCount > 0
  );
}
