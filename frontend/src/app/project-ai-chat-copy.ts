import type { AiChatFocusItem } from './ai-chat-target';

export const PROJECT_AI_CHAT_EMPTY_MESSAGE = 'このプロジェクトについて質問できます。';
export const PROJECT_AI_CHAT_SENDING_MESSAGE = '調べています…';
export const PROJECT_AI_CHAT_CLEAR_CONFIRM =
  'このプロジェクトでの自分の AI チャット履歴を削除しますか？';

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
