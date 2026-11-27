import { describe, expect, it } from 'vitest';
import type { ProjectAIConversation } from './api';
import {
  conversationActionsLocked,
  conversationListView,
  conversationRef,
  conversationUpdatedLabel,
  deleteConversationLabel,
  initialConversationTarget,
  isConversationGoneOnSend,
  isConversationSettled,
  removeConversation,
  sameConversation,
  storedInSentConversation,
  upsertConversationFirst,
} from './project-ai-conversations';

const conv = (id: number, title = `会話${id}`): ProjectAIConversation => ({
  id,
  projectId: 1,
  title,
  createdAt: '2026-11-26T00:00:00Z',
  updatedAt: '2026-11-26T00:00:00Z',
});

describe('project-ai-conversations', () => {
  describe('sameConversation', () => {
    it('compares the conversation sent to with the one shown now', () => {
      expect(sameConversation(5, 5)).toBe(true);
      expect(sameConversation(5, 6)).toBe(false);
    });

    it('treats an unsaved new conversation as the same only as another unsaved one', () => {
      expect(sameConversation(null, null)).toBe(true);
      expect(sameConversation(null, 5)).toBe(false);
      expect(sameConversation(5, null)).toBe(false);
    });
  });

  describe('storedInSentConversation', () => {
    it('is true when the answer was stored in the conversation it was sent to', () => {
      expect(storedInSentConversation(5, 5)).toBe(true);
    });

    it('is false for a new conversation: the server may have trimmed others', () => {
      expect(storedInSentConversation(null, 9)).toBe(false);
    });

    it('is false when the conversation sent to was gone and another one was made', () => {
      expect(storedInSentConversation(5, 9)).toBe(false);
    });
  });

  describe('upsertConversationFirst', () => {
    it('adds a new conversation at the top', () => {
      expect(upsertConversationFirst([conv(1), conv(2)], conv(3)).map((c) => c.id)).toEqual([
        3, 1, 2,
      ]);
    });

    it('moves an existing conversation to the top with the new values', () => {
      const list = [conv(1), conv(2), conv(3)];
      const updated = { ...conv(3), updatedAt: '2026-11-27T00:00:00Z' };
      const next = upsertConversationFirst(list, updated);
      expect(next.map((c) => c.id)).toEqual([3, 1, 2]);
      expect(next[0]).toBe(updated);
    });

    it('does not change the given list', () => {
      const list = [conv(1)];
      upsertConversationFirst(list, conv(2));
      expect(list.map((c) => c.id)).toEqual([1]);
    });
  });

  describe('removeConversation', () => {
    it('removes only the given conversation', () => {
      expect(removeConversation([conv(1), conv(2), conv(3)], 2).map((c) => c.id)).toEqual([1, 3]);
    });

    it('keeps the list when the conversation is not in it', () => {
      expect(removeConversation([conv(1)], 9).map((c) => c.id)).toEqual([1]);
    });
  });

  describe('conversationUpdatedLabel', () => {
    it('formats the time in the local time zone down to the minute', () => {
      const local = new Date(2026, 10, 6, 9, 5, 30).toISOString();
      expect(conversationUpdatedLabel(local)).toBe('2026/11/06 09:05');
    });

    it('returns an empty label for a time that cannot be read', () => {
      expect(conversationUpdatedLabel('')).toBe('');
      expect(conversationUpdatedLabel('not a date')).toBe('');
    });
  });

  describe('deleteConversationLabel', () => {
    it('names the conversation that the button deletes', () => {
      expect(deleteConversationLabel(conv(1, '期限が近いものは'))).toBe(
        '会話「期限が近いものは」を削除',
      );
    });
  });

  describe('conversationActionsLocked', () => {
    const idle = { settled: true, sending: false, deleting: false };

    it('allows switching, starting and deleting when nothing is in flight', () => {
      expect(conversationActionsLocked(idle)).toBe(false);
    });

    it('locks while sending, while deleting, and until the shown conversation is settled', () => {
      expect(conversationActionsLocked({ ...idle, sending: true })).toBe(true);
      expect(conversationActionsLocked({ ...idle, deleting: true })).toBe(true);
      expect(conversationActionsLocked({ ...idle, settled: false })).toBe(true);
    });
  });

  describe('conversationListView', () => {
    it('shows the thread when history is closed', () => {
      expect(conversationListView({ historyOpen: false })).toEqual({
        showList: false,
        showThread: true,
      });
    });

    it('shows the list instead of the thread when history is open', () => {
      expect(conversationListView({ historyOpen: true })).toEqual({
        showList: true,
        showThread: false,
      });
    });
  });

  describe('conversationRef', () => {
    it('names a saved conversation by its id and an unsaved one as new', () => {
      expect(conversationRef(5)).toBe(5);
      expect(conversationRef(null)).toBe('new');
    });
  });

  describe('initialConversationTarget', () => {
    it('accepts a positive integer id and new', () => {
      expect(initialConversationTarget(5)).toBe(5);
      expect(initialConversationTarget('new')).toBe('new');
    });

    it('treats nothing and invalid values as not given', () => {
      for (const value of [null, undefined, 0, -1, 1.5, Number.NaN, '5', 'x', {}]) {
        expect(initialConversationTarget(value)).toBeNull();
      }
    });
  });

  describe('isConversationSettled', () => {
    const settled = { loading: false, loadFailed: false, switching: false };

    it('is settled once the first load is over and no switch is running', () => {
      expect(isConversationSettled(settled)).toBe(true);
    });

    it('is not settled during the first load, after its failure, or while switching', () => {
      expect(isConversationSettled({ ...settled, loading: true })).toBe(false);
      expect(isConversationSettled({ ...settled, loadFailed: true })).toBe(false);
      expect(isConversationSettled({ ...settled, switching: true })).toBe(false);
    });
  });

  describe('isConversationGoneOnSend', () => {
    it('is true when sending to a stored conversation answers 404', () => {
      expect(isConversationGoneOnSend(5, { status: 404 })).toBe(true);
    });

    it('is false for a 404 when sending to an unsaved new conversation', () => {
      expect(isConversationGoneOnSend(null, { status: 404 })).toBe(false);
    });

    it('is false for any other failure', () => {
      expect(isConversationGoneOnSend(5, { status: 500 })).toBe(false);
      expect(isConversationGoneOnSend(5, { status: 0 })).toBe(false);
      expect(isConversationGoneOnSend(5, null)).toBe(false);
    });
  });
});
