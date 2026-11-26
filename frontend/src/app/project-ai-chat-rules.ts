import type { BlockedReason } from './ai-credits-state';
import { AI_EXHAUSTED_MESSAGE, AI_UNCONFIGURED_MESSAGE } from './ai-unavailable-copy';
import { COMMENT_BODY_MAX } from './item-comments';

/** プロジェクトの AI チャットの判定（DOM・API・signal に触れない） */

export const AI_CHAT_MESSAGE_MAX = 4000;

/** 履歴の持ち主。どれかが変わったら、進行中の応答は別の履歴のもの */
export type ChatScope = { generation: number; projectId: number; userId: number | null };

export function sameChatScope(a: ChatScope, b: ChatScope): boolean {
  return a.generation === b.generation && a.projectId === b.projectId && a.userId === b.userId;
}

/** 送る本文（前後の空白を除いたもの）か、送れない理由 */
export type DraftCheck = { ok: true; text: string } | { ok: false; error: string };

export function checkDraft(draft: string): DraftCheck {
  const text = draft.trim();
  if (!text) return { ok: false, error: 'メッセージを入力してください。' };
  if ([...text].length > AI_CHAT_MESSAGE_MAX) {
    return { ok: false, error: `メッセージは${AI_CHAT_MESSAGE_MAX}文字以内にしてください。` };
  }
  return { ok: true, text };
}

/** 回答をコメントにできない理由。できるなら空文字 */
export function commentApplyError(body: string): string {
  if ([...body].length <= COMMENT_BODY_MAX) return '';
  return `コメントは${COMMENT_BODY_MAX}文字以内にしてください。長い応答は分割して追加してください。`;
}

/** 入力欄で送信になるキーか（Shift+Enter は改行、変換の確定の Enter は送らない） */
export function isSendKey(
  e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'isComposing' | 'keyCode'>,
): boolean {
  if (e.key !== 'Enter' || e.shiftKey) return false;
  return !(e.isComposing || e.keyCode === 229);
}

/** 入力を止めている理由の文言。止めていなければ空文字 */
export function blockedReasonMessage(reason: BlockedReason | null): string {
  if (reason === 'unconfigured') return AI_UNCONFIGURED_MESSAGE;
  if (reason === 'exhausted') return AI_EXHAUSTED_MESSAGE;
  return '';
}
