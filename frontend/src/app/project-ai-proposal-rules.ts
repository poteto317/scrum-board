import { isNotFound } from './api-error';
import type { ProjectAIMessage, ProjectAIProposal } from './api';
import type { Item, ItemInput, ItemPatch } from './models';

/** 提案の見出し・判断・文言（純粋な関数）。画面は project-ai-proposal-card.ts */

/** 表示時に対象のアイテムを読んだ結果 */
export type ItemCheck =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'loaded'; item: Item }
  | { kind: 'failed'; message: string };

/** 適用の直前の判断 */
export type ProposalPrecheck =
  | { kind: 'apply' }
  | { kind: 'stale'; message: string }
  | { kind: 'blocked'; message: string };

export const proposalCopy = {
  stale: '提案のあとで説明が変わりました。最新の説明との差分を表示しています。この提案は適用できません。',
  notEditable: 'このアイテムを編集する権限がありません。',
  archived: 'アーカイブ済みのため変更できません。',
  notFound: 'アイテムが見つかりません。',
  loadFailed: 'アイテムを確認できませんでした。もう一度お試しください。',
  alreadyHandled: 'この提案は既に処理されています。',
  releaseFailed: '（提案の状態を戻せませんでした。再読み込みしてください。）',
  applied: '適用しました。',
  dismissed: '破棄しました。',
  applying: '適用中…',
} as const;

function target(p: ProjectAIProposal): string {
  return `#${p.itemNumber ?? ''} ${p.itemTitle ?? ''}`.trim();
}

/** カードの見出し */
export function proposalHeading(p: ProjectAIProposal): string {
  switch (p.kind) {
    case 'status_change':
      return `ステータスの変更: ${target(p)} → ${p.columnName ?? ''}`;
    case 'description_edit':
      return `説明の編集: ${target(p)}`;
    case 'item_create':
      return `アイテムの作成（${p.columnName ?? 'Todo'}）: ${p.title ?? ''}`;
  }
}

function action(p: ProjectAIProposal): string {
  switch (p.kind) {
    case 'status_change':
      return `#${p.itemNumber} のステータスの変更`;
    case 'description_edit':
      return `#${p.itemNumber} の説明の編集`;
    case 'item_create':
      return `アイテム「${p.title ?? ''}」の作成`;
  }
}

/** 「適用」ボタンの読み上げ（対象を含める） */
export function applyLabel(p: ProjectAIProposal): string {
  return `${action(p)}を適用`;
}

/** 「破棄」ボタンの読み上げ（対象を含める） */
export function dismissLabel(p: ProjectAIProposal): string {
  return `${action(p)}を破棄`;
}

/** 対象のアイテムを読む提案か（作成は対象が無い） */
export function proposalTargetsItem(p: ProjectAIProposal): boolean {
  return p.kind !== 'item_create' && typeof p.itemNumber === 'number';
}

/** 読んだアイテムから、適用できない理由（無ければ null）。canEdit は省略も「できない」 */
export function proposalBlockReason(p: ProjectAIProposal, item: Item): string | null {
  if (!proposalTargetsItem(p)) return null;
  if (item.canEdit !== true) return proposalCopy.notEditable;
  if (item.archivedAt) return proposalCopy.archived;
  return null;
}

/** 説明の比較では、無い説明を空文字として扱う */
function descriptionOf(value: string | null | undefined): string {
  return value ?? '';
}

/** 適用の直前の判断。説明の編集は、提案のときの説明と今の説明が違えば stale */
export function proposalPrecheck(p: ProjectAIProposal, item: Item): ProposalPrecheck {
  const blocked = proposalBlockReason(p, item);
  if (blocked) return { kind: 'blocked', message: blocked };
  if (p.kind === 'description_edit' && descriptionOf(item.description) !== descriptionOf(p.baseDescription)) {
    return { kind: 'stale', message: proposalCopy.stale };
  }
  return { kind: 'apply' };
}

/** アイテムを読めなかったときの文言（404 とそれ以外を分ける） */
export function loadFailureMessage(err: unknown): string {
  return isNotFound(err) ? proposalCopy.notFound : proposalCopy.loadFailed;
}

/** 差分の基準にする説明: 読めた今の説明、まだ読めていなければ提案のときの説明 */
export function diffBase(p: ProjectAIProposal, check: ItemCheck): string {
  return check.kind === 'loaded' ? descriptionOf(check.item.description) : descriptionOf(p.baseDescription);
}

/** 表示時の確認から、適用できない理由（無ければ null）。読み込み中は押せる（押したときに確かめる） */
export function checkBlockReason(p: ProjectAIProposal, check: ItemCheck): string | null {
  switch (check.kind) {
    case 'loaded': {
      const pre = proposalPrecheck(p, check.item);
      return pre.kind === 'apply' ? null : pre.message;
    }
    case 'failed':
      return check.message;
    default:
      return null;
  }
}

/** 作成の結果の文言のうち、番号の後ろ（画面は番号をリンクにする） */
export const createdSuffix = ' を作成しました。';

/** 作成の結果の文言 */
export function createdMessage(number: number, recorded: boolean): string {
  return recorded ? `#${number}${createdSuffix}` : `#${number} を作成しました（結果の記録に失敗しました）。`;
}

/** messages の中の同じ ID の提案を置き換えた新しい配列（無ければそのまま） */
export function replaceProposal(messages: ProjectAIMessage[], proposal: ProjectAIProposal): ProjectAIMessage[] {
  let changed = false;
  const out = messages.map((m) => {
    if (m.id !== proposal.messageId || !m.proposals?.some((p) => p.id === proposal.id)) return m;
    changed = true;
    return { ...m, proposals: m.proposals.map((p) => (p.id === proposal.id ? proposal : p)) };
  });
  return changed ? out : messages;
}

/** 適用で呼ぶアイテムの API。更新は、適用の直前に読んだアイテムの id を使う */
export type ProposalItemRequest =
  | { kind: 'update'; itemId: number; patch: ItemPatch }
  | { kind: 'create'; input: ItemInput };

/** 提案から、適用で呼ぶアイテムの API を決める。対象を読む提案で item が無ければ null */
export function proposalItemRequest(p: ProjectAIProposal, item: Item | null, projectId: number): ProposalItemRequest | null {
  switch (p.kind) {
    case 'status_change':
      return item && p.columnId != null ? { kind: 'update', itemId: item.id, patch: { columnId: p.columnId } } : null;
    case 'description_edit':
      return item ? { kind: 'update', itemId: item.id, patch: { description: p.description ?? '' } } : null;
    case 'item_create':
      return p.columnId != null
        ? { kind: 'create', input: { title: p.title ?? '', description: p.description ?? '', columnId: p.columnId, projectId } }
        : null;
  }
}
