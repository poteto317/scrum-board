import { describe, expect, it } from 'vitest';
import {
  isAiChatRoute,
  optionKey,
  resolveTarget,
  sameTarget,
  selectableCandidates,
  toAiChatOptions,
  type AiChatTarget,
  type AiChatTargetOption,
} from './ai-chat-target';
import type { Item } from './models';

const t = (n: number, partial: Partial<AiChatTargetOption> = {}): AiChatTargetOption => ({
  number: n,
  projectId: 1,
  itemId: n * 10,
  title: `T${n}`,
  canEdit: true,
  ...partial,
});

describe('ai-chat-target', () => {
  it('detects board backlog and item detail routes', () => {
    expect(isAiChatRoute('/')).toBe(true);
    expect(isAiChatRoute('/?project=1')).toBe(true);
    expect(isAiChatRoute('/backlog')).toBe(true);
    expect(isAiChatRoute('/items/12')).toBe(true);
    expect(isAiChatRoute('/items/12/solution')).toBe(false);
    expect(isAiChatRoute('/settings')).toBe(false);
    expect(isAiChatRoute('/sprints')).toBe(false);
  });

  it('filters selectable candidates to canEdit', () => {
    expect(selectableCandidates([t(1), t(2, { canEdit: false })]).map((c) => c.number)).toEqual([
      1,
    ]);
  });

  it('maps items to options via canEditItem', () => {
    const user = {
      id: 1,
      loginName: 'u',
      displayName: 'U',
      role: 'member' as const,
      disabled: false,
    };
    const items = [
      { id: 10, number: 1, projectId: 1, title: 'A', canEdit: true },
      { id: 20, number: 2, projectId: 1, title: 'B', canEdit: false },
    ] as Item[];
    expect(toAiChatOptions(items, user)).toEqual([
      { number: 1, projectId: 1, itemId: 10, title: 'A', canEdit: true },
      { number: 2, projectId: 1, itemId: 20, title: 'B', canEdit: false },
    ]);
  });

  it('resolves detail from routeTarget', () => {
    const route: AiChatTarget = { number: 5, projectId: 1, itemId: 50 };
    expect(
      resolveTarget({
        pageKind: 'detail',
        routeTarget: route,
        selected: t(9),
        candidates: [],
      }),
    ).toEqual(route);
  });

  it('clears board selection when no longer selectable', () => {
    const selected = t(3);
    expect(
      resolveTarget({
        pageKind: 'board',
        routeTarget: null,
        selected,
        candidates: [t(3, { canEdit: false })],
      }),
    ).toBeNull();
    expect(
      resolveTarget({
        pageKind: 'board',
        routeTarget: null,
        selected,
        candidates: [t(3)],
      }),
    ).toEqual(selected);
  });

  it('compares targets by number projectId itemId', () => {
    expect(sameTarget(t(1), t(1))).toBe(true);
    expect(sameTarget(t(1), t(1, { itemId: 99 }))).toBe(false);
    expect(optionKey(t(1))).toBe('1:1:10');
  });
});
