import { Project } from './models';

/** Same order as ProjectSession.sortProjects; kept local so this module stays Angular-free for unit tests. */
function sortByPosition(list: Project[]): Project[] {
  return [...list].sort((a, b) => a.position - b.position || a.id - b.id);
}

/** Display order for the header project listbox: active first, then position order. */
export function projectsForSelectDisplay(
  projects: Project[],
  activeId: number | null,
): Project[] {
  const sorted = sortByPosition(projects);
  if (activeId == null) return sorted;
  const current = sorted.find((p) => p.id === activeId);
  if (!current) return sorted;
  return [current, ...sorted.filter((p) => p.id !== activeId)];
}
