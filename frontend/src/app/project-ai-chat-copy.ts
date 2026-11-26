import type { AiChatFocusItem } from './ai-chat-target';

export const PROJECT_AI_CHAT_EMPTY_MESSAGE = 'このプロジェクトについて質問できます。';
export const PROJECT_AI_CHAT_SENDING_MESSAGE = '調べています…';
export const PROJECT_AI_CONVERSATION_DELETE_CONFIRM = 'この会話を削除しますか？';
export const PROJECT_AI_CONVERSATION_NOT_FOUND = '会話が見つかりません。';
/** 表示中の会話が、別のタブでの削除や上限の刈り込みで消えていたとき */
export const PROJECT_AI_CONVERSATION_GONE_ON_SEND =
  'この会話は見つかりませんでした。新しい会話として送り直せます。';
export const PROJECT_AI_CONVERSATIONS_EMPTY_MESSAGE = '会話はまだありません。';
/** 空の新しい会話を始めるボタン */
export const PROJECT_AI_NEW_CONVERSATION_LABEL = '新しい会話';

/** 履歴はプロジェクト全体なので、別のアイテムについての回答にも反映のボタンが出る */
const OTHER_ITEMS_NOTICE = '回答には、ほかのアイテムの内容が含まれていることがあります。';

function itemLabel(item: Pick<AiChatFocusItem, 'number' | 'title'>): string {
  return `#${item.number} ${item.title}`;
}

export function applyDescriptionConfirm(item: Pick<AiChatFocusItem, 'number' | 'title'>): string {
  return `${itemLabel(item)} の説明をこの内容で置き換えますか？ ${OTHER_ITEMS_NOTICE}`;
}

export function applyCommentConfirm(item: Pick<AiChatFocusItem, 'number' | 'title'>): string {
  return `${itemLabel(item)} にこの内容をコメントとして追加しますか？ ${OTHER_ITEMS_NOTICE}`;
}
