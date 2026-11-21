import { canEditItem } from './item-acl';
import type { Item } from './models';
import type { UserPublic } from './auth';

export type AiChatTarget = {
  number: number;
  projectId: number;
  itemId: number;
};

export type AiChatTargetOption = AiChatTarget & {
  title: string;
  canEdit: boolean;
};

export type AiChatPageKind = 'board' | 'backlog' | 'detail' | 'other';

/** Item 一覧 → ピッカー候補（canEdit は canEditItem 固定） */
export function toAiChatOptions(
  items: readonly Item[],
  user: UserPublic | null,
): AiChatTargetOption[] {
  return items.map((card) => ({
    number: card.number,
    projectId: card.projectId,
    itemId: card.id,
    title: card.title,
    canEdit: canEditItem(card, user),
  }));
}

/** ボード・バックログ・アイテム詳細（solution 除く） */
export function isAiChatRoute(url: string): boolean {
  const path = url.split('?')[0] || '/';
  if (path === '/' || path === '') return true;
  if (path === '/backlog') return true;
  if (/^\/items\/\d+$/.test(path)) return true;
  return false;
}

export function selectableCandidates(opts: AiChatTargetOption[]): AiChatTargetOption[] {
  return opts.filter((o) => o.canEdit);
}

export function sameTarget(a: AiChatTarget | null, b: AiChatTarget | null): boolean {
  if (!a || !b) return a === b;
  return a.number === b.number && a.projectId === b.projectId && a.itemId === b.itemId;
}

export function resolveTarget(args: {
  pageKind: AiChatPageKind;
  routeTarget: AiChatTarget | null;
  selected: AiChatTarget | null;
  candidates: AiChatTargetOption[];
}): AiChatTarget | null {
  const { pageKind, routeTarget, selected, candidates } = args;
  if (pageKind === 'detail') return routeTarget;
  if (pageKind === 'board' || pageKind === 'backlog') {
    if (!selected) return null;
    const ok = selectableCandidates(candidates).some(
      (c) =>
        c.number === selected.number &&
        c.projectId === selected.projectId &&
        c.itemId === selected.itemId,
    );
    return ok ? selected : null;
  }
  return null;
}

export function optionKey(o: AiChatTarget): string {
  return `${o.projectId}:${o.number}:${o.itemId}`;
}
