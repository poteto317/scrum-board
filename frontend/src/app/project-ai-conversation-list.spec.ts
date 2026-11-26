import { Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectAIConversation } from './api';
import { ProjectAiConversationList } from './project-ai-conversation-list';

const conv = (id: number): ProjectAIConversation => ({
  id,
  projectId: 1,
  title: `会話${id}`,
  createdAt: '2026-11-26T00:00:00Z',
  updatedAt: '2026-11-26T00:00:00Z',
});

const always = () => true;

function listOf(listProjectAIConversations: ReturnType<typeof vi.fn>) {
  return new ProjectAiConversationList({ listProjectAIConversations } as never);
}

describe('ProjectAiConversationList', () => {
  it('starts as loading with no conversations, before anything is read', () => {
    const list = listOf(vi.fn());
    expect(list.state()).toBe('loading');
    expect(list.conversations()).toEqual([]);
    expect(list.error()).toBe('');
  });

  it('reads the conversations of the given project', () => {
    const api = vi.fn(() => of([conv(2), conv(1)]));
    const list = listOf(api);
    list.load(7, always);
    expect(api).toHaveBeenCalledWith(7);
    expect(list.state()).toBe('ready');
    expect(list.conversations().map((c) => c.id)).toEqual([2, 1]);
  });

  it('is loading until the response arrives, and ready with zero conversations after it', () => {
    const res = new Subject<ProjectAIConversation[]>();
    const list = listOf(vi.fn(() => res));
    list.load(1, always);
    expect(list.state()).toBe('loading');
    res.next([]);
    expect(list.state()).toBe('ready');
    expect(list.conversations()).toEqual([]);
  });

  it('keeps the failure apart from an empty list, and clears it on the next load', () => {
    const api = vi
      .fn()
      .mockReturnValueOnce(
        throwError(() => ({ status: 500, error: { message: '失敗しました。' } })),
      )
      .mockReturnValueOnce(of([conv(1)]));
    const list = listOf(api);
    list.load(1, always);
    expect(list.state()).toBe('error');
    expect(list.error()).toBe('失敗しました。');
    list.load(1, always);
    expect(list.state()).toBe('ready');
    expect(list.error()).toBe('');
    expect(list.conversations().map((c) => c.id)).toEqual([1]);
  });

  it('drops a response the caller no longer wants (success and failure)', () => {
    const ok = new Subject<ProjectAIConversation[]>();
    const failing = new Subject<ProjectAIConversation[]>();
    let wanted = true;
    const list = listOf(vi.fn().mockReturnValueOnce(ok).mockReturnValueOnce(failing));
    list.load(1, () => wanted);
    wanted = false;
    ok.next([conv(1)]);
    expect(list.state()).toBe('loading');
    expect(list.conversations()).toEqual([]);

    wanted = true;
    list.load(1, () => wanted);
    wanted = false;
    failing.error({ status: 500 });
    expect(list.state()).toBe('loading');
    expect(list.error()).toBe('');
  });

  it('cancels the load before it when a new one starts', () => {
    const first = new Subject<ProjectAIConversation[]>();
    const second = new Subject<ProjectAIConversation[]>();
    const list = listOf(vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second));
    list.load(1, always);
    list.load(1, always);
    expect(first.observed).toBe(false);
    second.next([conv(2)]);
    expect(list.conversations().map((c) => c.id)).toEqual([2]);
  });

  describe('patch', () => {
    it('rewrites a list that was read', () => {
      const list = listOf(vi.fn(() => of([conv(1), conv(2)])));
      list.load(1, always);
      expect(list.patch((l) => l.filter((c) => c.id !== 1))).toBe(true);
      expect(list.conversations().map((c) => c.id)).toEqual([2]);
      expect(list.state()).toBe('ready');
    });

    it('does not rewrite a list that is still loading', () => {
      const list = listOf(vi.fn(() => new Subject<ProjectAIConversation[]>()));
      list.load(1, always);
      expect(list.patch(() => [conv(9)])).toBe(false);
      expect(list.conversations()).toEqual([]);
      expect(list.state()).toBe('loading');
    });

    it('does not rewrite a list that failed to load', () => {
      const list = listOf(vi.fn(() => throwError(() => ({ status: 500 }))));
      list.load(1, always);
      expect(list.patch(() => [conv(9)])).toBe(false);
      expect(list.conversations()).toEqual([]);
      expect(list.state()).toBe('error');
    });

    it('lets a patched list win over a response of a load started before the patch', () => {
      // 同期で返る 1 回目で「読めた」にした後、2 回目の応答を待たせる代わりに、
      // 購読を保ったまま後から値を流せる Observable を使う
      let emitLate: (list: ProjectAIConversation[]) => void = () => undefined;
      const late = {
        subscribe(observer: { next: (list: ProjectAIConversation[]) => void }) {
          observer.next([conv(1)]);
          emitLate = (l) => observer.next(l);
          return { unsubscribe: () => undefined };
        },
      };
      const list = listOf(vi.fn(() => late));
      list.load(1, always);
      expect(list.patch((l) => [conv(3), ...l])).toBe(true);
      emitLate([conv(1)]);
      expect(list.conversations().map((c) => c.id)).toEqual([3, 1]);
    });
  });

  it('reset drops a running load and goes back to an empty loading list', () => {
    const res = new Subject<ProjectAIConversation[]>();
    const list = listOf(
      vi
        .fn()
        .mockReturnValueOnce(of([conv(1)]))
        .mockReturnValueOnce(res),
    );
    list.load(1, always);
    list.load(1, always);
    list.reset();
    expect(res.observed).toBe(false);
    expect(list.conversations()).toEqual([]);
    expect(list.state()).toBe('loading');
    expect(list.error()).toBe('');
    expect(list.patch(() => [conv(9)])).toBe(false);
  });

  it('cancel drops a running load without touching what is shown', () => {
    const res = new Subject<ProjectAIConversation[]>();
    const list = listOf(
      vi
        .fn()
        .mockReturnValueOnce(of([conv(1)]))
        .mockReturnValueOnce(res),
    );
    list.load(1, always);
    list.load(1, always);
    list.cancel();
    expect(res.observed).toBe(false);
    expect(list.conversations().map((c) => c.id)).toEqual([1]);
    expect(list.state()).toBe('loading');
  });
});
