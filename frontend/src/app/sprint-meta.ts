import { SPRINT_GOAL_MAX_SCALARS, SPRINT_NAME_MAX, unicodeScalarLength } from './models';

export function validateSprintGoalScalars(goal: string): boolean {
  return unicodeScalarLength(goal) <= SPRINT_GOAL_MAX_SCALARS;
}

export function validateSprintMetaForSave(
  name: string,
  goal: string,
  startDate: string,
  endDate: string,
): string {
  const trimmed = name.trim();
  if (!trimmed || [...trimmed].length > SPRINT_NAME_MAX) {
    return '名称を1〜120文字で入力してください。';
  }
  if (!validateSprintGoalScalars(goal)) {
    return `ゴールは${SPRINT_GOAL_MAX_SCALARS}文字以内にしてください。`;
  }
  if (!startDate || !endDate || startDate > endDate) {
    return '開始日は終了日以前にしてください。';
  }
  return '';
}