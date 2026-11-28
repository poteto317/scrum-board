import type { UserPublic } from './auth';
import { canEditItem } from './item-acl';
import { Item, Sprint, SprintItemRef, SprintPatch } from './models';
import { itemsForActiveProject } from './project-items';
import { validateSprintGoalScalars } from './sprint-meta';

export { validateSprintGoalScalars, validateSprintMetaForSave } from './sprint-meta';

export type SprintMetaDraft = {
  name: string;
  goal: string;
  startDate: string;
  endDate: string;
  velocity: string;
};

export function sprintMetaDraftFromSprint(sprint: Sprint): SprintMetaDraft {
  return {
    name: sprint.name,
    goal: sprint.goal ?? '',
    startDate: sprint.startDate,
    endDate: sprint.endDate,
    velocity: sprint.velocity == null ? '' : String(sprint.velocity),
  };
}

/** True when meta drafts differ from persisted sprint (incl. velocity draft). */
export function isSprintMetaDirty(sprint: Sprint, draft: SprintMetaDraft): boolean {
  const name = draft.name.trim();
  if (name !== sprint.name) return true;
  if (draft.goal !== (sprint.goal ?? '')) return true;
  if (draft.startDate !== sprint.startDate) return true;
  if (draft.endDate !== sprint.endDate) return true;
  const vel = draft.velocity.trim();
  const saved = sprint.velocity == null ? '' : String(sprint.velocity);
  return vel !== saved;
}

/** Empty string when valid; otherwise user-facing error (matches saveMeta). */
export const SPRINT_VELOCITY_INPUT_ERROR = 'ベロシティは0以上の整数で入力してください。';

export type SprintVelocityParseResult =
  | { ok: true; velocity: number | null }
  | { ok: false; error: string };

/** Empty draft → null velocity; otherwise non-negative integer (saveVelocity). */
export function parseOptionalSprintVelocityInput(raw: string): SprintVelocityParseResult {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { ok: true, velocity: null };
  }
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0) {
    return { ok: false, error: SPRINT_VELOCITY_INPUT_ERROR };
  }
  return { ok: true, velocity: n };
}

export type SprintCompleteVelocityResult =
  | { ok: true; velocity: number }
  | { ok: false; error: string };

/** Required non-negative integer (confirmComplete). */
export function validateSprintCompleteVelocity(raw: unknown): SprintCompleteVelocityResult {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    return { ok: false, error: SPRINT_VELOCITY_INPUT_ERROR };
  }
  return { ok: true, velocity: n };
}

export function buildSprintMetaPatch(sprint: Sprint, draft: SprintMetaDraft): SprintPatch | null {
  const name = draft.name.trim();
  const patch: SprintPatch = {};
  if (name !== sprint.name) patch.name = name;
  if (draft.goal !== (sprint.goal ?? '')) patch.goal = draft.goal;
  if (draft.startDate !== sprint.startDate) patch.startDate = draft.startDate;
  if (draft.endDate !== sprint.endDate) patch.endDate = draft.endDate;
  if (Object.keys(patch).length === 0) return null;
  return patch;
}

function memberAsCandidateItem(member: SprintItemRef, projectId: number): Item {
  return {
    id: member.id,
    number: member.number,
    title: member.title,
    projectId,
    columnId: member.columnId,
    description: '',
    solution: '',
    position: 0,
    backlogPosition: 0,
    offsetY: 0,
    prUrls: [],
    relatedItems: [],
    labels: [],
    assignee: '',
    closeReason: '',
    favorite: false,
    dueAt: null,
    createdAt: '',
    updatedAt: '',
    canEdit: true,
  };
}

export function buildSprintMemberCandidates(
  boardItems: Item[],
  activeProjectId: number | null,
  sprint: Sprint,
  user: UserPublic | null,
): Item[] {
  const inProject = itemsForActiveProject(boardItems, activeProjectId ?? sprint.projectId);
  const editable = inProject.filter((item) => canEditItem(item, user));
  const byId = new Map(editable.map((i) => [i.id, i]));
  for (const member of sprint.items ?? []) {
    if (!byId.has(member.id)) {
      byId.set(member.id, memberAsCandidateItem(member, sprint.projectId));
    }
  }
  return [...byId.values()].sort((a, b) => a.number - b.number);
}