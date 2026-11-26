import { describe, expect, it } from 'vitest';
import { AI_EXHAUSTED_MESSAGE, AI_UNCONFIGURED_MESSAGE } from './ai-unavailable-copy';
import { COMMENT_BODY_MAX } from './item-comments';
import {
  AI_CHAT_MESSAGE_MAX,
  blockedReasonMessage,
  checkDraft,
  commentApplyError,
  isSendKey,
  sameChatScope,
} from './project-ai-chat-rules';

describe('project-ai-chat-rules', () => {
  describe('sameChatScope', () => {
    const scope = { generation: 3, projectId: 1, userId: 7 };

    it('is the same only when generation, project and user all match', () => {
      expect(sameChatScope(scope, { ...scope })).toBe(true);
      expect(sameChatScope(scope, { ...scope, generation: 4 })).toBe(false);
      expect(sameChatScope(scope, { ...scope, projectId: 2 })).toBe(false);
      expect(sameChatScope(scope, { ...scope, userId: 8 })).toBe(false);
    });

    it('treats a logged-out scope as different from any user', () => {
      expect(sameChatScope(scope, { ...scope, userId: null })).toBe(false);
      expect(sameChatScope({ ...scope, userId: null }, { ...scope, userId: null })).toBe(true);
    });
  });

  describe('checkDraft', () => {
    it('trims the text that is sent', () => {
      expect(checkDraft('  質問\n')).toEqual({ ok: true, text: '質問' });
    });

    it('rejects an empty or blank draft', () => {
      expect(checkDraft('')).toEqual({ ok: false, error: 'メッセージを入力してください。' });
      expect(checkDraft(' \n\t　')).toEqual({ ok: false, error: 'メッセージを入力してください。' });
    });

    it('counts characters, not UTF-16 units, against the limit', () => {
      const atLimit = '😀'.repeat(AI_CHAT_MESSAGE_MAX);
      expect(checkDraft(atLimit)).toEqual({ ok: true, text: atLimit });
      expect(checkDraft(atLimit + 'a')).toEqual({
        ok: false,
        error: `メッセージは${AI_CHAT_MESSAGE_MAX}文字以内にしてください。`,
      });
    });

    it('measures the limit after trimming', () => {
      const text = 'a'.repeat(AI_CHAT_MESSAGE_MAX);
      expect(checkDraft(`  ${text}  `)).toEqual({ ok: true, text });
    });
  });

  describe('commentApplyError', () => {
    it('allows a body up to the comment limit', () => {
      expect(commentApplyError('')).toBe('');
      expect(commentApplyError('あ'.repeat(COMMENT_BODY_MAX))).toBe('');
    });

    it('explains how to add a longer answer', () => {
      expect(commentApplyError('あ'.repeat(COMMENT_BODY_MAX + 1))).toBe(
        `コメントは${COMMENT_BODY_MAX}文字以内にしてください。長い応答は分割して追加してください。`,
      );
    });
  });

  describe('isSendKey', () => {
    const enter = { key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 };

    it('sends on a plain Enter', () => {
      expect(isSendKey(enter)).toBe(true);
    });

    it('keeps Shift+Enter for a line break', () => {
      expect(isSendKey({ ...enter, shiftKey: true })).toBe(false);
    });

    it('does not send while an IME composition is confirmed', () => {
      expect(isSendKey({ ...enter, isComposing: true })).toBe(false);
      expect(isSendKey({ ...enter, keyCode: 229 })).toBe(false);
    });

    it('ignores other keys', () => {
      expect(isSendKey({ ...enter, key: 'a', keyCode: 65 })).toBe(false);
    });
  });

  describe('blockedReasonMessage', () => {
    it('maps each reason to its message and nothing to an empty string', () => {
      expect(blockedReasonMessage('unconfigured')).toBe(AI_UNCONFIGURED_MESSAGE);
      expect(blockedReasonMessage('exhausted')).toBe(AI_EXHAUSTED_MESSAGE);
      expect(blockedReasonMessage(null)).toBe('');
    });
  });
});
