import type { ConversationRef, ProjectAIConversation } from './api';
import { isNotFound } from './api-error';

/** AI チャットの会話の判定と表示（DOM・API・signal に触れない） */

/**
 * 送ったときの会話と、いま表示中の会話が同じか（null は、まだ保存されていない新しい会話）。
 * 応答の conversation.id とは比べない: 新しい会話への送信では、応答の ID は送った ID と違う。
 */
export function sameConversation(sent: number | null, current: number | null): boolean {
  return sent === current;
}

/**
 * 回答が、送った先の会話に保存されたか。違うとき（新しい会話、または、待つ間に送った先が
 * 消されて新しく作られた）は、サーバーが会話を作っている。そのとき、上限を超えた会話や
 * 送った先の会話は消えているので、手元の一覧は書き換えずに読み直す。
 */
export function storedInSentConversation(sent: number | null, stored: number): boolean {
  return sent === stored;
}

/** その会話を一覧の先頭に置く（無ければ足す） */
export function upsertConversationFirst(
  list: readonly ProjectAIConversation[],
  conversation: ProjectAIConversation,
): ProjectAIConversation[] {
  return [conversation, ...removeConversation(list, conversation.id)];
}

export function removeConversation(
  list: readonly ProjectAIConversation[],
  conversationId: number,
): ProjectAIConversation[] {
  return list.filter((c) => c.id !== conversationId);
}

/** 最後に更新した日時（端末の時刻で、分まで）。読めなければ空文字 */
export function conversationUpdatedLabel(updatedAt: string): string {
  const at = new Date(updatedAt);
  if (!updatedAt || Number.isNaN(at.getTime())) return '';
  const two = (n: number) => String(n).padStart(2, '0');
  const day = `${at.getFullYear()}/${two(at.getMonth() + 1)}/${two(at.getDate())}`;
  return `${day} ${two(at.getHours())}:${two(at.getMinutes())}`;
}

/** 一覧の「削除」が、どの会話を消すのかを伝えるラベル */
export function deleteConversationLabel(conversation: Pick<ProjectAIConversation, 'title'>): string {
  return `会話「${conversation.title}」を削除`;
}

/**
 * 会話の切り替え・新しい会話・削除を押せなくするか。
 * 応答が別の会話の表示に入らないよう、送信中・削除中と、表示中の会話が決まるまで
 * （最初の読み込み中、その失敗の後、切り替え中）は押せない。
 */
export function conversationActionsLocked(state: {
  settled: boolean;
  sending: boolean;
  deleting: boolean;
}): boolean {
  return !state.settled || state.sending || state.deleting;
}

/**
 * 一覧とやりとりのどちらを出すか。
 * 履歴トグルが開いているときだけ一覧を出し、それ以外はやりとり（スレッド）を出す。
 */
export function conversationListView(state: {
  historyOpen: boolean;
}): { showList: boolean; showThread: boolean } {
  return {
    showList: state.historyOpen,
    showThread: !state.historyOpen,
  };
}

export function conversationRef(conversationId: number | null): ConversationRef {
  return conversationId ?? 'new';
}

/** 最初に開く会話の指定。不正な値（数値でない、0 以下）は、無いものとして扱う */
export function initialConversationTarget(value: unknown): ConversationRef | null {
  if (value === 'new') return 'new';
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * 表示中の会話が決まっているか。最初の読み込み中、その失敗の後、会話の切り替え中は
 * 決まっていない（その間は送れず、会話の操作も押せない）。
 */
export function isConversationSettled(state: {
  loading: boolean;
  loadFailed: boolean;
  switching: boolean;
}): boolean {
  return !state.loading && !state.loadFailed && !state.switching;
}

/**
 * 送信の失敗が「送った先の会話がもう無い」か（別のタブでの削除や、上限の刈り込み）。
 * 保存されていない新しい会話（sentTo が null）への送信の 404 は、会話のことではない。
 */
export function isConversationGoneOnSend(sentTo: number | null, error: unknown): boolean {
  return sentTo != null && isNotFound(error);
}
