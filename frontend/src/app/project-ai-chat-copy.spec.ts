import { describe, expect, it } from 'vitest';
import { applyCommentConfirm, applyDescriptionConfirm } from './project-ai-chat-copy';

describe('project-ai-chat-copy', () => {
  const item = { number: 12, title: 'ログインの修正' };

  it('names the target item and warns in the description confirm', () => {
    expect(applyDescriptionConfirm(item)).toBe(
      '#12 ログインの修正 の説明をこの内容で置き換えますか？ 回答には、ほかのアイテムの内容が含まれていることがあります。',
    );
  });

  it('names the target item and warns in the comment confirm', () => {
    expect(applyCommentConfirm(item)).toBe(
      '#12 ログインの修正 にこの内容をコメントとして追加しますか？ 回答には、ほかのアイテムの内容が含まれていることがあります。',
    );
  });
});
