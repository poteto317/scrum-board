import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiChatFocusItem } from './ai-chat-target';
import {
  Api,
  AICredits,
  ProjectAIChatPostResponse,
  ProjectAIChatView,
  ProjectAIConversation,
  ProjectAIConversationView,
  ProjectAIMessage,
  ProjectAIProposal,
} from './api';
import {
  AI_EXHAUSTED_MESSAGE,
  AI_LOW_REMAINING_MESSAGE,
  AI_UNCONFIGURED_MESSAGE,
} from './ai-unavailable-copy';
import { AuthSession } from './auth-session';
import { ProjectAiChat } from './project-ai-chat';
import type { ConversationRef } from './api';

const c5: ProjectAIConversation = {
  id: 5,
  projectId: 1,
  title: '要約して',
  createdAt: '2026-11-21T00:00:00Z',
  updatedAt: '2026-11-21T00:00:01Z',
};
const c4: ProjectAIConversation = { ...c5, id: 4, title: '期限が近いものは' };
const c9: ProjectAIConversation = { ...c5, id: 9, title: '新しい話題' };
const m1: ProjectAIMessage = {
  id: 1,
  projectId: 1,
  conversationId: 5,
  role: 'user',
  body: '要約して',
  createdAt: '2026-11-21T00:00:00Z',
};
const m2: ProjectAIMessage = {
  id: 2,
  projectId: 1,
  conversationId: 5,
  role: 'assistant',
  body: '要約です',
  createdAt: '2026-11-21T00:00:01Z',
};
const m3: ProjectAIMessage = { ...m2, id: 3, conversationId: 4, body: '別の履歴' };
const m9: ProjectAIMessage = { ...m2, id: 9, conversationId: 9, body: '新しい回答' };
/** いちばん新しい会話（c5）とそのやりとり */
const latest: ProjectAIChatView = { conversation: c5, messages: [m1, m2] };
const noChat: ProjectAIChatView = { conversation: null, messages: [] };
const otherChat: ProjectAIChatView = { conversation: c4, messages: [m3] };
const older: ProjectAIConversationView = { conversation: c4, messages: [m3] };
const posted: ProjectAIChatPostResponse = { conversation: c5, assistant: m2, messages: [m1, m2] };
const postedNew: ProjectAIChatPostResponse = { conversation: c9, assistant: m9, messages: [m9] };

const httpError = (status: number, message?: string) =>
  throwError(() => ({ status, error: message ? { message } : {} }));

const okCredits: AICredits = {
  limitTokens: null,
  usedTokens: 0,
  remainingTokens: null,
  unlimited: true,
  approximate: true,
  period: 'cumulative',
  configured: true,
};

const focus: AiChatFocusItem = { number: 3, itemId: 10, title: 'ログインの修正', canEdit: true };

type User = { id: number; loginName: string; displayName: string; role: string; disabled: boolean };
const userOf = (id: number): User => ({
  id,
  loginName: `u${id}`,
  displayName: `U${id}`,
  role: 'member',
  disabled: false,
});

type Stub = ReturnType<typeof vi.fn>;

function setup(
  api: {
    getLatestProjectAIChat?: Stub;
    listProjectAIConversations?: Stub;
    getProjectAIConversation?: Stub;
    deleteProjectAIConversation?: Stub;
    postProjectAIChat?: Stub;
    updateItem?: Stub;
    createComment?: Stub;
    getAICredits?: Stub;
  } = {},
  opts: {
    focusItem?: AiChatFocusItem | null;
    user?: User | null;
    layout?: 'fab' | 'dock' | 'page';
    /** 幅が 768px 以上か */
    wide?: boolean;
    initialConversationId?: unknown;
  } = {},
) {
  const user = signal<User | null>(opts.user === undefined ? userOf(1) : opts.user);
  const stubs = {
    getLatestProjectAIChat: vi.fn(() => of(latest)),
    listProjectAIConversations: vi.fn(() => of([c5, c4])),
    getProjectAIConversation: vi.fn(() => of(older)),
    deleteProjectAIConversation: vi.fn(() => of(undefined)),
    postProjectAIChat: vi.fn(() => of(posted)),
    updateItem: vi.fn(() => of({ id: 10 })),
    createComment: vi.fn(() => of({ id: 1 })),
    getAICredits: vi.fn(() => of(okCredits)),
    ...api,
  };
  const media = { matches: opts.wide ?? false, changed: () => undefined as void };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return media.matches;
      },
      addEventListener: (_: string, cb: () => void) => (media.changed = cb),
      removeEventListener: () => undefined,
    })),
  );
  TestBed.configureTestingModule({
    imports: [ProjectAiChat],
    providers: [
      provideRouter([]),
      { provide: Api, useValue: stubs },
      { provide: AuthSession, useValue: { user } },
    ],
  });
  const f = TestBed.createComponent(ProjectAiChat);
  const c = f.componentInstance;
  const shown: ConversationRef[] = [];
  const sendingEvents: boolean[] = [];
  c.conversationChange.subscribe((ref) => shown.push(ref));
  c.sendingChange.subscribe((sending) => sendingEvents.push(sending));
  f.componentRef.setInput('projectId', 1);
  f.componentRef.setInput('focusItem', opts.focusItem === undefined ? focus : opts.focusItem);
  if (opts.layout) f.componentRef.setInput('layout', opts.layout);
  if ('initialConversationId' in opts) {
    f.componentRef.setInput('initialConversationId', opts.initialConversationId);
  }
  f.detectChanges();
  return { f, c, user, api: stubs, shown, sendingEvents, media };
}

type Fixture = { nativeElement: HTMLElement };
const text = (f: Fixture) => f.nativeElement.textContent ?? '';
const button = (f: Fixture, selector: string) =>
  f.nativeElement.querySelector<HTMLButtonElement>(selector)!;
const input = (f: Fixture) =>
  f.nativeElement.querySelector<HTMLTextAreaElement>('#ai-chat-input');
const rows = (f: Fixture) =>
  Array.from(f.nativeElement.querySelectorAll<HTMLButtonElement>('.ai-chat-conversation-open'));
const rowDeletes = (f: Fixture) =>
  Array.from(f.nativeElement.querySelectorAll<HTMLButtonElement>('.ai-chat-conversation-delete'));
const rowTitles = (f: Fixture) =>
  Array.from(f.nativeElement.querySelectorAll('.ai-chat-conversation-title')).map(
    (el) => el.textContent,
  );
const rowTimes = (f: Fixture) =>
  Array.from(f.nativeElement.querySelectorAll('.ai-chat-conversation-time')).map(
    (el) => el.textContent,
  );
const list = (f: Fixture) => f.nativeElement.querySelector<HTMLElement>('.ai-chat-conversations');
const bodies = (f: Fixture) =>
  Array.from(f.nativeElement.querySelectorAll('.ai-chat-body')).map((el) => el.textContent);
const applyButtons = (f: Fixture) =>
  Array.from(f.nativeElement.querySelectorAll<HTMLButtonElement>('.ai-chat-actions button')).map(
    (b) => b.textContent?.trim(),
  );
/** 切り替え・新しい会話・削除（見出しと一覧の各行）が、どれも押せないか */
function actionsDisabled(f: Fixture) {
  const actions = [
    button(f, '.ai-chat-new'),
    button(f, '.ai-chat-delete-shown'),
    ...rows(f),
    ...rowDeletes(f),
  ];
  return actions.every((b) => b.disabled);
}

describe('ProjectAiChat', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('layout', () => {
    it('does not add dock or page modifiers for the default fab layout', () => {
      const { f } = setup({}, { focusItem: null });
      const section = f.nativeElement.querySelector('.ai-chat') as HTMLElement;
      expect(section.classList.contains('ai-chat--dock')).toBe(false);
      expect(section.classList.contains('ai-chat--page')).toBe(false);
    });

    it('marks dock layout', () => {
      const { f } = setup({}, { focusItem: null, layout: 'dock' });
      expect(f.nativeElement.querySelector('.ai-chat')?.classList.contains('ai-chat--dock')).toBe(
        true,
      );
    });

    it('marks page layout without focus apply buttons', () => {
      const { f } = setup({}, { focusItem: null, layout: 'page' });
      expect(f.nativeElement.querySelector('.ai-chat')?.classList.contains('ai-chat--page')).toBe(
        true,
      );
      expect(applyButtons(f)).toEqual([]);
    });

    it('hides apply buttons on page layout even when focusItem is editable', () => {
      const { f } = setup({}, { focusItem: focus, layout: 'page' });
      expect(applyButtons(f)).toEqual([]);
    });
  });

  describe('first load', () => {
    it('loads the latest conversation, the conversation list and credits on init', () => {
      const { c, api } = setup();
      expect(api.getLatestProjectAIChat).toHaveBeenCalledTimes(1);
      expect(api.getLatestProjectAIChat).toHaveBeenCalledWith(1);
      expect(api.listProjectAIConversations).toHaveBeenCalledTimes(1);
      expect(api.listProjectAIConversations).toHaveBeenCalledWith(1);
      expect(api.getProjectAIConversation).not.toHaveBeenCalled();
      expect(api.getAICredits).toHaveBeenCalledTimes(1);
      expect(c.conversationId()).toBe(5);
      expect(c.messages()).toEqual([m1, m2]);
      expect(c.conversations()).toEqual([c5, c4]);
    });

    it('opens an empty new conversation when there is no conversation yet', () => {
      const { f, c } = setup({ getLatestProjectAIChat: vi.fn(() => of(noChat)) });
      expect(c.conversationId()).toBeNull();
      expect(f.nativeElement.querySelector('.ai-chat-empty')?.textContent).toBe(
        'このプロジェクトについて質問できます。',
      );
      expect(button(f, '.ai-chat-delete-shown').disabled).toBe(true);
    });

    it('shows the load error and reloads on retry (L-001)', () => {
      const getLatestProjectAIChat = vi
        .fn()
        .mockReturnValueOnce(httpError(500, '失敗'))
        .mockReturnValueOnce(of(latest));
      const { f, c } = setup({ getLatestProjectAIChat });
      expect(c.loadError()).toBe('失敗');
      expect(input(f)).toBeNull();
      button(f, '.ai-chat-thread .ai-chat-error button').click();
      f.detectChanges();
      expect(c.loadError()).toBe('');
      expect(c.messages()).toEqual([m1, m2]);
      expect(input(f)!.disabled).toBe(false);
    });

    it('applies credits and the list that return after the conversation, and enables the input (L-571)', () => {
      const credits = new Subject<AICredits>();
      const conversations = new Subject<ProjectAIConversation[]>();
      const { f, c } = setup({
        getAICredits: vi.fn(() => credits),
        listProjectAIConversations: vi.fn(() => conversations),
      });
      expect(c.conversationId()).toBe(5);
      expect(input(f)!.disabled).toBe(true);
      credits.next({ ...okCredits, unlimited: false, limitTokens: 1000, remainingTokens: 50 });
      conversations.next([c5, c4]);
      f.detectChanges();
      expect(c.lowRemaining()).toBe(true);
      expect(c.conversations()).toEqual([c5, c4]);
      expect(c.listState()).toBe('ready');
      expect(input(f)!.disabled).toBe(false);
    });

    it('cannot send until the first load settles which conversation is shown (L-669)', () => {
      const pending = new Subject<ProjectAIChatView>();
      const { f, c, api } = setup({ getLatestProjectAIChat: vi.fn(() => pending) });
      c.draft.set('hi');
      c.send();
      expect(api.postProjectAIChat).not.toHaveBeenCalled();
      expect(input(f)).toBeNull();
      pending.next(latest);
      f.detectChanges();
      expect(input(f)!.disabled).toBe(false);
      c.send();
      expect(api.postProjectAIChat).toHaveBeenCalledWith(1, 'hi', 5, 3);
    });

    it('cannot send after the first load failed', () => {
      const { c, api } = setup({ getLatestProjectAIChat: vi.fn(() => httpError(500, '失敗')) });
      c.draft.set('hi');
      c.send();
      expect(api.postProjectAIChat).not.toHaveBeenCalled();
    });
  });

  describe('initialConversationId', () => {
    it('opens the given conversation instead of the latest one', () => {
      const { c, api } = setup({}, { initialConversationId: 4 });
      expect(api.getProjectAIConversation).toHaveBeenCalledWith(1, 4);
      expect(api.getLatestProjectAIChat).not.toHaveBeenCalled();
      expect(api.listProjectAIConversations).toHaveBeenCalledTimes(1);
      expect(c.conversationId()).toBe(4);
      expect(c.messages()).toEqual([m3]);
    });

    it('opens an empty new conversation for new, reading only the list', () => {
      const { f, c, api, shown } = setup({}, { initialConversationId: 'new' });
      expect(api.getLatestProjectAIChat).not.toHaveBeenCalled();
      expect(api.getProjectAIConversation).not.toHaveBeenCalled();
      expect(api.listProjectAIConversations).toHaveBeenCalledTimes(1);
      expect(c.conversationId()).toBeNull();
      expect(c.messages()).toEqual([]);
      expect(shown).toEqual(['new']);
      expect(input(f)!.disabled).toBe(false);
      c.draft.set('hi');
      c.send();
      expect(api.postProjectAIChat).toHaveBeenCalledWith(1, 'hi', 'new', 3);
    });

    it('falls back to the latest conversation when the given one is gone (404)', () => {
      const getProjectAIConversation = vi.fn(() => httpError(404, '会話が見つかりません。'));
      const { c, api, shown } = setup({ getProjectAIConversation }, { initialConversationId: 99 });
      expect(getProjectAIConversation).toHaveBeenCalledWith(1, 99);
      expect(api.getLatestProjectAIChat).toHaveBeenCalledWith(1);
      expect(c.conversationId()).toBe(5);
      expect(c.loadError()).toBe('');
      expect(shown).toEqual([5]);
    });

    it('treats other failures as a load error and retries the same conversation', () => {
      const getProjectAIConversation = vi
        .fn()
        .mockReturnValueOnce(httpError(500, '失敗'))
        .mockReturnValueOnce(of(older));
      const { f, c, api, shown } = setup({ getProjectAIConversation }, { initialConversationId: 4 });
      expect(c.loadError()).toBe('失敗');
      expect(shown).toEqual([]);
      button(f, '.ai-chat-thread .ai-chat-error button').click();
      expect(getProjectAIConversation).toHaveBeenLastCalledWith(1, 4);
      expect(api.getLatestProjectAIChat).not.toHaveBeenCalled();
      expect(c.conversationId()).toBe(4);
    });

    it('treats invalid values as not given', () => {
      for (const value of [0, -1, 1.5, 'abc']) {
        const { c, api } = setup({}, { initialConversationId: value });
        expect(api.getProjectAIConversation).not.toHaveBeenCalled();
        expect(c.conversationId()).toBe(5);
        TestBed.resetTestingModule();
      }
    });

    it('is used only for the first load, not after projectId changes', () => {
      const { f, c, api } = setup({}, { initialConversationId: 4 });
      f.componentRef.setInput('projectId', 2);
      f.detectChanges();
      expect(api.getProjectAIConversation).toHaveBeenCalledTimes(1);
      expect(api.getLatestProjectAIChat).toHaveBeenCalledWith(2);
      expect(c.conversationId()).toBe(5);
    });

    it('is dropped when projectId changes before the first load finishes', () => {
      const pending = new Subject<ProjectAIConversationView>();
      const getProjectAIConversation = vi.fn(() => pending);
      const { f, c, api } = setup({ getProjectAIConversation }, { initialConversationId: 4 });
      f.componentRef.setInput('projectId', 2);
      f.detectChanges();
      expect(getProjectAIConversation).toHaveBeenCalledTimes(1);
      expect(api.getLatestProjectAIChat).toHaveBeenCalledWith(2);
      pending.next(older);
      expect(c.conversationId()).toBe(5);
    });

    it('is dropped when the user changes before the first load finishes', () => {
      const getProjectAIConversation = vi.fn(() => new Subject<ProjectAIConversationView>());
      const { f, c, api, user } = setup({ getProjectAIConversation }, { initialConversationId: 4 });
      user.set(userOf(2));
      f.detectChanges();
      expect(getProjectAIConversation).toHaveBeenCalledTimes(1);
      expect(api.getLatestProjectAIChat).toHaveBeenCalledTimes(1);
      expect(c.conversationId()).toBe(5);
    });

    it('ignores later changes of the input', () => {
      const { f, c, api } = setup({}, { initialConversationId: 4 });
      f.componentRef.setInput('initialConversationId', 5);
      f.detectChanges();
      expect(api.getProjectAIConversation).toHaveBeenCalledTimes(1);
      expect(c.conversationId()).toBe(4);
    });
  });

  describe('conversationChange', () => {
    it('does not emit until the first load finishes', () => {
      const pending = new Subject<ProjectAIChatView>();
      const { shown } = setup({ getLatestProjectAIChat: vi.fn(() => pending) });
      expect(shown).toEqual([]);
      pending.next(latest);
      expect(shown).toEqual([5]);
    });

    it('emits new when there is no conversation yet', () => {
      const { shown } = setup({ getLatestProjectAIChat: vi.fn(() => of(noChat)) });
      expect(shown).toEqual(['new']);
    });

    it('emits each time the shown conversation changes', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { c, shown } = setup({ postProjectAIChat: vi.fn(() => of(postedNew)) });
      c.selectConversation(4);
      c.startNew();
      c.draft.set('hi');
      c.send();
      c.deleteShownConversation();
      expect(shown).toEqual([5, 4, 'new', 9, 'new']);
    });

    it('does not emit again when sending keeps the same conversation', () => {
      const { c, shown } = setup();
      c.draft.set('hi');
      c.send();
      expect(shown).toEqual([5]);
    });

    it('emits the conversation of the new project after projectId changes', () => {
      const getLatestProjectAIChat = vi.fn().mockReturnValueOnce(of(latest)).mockReturnValueOnce(of(latest));
      const { f, shown } = setup({ getLatestProjectAIChat });
      f.componentRef.setInput('projectId', 2);
      f.detectChanges();
      expect(shown).toEqual([5, 5]);
    });
  });

  describe('conversation list', () => {
    it('lists titles and update times, newest first, as buttons', () => {
      const { f } = setup({}, { layout: 'page', wide: true });
      expect(rowTitles(f)).toEqual(['要約して', '期限が近いものは']);
      expect(rowTimes(f)).toEqual(
        [c5, c4].map((conv) => {
          const at = new Date(conv.updatedAt);
          const two = (n: number) => String(n).padStart(2, '0');
          return `${at.getFullYear()}/${two(at.getMonth() + 1)}/${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;
        }),
      );
      expect(rows(f).every((row) => row.tagName === 'BUTTON')).toBe(true);
    });

    it('marks only the shown conversation with aria-current', () => {
      const { f, c } = setup({}, { layout: 'page', wide: true });
      expect(rows(f).map((row) => row.getAttribute('aria-current'))).toEqual(['true', null]);
      c.startNew();
      f.detectChanges();
      expect(rows(f).map((row) => row.getAttribute('aria-current'))).toEqual([null, null]);
    });

    it('labels each delete button with the conversation it deletes', () => {
      const { f } = setup({}, { layout: 'page', wide: true });
      expect(rowDeletes(f).map((b) => b.getAttribute('aria-label'))).toEqual([
        '会話「要約して」を削除',
        '会話「期限が近いものは」を削除',
      ]);
    });

    it('shows loading, not the empty message, while the list is loading (L-002)', () => {
      const pending = new Subject<ProjectAIConversation[]>();
      const { f, c } = setup(
        { listProjectAIConversations: vi.fn(() => pending) },
        { layout: 'page', wide: true },
      );
      expect(c.listState()).toBe('loading');
      expect(list(f)!.textContent).toContain('読み込み中…');
      expect(list(f)!.textContent).not.toContain('会話はまだありません。');
      pending.next([]);
      f.detectChanges();
      expect(list(f)!.textContent).toContain('会話はまだありません。');
      expect(list(f)!.textContent).not.toContain('読み込み中…');
    });

    it('shows the list error with a retry, not the empty message', () => {
      const listProjectAIConversations = vi
        .fn()
        .mockReturnValueOnce(httpError(500, '一覧を読めません'))
        .mockReturnValueOnce(of([c5]));
      const { f, c } = setup({ listProjectAIConversations }, { layout: 'page', wide: true });
      expect(c.listState()).toBe('error');
      expect(list(f)!.querySelector('[role="alert"]')?.textContent).toContain('一覧を読めません');
      expect(list(f)!.textContent).not.toContain('会話はまだありません。');
      // 一覧が読めなくても、表示中の会話には続けられる
      expect(input(f)!.disabled).toBe(false);
      list(f)!.querySelector<HTMLButtonElement>('button')!.click();
      f.detectChanges();
      expect(c.listState()).toBe('ready');
      expect(rowTitles(f)).toEqual(['要約して']);
    });

    it('shows the empty message only when the list was read and has no conversation', () => {
      const { f } = setup(
        { getLatestProjectAIChat: vi.fn(() => of(noChat)), listProjectAIConversations: vi.fn(() => of([])) },
        { layout: 'page', wide: true },
      );
      expect(list(f)!.textContent).toContain('会話はまだありません。');
    });
  });

  describe('history toggle', () => {
    it('swaps the messages for the list in the dock, and back', () => {
      const { f } = setup({}, { layout: 'dock', wide: true });
      const toggle = button(f, '.ai-chat-history-toggle');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.getAttribute('aria-controls')).toBe('ai-chat-conversations');
      expect(list(f)).toBeNull();
      expect(f.nativeElement.querySelector('.ai-chat-list')).not.toBeNull();
      toggle.click();
      f.detectChanges();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(list(f)!.id).toBe('ai-chat-conversations');
      expect(f.nativeElement.querySelector('.ai-chat-list')).toBeNull();
      expect(input(f)).not.toBeNull();
      toggle.click();
      f.detectChanges();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(list(f)).toBeNull();
      expect(f.nativeElement.querySelector('.ai-chat-list')).not.toBeNull();
    });

    it('returns to the messages after a conversation is picked', () => {
      const { f, c } = setup({}, { layout: 'dock' });
      button(f, '.ai-chat-history-toggle').click();
      f.detectChanges();
      rows(f)[1].click();
      f.detectChanges();
      expect(c.historyOpen()).toBe(false);
      expect(list(f)).toBeNull();
      expect(bodies(f)).toEqual(['別の履歴']);
    });

    it('returns to the messages when the shown conversation is picked again, without reloading', () => {
      const { f, c, api } = setup({}, { layout: 'dock' });
      button(f, '.ai-chat-history-toggle').click();
      f.detectChanges();
      rows(f)[0].click();
      expect(api.getProjectAIConversation).not.toHaveBeenCalled();
      expect(c.historyOpen()).toBe(false);
    });

    it('always shows the list beside the messages on a wide page, without the toggle', () => {
      const { f } = setup({}, { layout: 'page', wide: true });
      expect(f.nativeElement.querySelector('.ai-chat-history-toggle')).toBeNull();
      expect(list(f)).not.toBeNull();
      expect(f.nativeElement.querySelector('.ai-chat-list')).not.toBeNull();
      expect(f.nativeElement.querySelector('.ai-chat-main--split')).not.toBeNull();
    });

    it('uses the toggle on a narrow page, and pins the list when the window becomes wide', () => {
      const { f, media } = setup({}, { layout: 'page', wide: false });
      expect(f.nativeElement.querySelector('.ai-chat-history-toggle')).not.toBeNull();
      expect(list(f)).toBeNull();
      media.matches = true;
      media.changed();
      f.detectChanges();
      expect(f.nativeElement.querySelector('.ai-chat-history-toggle')).toBeNull();
      expect(list(f)).not.toBeNull();
    });
  });

  describe('new conversation', () => {
    it('empties the view without calling the server and moves focus to the input', () => {
      const { f, c, api } = setup();
      const calls = () =>
        Object.values(api).reduce((sum, stub) => sum + stub.mock.calls.length, 0);
      const before = calls();
      button(f, '.ai-chat-new').click();
      f.detectChanges();
      expect(calls()).toBe(before);
      expect(c.conversationId()).toBeNull();
      expect(c.messages()).toEqual([]);
      expect(document.activeElement).toBe(input(f));
      expect(button(f, '.ai-chat-delete-shown').disabled).toBe(true);
    });

    it('closes the history list in the dock', () => {
      const { c } = setup({}, { layout: 'dock' });
      c.toggleHistory();
      c.startNew();
      expect(c.historyOpen()).toBe(false);
    });

    it('sends as a new conversation and reads the list again, with the new one at the top', () => {
      const postProjectAIChat = vi.fn(() => of(postedNew));
      const listProjectAIConversations = vi
        .fn()
        .mockReturnValueOnce(of([c5, c4]))
        .mockReturnValue(of([c9, c5, c4]));
      const { f, c } = setup(
        { postProjectAIChat, listProjectAIConversations },
        { layout: 'page', wide: true },
      );
      c.startNew();
      c.draft.set('新しい話題');
      c.send();
      f.detectChanges();
      expect(postProjectAIChat).toHaveBeenCalledWith(1, '新しい話題', 'new', 3);
      expect(c.conversationId()).toBe(9);
      expect(c.messages()).toEqual([m9]);
      expect(listProjectAIConversations).toHaveBeenCalledTimes(2);
      expect(c.conversations()).toEqual([c9, c5, c4]);
      expect(rows(f).map((row) => row.getAttribute('aria-current'))).toEqual(['true', null, null]);
      // 続きは、できた会話に送る。同じ会話なので、一覧は読み直さない
      c.draft.set('続き');
      c.send();
      expect(postProjectAIChat).toHaveBeenLastCalledWith(1, '続き', 9, 3);
      expect(listProjectAIConversations).toHaveBeenCalledTimes(2);
    });

    it('drops a conversation the server trimmed when the new one was stored', () => {
      // 上限まであるときに新しい会話を作ると、サーバーはいちばん古い会話（c4）を消す
      const listProjectAIConversations = vi
        .fn()
        .mockReturnValueOnce(of([c5, c4]))
        .mockReturnValue(of([c9, c5]));
      const { c } = setup({ postProjectAIChat: vi.fn(() => of(postedNew)), listProjectAIConversations });
      c.startNew();
      c.draft.set('新しい話題');
      c.send();
      expect(c.conversations()).toEqual([c9, c5]);
    });
  });

  describe('pick a conversation', () => {
    it('shows its messages and continues it', () => {
      const { f, c, api } = setup({}, { layout: 'page', wide: true });
      rows(f)[1].click();
      f.detectChanges();
      expect(api.getProjectAIConversation).toHaveBeenCalledWith(1, 4);
      expect(c.conversationId()).toBe(4);
      expect(bodies(f)).toEqual(['別の履歴']);
      expect(rows(f).map((row) => row.getAttribute('aria-current'))).toEqual([null, 'true']);
      c.draft.set('続き');
      c.send();
      expect(api.postProjectAIChat).toHaveBeenCalledWith(1, '続き', 4, 3);
    });

    it('moves focus to the input when the picked row disappears with the list (dock)', async () => {
      const { f, c } = setup({}, { layout: 'dock' });
      c.toggleHistory();
      f.detectChanges();
      rows(f)[1].focus();
      rows(f)[1].click();
      f.detectChanges();
      await f.whenStable();
      // 一覧ごと消えるので、フォーカスを body に落とさない
      expect(c.historyOpen()).toBe(false);
      expect(document.activeElement).toBe(input(f));
    });

    it('moves focus to the input when a deleted row disappears', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { f, c } = setup({}, { layout: 'page', wide: true });
      const del = f.nativeElement.querySelectorAll('.ai-chat-conversation-delete')[1] as HTMLButtonElement;
      del.focus();
      del.click();
      f.detectChanges();
      await f.whenStable();
      expect(c.conversations().length).toBe(1);
      expect(document.activeElement).toBe(input(f));
    });

    it('cannot send while the conversation is being switched', () => {
      const pending = new Subject<ProjectAIConversationView>();
      const { f, c, api } = setup({ getProjectAIConversation: vi.fn(() => pending) });
      c.selectConversation(4);
      f.detectChanges();
      expect(c.switching()).toBe(true);
      expect(input(f)!.disabled).toBe(true);
      c.draft.set('hi');
      c.send();
      expect(api.postProjectAIChat).not.toHaveBeenCalled();
      pending.next(older);
      f.detectChanges();
      expect(input(f)!.disabled).toBe(false);
      c.send();
      expect(api.postProjectAIChat).toHaveBeenCalledWith(1, 'hi', 4, 3);
    });

    it('keeps the previous conversation and shows the error when switching fails (not 404)', () => {
      const getProjectAIConversation = vi.fn(() => httpError(500, '読めません'));
      const { f, c, api, shown } = setup({ getProjectAIConversation });
      c.selectConversation(4);
      f.detectChanges();
      expect(c.conversationId()).toBe(5);
      expect(bodies(f)).toEqual(['要約して', '要約です']);
      expect(c.error()).toBe('読めません');
      expect(c.loadError()).toBe('');
      expect(c.switching()).toBe(false);
      expect(input(f)!.disabled).toBe(false);
      expect(api.listProjectAIConversations).toHaveBeenCalledTimes(1);
      expect(shown).toEqual([5]);
    });

    it('reloads the list and says the conversation is missing on 404', () => {
      const listProjectAIConversations = vi
        .fn()
        .mockReturnValueOnce(of([c5, c4]))
        .mockReturnValueOnce(of([c5]));
      const getProjectAIConversation = vi.fn(() => httpError(404, 'サーバーの文言'));
      const { f, c } = setup(
        { listProjectAIConversations, getProjectAIConversation },
        { layout: 'dock' },
      );
      c.toggleHistory();
      c.selectConversation(4);
      f.detectChanges();
      expect(listProjectAIConversations).toHaveBeenCalledTimes(2);
      expect(c.conversations()).toEqual([c5]);
      expect(c.conversationId()).toBe(5);
      expect(c.messages()).toEqual([m1, m2]);
      expect(c.error()).toBe('会話が見つかりません。');
      // 一覧を開いたままでも、文言は見える
      expect(f.nativeElement.querySelector('p.ai-chat-error')?.textContent).toBe(
        '会話が見つかりません。',
      );
    });
  });

  describe('delete a conversation', () => {
    it('deletes only the shown conversation after the confirm and becomes a new conversation', () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { f, c, api } = setup();
      button(f, '.ai-chat-delete-shown').click();
      f.detectChanges();
      expect(confirm).toHaveBeenCalledWith('この会話を削除しますか？');
      expect(api.deleteProjectAIConversation).toHaveBeenCalledWith(1, 5);
      expect(c.conversationId()).toBeNull();
      expect(c.messages()).toEqual([]);
      expect(c.conversations()).toEqual([c4]);
      expect(c.deleting()).toBe(false);
      expect(button(f, '.ai-chat-delete-shown').disabled).toBe(true);
    });

    it('deletes another conversation from the list and keeps the shown one', () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { f, c, api } = setup({}, { layout: 'page', wide: true });
      rowDeletes(f)[1].click();
      f.detectChanges();
      expect(confirm).toHaveBeenCalledWith('この会話を削除しますか？');
      expect(api.deleteProjectAIConversation).toHaveBeenCalledWith(1, 4);
      expect(c.conversationId()).toBe(5);
      expect(c.messages()).toEqual([m1, m2]);
      expect(rowTitles(f)).toEqual(['要約して']);
    });

    it('keeps the conversation when the confirm is cancelled', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      const { c, api } = setup();
      c.deleteShownConversation();
      expect(api.deleteProjectAIConversation).not.toHaveBeenCalled();
      expect(c.messages()).toEqual([m1, m2]);
    });

    it('keeps the conversation and shows the error when delete fails (L-001)', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const deleteProjectAIConversation = vi.fn(() => httpError(500, '消せません'));
      const { c } = setup({ deleteProjectAIConversation });
      c.deleteShownConversation();
      expect(c.conversationId()).toBe(5);
      expect(c.messages()).toEqual([m1, m2]);
      expect(c.conversations()).toEqual([c5, c4]);
      expect(c.error()).toBe('消せません');
      expect(c.deleting()).toBe(false);
    });

    it('treats 404 as deleted: it was already gone elsewhere', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const deleteProjectAIConversation = vi.fn(() => httpError(404, '会話が見つかりません。'));
      const { c } = setup({ deleteProjectAIConversation });
      c.deleteShownConversation();
      expect(c.conversationId()).toBeNull();
      expect(c.messages()).toEqual([]);
      expect(c.conversations()).toEqual([c4]);
      expect(c.error()).toBe('');
      expect(c.deleting()).toBe(false);
    });

    it('does nothing for an unsaved new conversation', () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { c, api } = setup({ getLatestProjectAIChat: vi.fn(() => of(noChat)) });
      c.deleteShownConversation();
      expect(confirm).not.toHaveBeenCalled();
      expect(api.deleteProjectAIConversation).not.toHaveBeenCalled();
    });

    it('reloads the list instead of patching it when the list was not read yet', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const first = new Subject<ProjectAIConversation[]>();
      const listProjectAIConversations = vi
        .fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(of([c4]));
      const { c } = setup({ listProjectAIConversations });
      c.deleteShownConversation();
      expect(listProjectAIConversations).toHaveBeenCalledTimes(2);
      first.next([c5, c4]);
      expect(c.conversations()).toEqual([c4]);
      expect(c.listState()).toBe('ready');
    });
  });

  describe('locked while busy', () => {
    it('disables switch, new and delete while sending, and enables them after', () => {
      const pending = new Subject<ProjectAIChatPostResponse>();
      const { f, c, api } = setup(
        { postProjectAIChat: vi.fn(() => pending) },
        { layout: 'page', wide: true },
      );
      expect(actionsDisabled(f)).toBe(false);
      c.draft.set('hi');
      c.send();
      f.detectChanges();
      expect(rows(f)).toHaveLength(2);
      expect(actionsDisabled(f)).toBe(true);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      c.selectConversation(4);
      c.startNew();
      c.deleteShownConversation();
      c.deleteConversation(4);
      expect(api.getProjectAIConversation).not.toHaveBeenCalled();
      expect(api.deleteProjectAIConversation).not.toHaveBeenCalled();
      expect(c.conversationId()).toBe(5);
      pending.next(posted);
      f.detectChanges();
      expect(button(f, '.ai-chat-new').disabled).toBe(false);
      expect(button(f, '.ai-chat-delete-shown').disabled).toBe(false);
      expect(rows(f).every((row) => !row.disabled)).toBe(true);
    });

    it('disables them while the first load is in flight', () => {
      const pending = new Subject<ProjectAIChatView>();
      const { f, c, api } = setup(
        { getLatestProjectAIChat: vi.fn(() => pending) },
        { layout: 'page', wide: true },
      );
      expect(rows(f)).toHaveLength(2);
      expect(actionsDisabled(f)).toBe(true);
      c.selectConversation(4);
      c.startNew();
      expect(api.getProjectAIConversation).not.toHaveBeenCalled();
      expect(c.loading()).toBe(true);
      pending.next(latest);
      f.detectChanges();
      expect(actionsDisabled(f)).toBe(false);
    });

    it('disables them after the first load failed, until the retry settles the conversation', () => {
      const getLatestProjectAIChat = vi
        .fn()
        .mockReturnValueOnce(httpError(500, '失敗'))
        .mockReturnValueOnce(of(latest));
      const { f, c } = setup({ getLatestProjectAIChat }, { layout: 'page', wide: true });
      expect(actionsDisabled(f)).toBe(true);
      c.reload();
      f.detectChanges();
      expect(actionsDisabled(f)).toBe(false);
    });

    it('disables them while a conversation is being switched', () => {
      const pending = new Subject<ProjectAIConversationView>();
      const { f, c, api } = setup(
        { getProjectAIConversation: vi.fn(() => pending) },
        { layout: 'page', wide: true },
      );
      rows(f)[1].click();
      f.detectChanges();
      expect(actionsDisabled(f)).toBe(true);
      c.selectConversation(5);
      c.startNew();
      expect(api.getProjectAIConversation).toHaveBeenCalledTimes(1);
      pending.next(older);
      f.detectChanges();
      expect(c.conversationId()).toBe(4);
      expect(actionsDisabled(f)).toBe(false);
    });

    it('disables them, and the input, while a conversation is being deleted', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const pending = new Subject<void>();
      const { f, c, api } = setup(
        { deleteProjectAIConversation: vi.fn(() => pending) },
        { layout: 'page', wide: true },
      );
      rowDeletes(f)[1].click();
      f.detectChanges();
      expect(c.deleting()).toBe(true);
      expect(actionsDisabled(f)).toBe(true);
      expect(input(f)!.disabled).toBe(true);
      c.draft.set('hi');
      c.send();
      expect(api.postProjectAIChat).not.toHaveBeenCalled();
      pending.next();
      f.detectChanges();
      expect(actionsDisabled(f)).toBe(false);
      expect(input(f)!.disabled).toBe(false);
    });

    it('keeps the history toggle usable while sending', () => {
      const pending = new Subject<ProjectAIChatPostResponse>();
      const { f, c } = setup({ postProjectAIChat: vi.fn(() => pending) }, { layout: 'dock' });
      c.draft.set('hi');
      c.send();
      f.detectChanges();
      expect(button(f, '.ai-chat-history-toggle').disabled).toBe(false);
    });
  });

  describe('send', () => {
    it('continues the shown conversation without focusItemNumber when no item is open', () => {
      const { c, api } = setup({}, { focusItem: null });
      c.draft.set('期限が近いものは');
      c.send();
      expect(api.postProjectAIChat).toHaveBeenCalledWith(1, '期限が近いものは', 5, undefined);
      expect(c.messages()).toEqual([m1, m2]);
      expect(c.draft()).toBe('');
      expect(c.sending()).toBe(false);
      expect(c.error()).toBe('');
    });

    it('sends the open item number from item detail', () => {
      const { c, api } = setup();
      c.draft.set('要約して');
      c.send();
      expect(api.postProjectAIChat).toHaveBeenCalledWith(1, '要約して', 5, 3);
    });

    it('sends the open item number even when the item is read-only', () => {
      const { c, api } = setup({}, { focusItem: { ...focus, canEdit: false } });
      c.draft.set('要約して');
      c.send();
      expect(api.postProjectAIChat).toHaveBeenCalledWith(1, '要約して', 5, 3);
    });

    it('moves the conversation it sent to to the top of the list', () => {
      const updated = { ...c4, updatedAt: '2026-11-26T00:00:00Z' };
      const postProjectAIChat = vi.fn(() =>
        of({ conversation: updated, assistant: m3, messages: [m3] }),
      );
      const { c, api } = setup({ postProjectAIChat });
      c.selectConversation(4);
      c.draft.set('続き');
      c.send();
      expect(c.conversations()).toEqual([updated, c5]);
      // 送った会話に保存されたので、手元で先頭に置く（一覧は読み直さない）
      expect(api.listProjectAIConversations).toHaveBeenCalledTimes(1);
    });

    it('reads the list again when the answer was stored in another conversation than the one sent to', () => {
      // モデルを待つ間に、送った先の会話（c5）が消された。回答は新しい会話（c9）に保存される
      const listProjectAIConversations = vi
        .fn()
        .mockReturnValueOnce(of([c5, c4]))
        .mockReturnValue(of([c9, c4]));
      const postProjectAIChat = vi.fn(() => of(postedNew));
      const { c, shown } = setup({ listProjectAIConversations, postProjectAIChat });
      c.draft.set('続き');
      c.send();
      expect(postProjectAIChat).toHaveBeenCalledWith(1, '続き', 5, 3);
      expect(listProjectAIConversations).toHaveBeenCalledTimes(2);
      expect(c.conversations()).toEqual([c9, c4]);
      expect(c.conversationId()).toBe(9);
      expect(c.messages()).toEqual([m9]);
      expect(shown).toEqual([5, 9]);
    });

    it('shows the searching status while waiting for the answer', () => {
      const pending = new Subject<ProjectAIChatPostResponse>();
      const { f, c } = setup({ postProjectAIChat: vi.fn(() => pending) });
      c.draft.set('hi');
      c.send();
      f.detectChanges();
      expect(f.nativeElement.querySelector('.ai-chat-sending')?.textContent).toBe('調べています…');
      pending.next(posted);
      f.detectChanges();
      expect(f.nativeElement.querySelector('.ai-chat-sending')).toBeNull();
    });

    it('reports sending through sendingChange', () => {
      const pending = new Subject<ProjectAIChatPostResponse>();
      const { c, sendingEvents } = setup({ postProjectAIChat: vi.fn(() => pending) });
      expect(sendingEvents).toEqual([]);
      c.draft.set('hi');
      c.send();
      expect(sendingEvents).toEqual([true]);
      pending.next(posted);
      expect(sendingEvents).toEqual([true, false]);
    });

    it('reports the end of sending when the send fails', () => {
      const { c, sendingEvents } = setup({ postProjectAIChat: vi.fn(() => httpError(500, '失敗')) });
      c.draft.set('hi');
      c.send();
      expect(sendingEvents).toEqual([true, false]);
    });

    it('does not send twice while waiting', () => {
      const pending = new Subject<ProjectAIChatPostResponse>();
      const postProjectAIChat = vi.fn(() => pending);
      const { c } = setup({ postProjectAIChat });
      c.draft.set('hi');
      c.send();
      c.send();
      expect(postProjectAIChat).toHaveBeenCalledTimes(1);
    });

    it('rejects empty and overlong messages before POST', () => {
      const { c, api } = setup();
      c.draft.set('   ');
      c.send();
      expect(c.error()).toBe('メッセージを入力してください。');
      c.draft.set('あ'.repeat(4001));
      c.send();
      expect(c.error()).toContain('4000');
      expect(api.postProjectAIChat).not.toHaveBeenCalled();
    });

    it('keeps draft and shows server message on 503 (L-001)', () => {
      const postProjectAIChat = vi.fn(() => httpError(503, 'AIが設定されていません。'));
      const { c } = setup({ postProjectAIChat });
      c.draft.set('hi');
      c.send();
      expect(c.draft()).toBe('hi');
      expect(c.sending()).toBe(false);
      expect(c.error()).toBe('AIが設定されていません。');
      expect(c.conversationId()).toBe(5);
    });

    it('keeps draft and shows server message on 429', () => {
      const postProjectAIChat = vi.fn(() =>
        throwError(() => ({
          status: 429,
          error: { message: 'AI利用上限に達しています。', code: 'ai_credit_limit' },
        })),
      );
      const { c } = setup({ postProjectAIChat });
      c.draft.set('hi');
      c.send();
      expect(c.draft()).toBe('hi');
      expect(c.error()).toBe('AI利用上限に達しています。');
    });

    it('switches to a new conversation and keeps the draft when the shown conversation is gone (404)', () => {
      const listProjectAIConversations = vi
        .fn()
        .mockReturnValueOnce(of([c5, c4]))
        .mockReturnValueOnce(of([c4]))
        .mockReturnValueOnce(of([c9, c4]));
      const postProjectAIChat = vi
        .fn()
        .mockReturnValueOnce(httpError(404, '会話が見つかりません。'))
        .mockReturnValueOnce(of(postedNew));
      const { c, shown } = setup({ listProjectAIConversations, postProjectAIChat });
      c.draft.set('続き');
      c.send();
      expect(postProjectAIChat).toHaveBeenCalledWith(1, '続き', 5, 3);
      expect(listProjectAIConversations).toHaveBeenCalledTimes(2);
      expect(c.conversations()).toEqual([c4]);
      expect(c.conversationId()).toBeNull();
      expect(c.messages()).toEqual([]);
      expect(c.draft()).toBe('続き');
      expect(c.sending()).toBe(false);
      expect(c.error()).toBe('この会話は見つかりませんでした。新しい会話として送り直せます。');
      expect(shown).toEqual([5, 'new']);
      // そのまま送り直すと、新しい会話になる
      c.send();
      expect(postProjectAIChat).toHaveBeenLastCalledWith(1, '続き', 'new', 3);
      expect(c.conversationId()).toBe(9);
      expect(c.draft()).toBe('');
      expect(c.conversations()).toEqual([c9, c4]);
    });

    it('shows the server message when a new conversation gets 404 (the project is gone)', () => {
      const postProjectAIChat = vi.fn(() => httpError(404, 'プロジェクトが見つかりません。'));
      const { c, api } = setup({ getLatestProjectAIChat: vi.fn(() => of(noChat)), postProjectAIChat });
      c.draft.set('hi');
      c.send();
      expect(c.error()).toBe('プロジェクトが見つかりません。');
      expect(api.listProjectAIConversations).toHaveBeenCalledTimes(1);
    });

    it('drops the answer, but ends sending, when another conversation is shown by then', () => {
      const pending = new Subject<ProjectAIChatPostResponse>();
      const { c } = setup({ postProjectAIChat: vi.fn(() => pending) });
      c.draft.set('hi');
      c.send();
      // 押せなくしてあるので画面からは起きない。応答を反映する条件そのものを確かめる
      c.conversationId.set(4);
      c.messages.set([m3]);
      pending.next(posted);
      expect(c.messages()).toEqual([m3]);
      expect(c.conversationId()).toBe(4);
      expect(c.draft()).toBe('hi');
      expect(c.sending()).toBe(false);
    });

    it('drops the error, but ends sending, when another conversation is shown by then', () => {
      const pending = new Subject<ProjectAIChatPostResponse>();
      const { c } = setup({ postProjectAIChat: vi.fn(() => pending) });
      c.draft.set('hi');
      c.send();
      c.conversationId.set(4);
      pending.error({ status: 404, error: { message: '会話が見つかりません。' } });
      expect(c.conversationId()).toBe(4);
      expect(c.error()).toBe('');
      expect(c.sending()).toBe(false);
    });

    it('does not let a list response started before the send overwrite the list', () => {
      const first = new Subject<ProjectAIConversation[]>();
      const second = new Subject<ProjectAIConversation[]>();
      const listProjectAIConversations = vi
        .fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(second);
      const { c } = setup({
        getLatestProjectAIChat: vi.fn(() => of(noChat)),
        listProjectAIConversations,
        postProjectAIChat: vi.fn(() => of(postedNew)),
      });
      c.draft.set('新しい話題');
      c.send();
      // 一覧をまだ読めていないので、送信の後の一覧を読み直す
      expect(listProjectAIConversations).toHaveBeenCalledTimes(2);
      first.next([c5, c4]);
      expect(c.conversations()).toEqual([]);
      expect(c.listState()).toBe('loading');
      second.next([c9, c5, c4]);
      expect(c.conversations()).toEqual([c9, c5, c4]);
      expect(c.listState()).toBe('ready');
    });

    it('ignores Enter while IME is composing', () => {
      const { c, api } = setup();
      c.draft.set('途中');
      c.onComposeKeydown({
        key: 'Enter',
        shiftKey: false,
        isComposing: true,
        keyCode: 229,
        preventDefault: () => undefined,
      } as KeyboardEvent);
      expect(api.postProjectAIChat).not.toHaveBeenCalled();
    });

    it('styles the send button as primary with ai-chat-send', () => {
      const { f } = setup();
      f.detectChanges();
      const send = f.nativeElement.querySelector(
        'form.ai-chat-compose button[type="submit"]',
      ) as HTMLButtonElement | null;
      expect(send).toBeTruthy();
      expect(send!.classList.contains('primary')).toBe(true);
      expect(send!.classList.contains('ai-chat-send')).toBe(true);
      expect(send!.textContent).toContain('送信');
      expect(send!.querySelector('.ai-chat-send-icon')?.getAttribute('aria-hidden')).toBe(
        'true',
      );
    });
  });

  describe('message list autoscroll', () => {
    const flushRender = () => {
      TestBed.inject(ApplicationRef).tick();
    };

    const mockListMetrics = (list: HTMLElement, scrollTop: number) => {
      Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => 400 });
      Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => 100 });
      Object.defineProperty(list, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (v: number) => {
          scrollTop = v;
        },
      });
      return () => scrollTop;
    };

    it('scrolls to bottom when messages grow while stuck', () => {
      const { f, c } = setup();
      f.detectChanges();
      flushRender();
      const list = f.nativeElement.querySelector('.ai-chat-list') as HTMLElement;
      const readTop = mockListMetrics(list, 0);
      c.messages.set([...latest.messages, { ...m2, id: 99, body: '追記' }]);
      f.detectChanges();
      flushRender();
      expect(readTop()).toBe(400);
    });

    it('does not scroll after the user leaves the bottom', () => {
      const { f, c } = setup();
      f.detectChanges();
      flushRender();
      const list = f.nativeElement.querySelector('.ai-chat-list') as HTMLElement;
      const readTop = mockListMetrics(list, 0);
      list.dispatchEvent(new Event('scroll'));
      c.messages.set([...latest.messages, { ...m2, id: 100, body: '上にいる間の返答' }]);
      f.detectChanges();
      flushRender();
      expect(readTop()).toBe(0);
    });

    it('re-sticks on send then stays unstuck if user scrolls up before the reply', () => {
      const pending = new Subject<ProjectAIChatPostResponse>();
      const { f, c, api } = setup({ postProjectAIChat: vi.fn(() => pending) });
      f.detectChanges();
      flushRender();
      c.draft.set('hi');
      c.send();
      expect(api.postProjectAIChat).toHaveBeenCalled();
      flushRender();
      const list = f.nativeElement.querySelector('.ai-chat-list') as HTMLElement;
      const readTop = mockListMetrics(list, 0);
      list.dispatchEvent(new Event('scroll'));
      pending.next(posted);
      pending.complete();
      f.detectChanges();
      flushRender();
      expect(readTop()).toBe(0);
    });

    it('keeps scroll position when a new conversation id is assigned after send', () => {
      const pending = new Subject<ProjectAIChatPostResponse>();
      const { f, c } = setup({
        getLatestProjectAIChat: vi.fn(() => of(noChat)),
        postProjectAIChat: vi.fn(() => pending),
      });
      f.detectChanges();
      flushRender();
      c.draft.set('first');
      c.send();
      flushRender();
      const list = f.nativeElement.querySelector('.ai-chat-list') as HTMLElement;
      const readTop = mockListMetrics(list, 0);
      list.dispatchEvent(new Event('scroll'));
      pending.next(postedNew);
      pending.complete();
      f.detectChanges();
      flushRender();
      expect(readTop()).toBe(0);
    });

    it('does not scroll the list while loading has no list', () => {
      const pending = new Subject<ProjectAIChatView>();
      const { f, c } = setup({ getLatestProjectAIChat: vi.fn(() => pending) });
      f.detectChanges();
      flushRender();
      expect(f.nativeElement.querySelector('.ai-chat-list')).toBeNull();
      expect(c.loading()).toBe(true);
      pending.next(latest);
      pending.complete();
      f.detectChanges();
      flushRender();
      const list = f.nativeElement.querySelector('.ai-chat-list') as HTMLElement;
      expect(list).toBeTruthy();
      const readTop = mockListMetrics(list, 0);
      c.messages.set([...latest.messages, { ...m2, id: 101, body: 'load後' }]);
      f.detectChanges();
      flushRender();
      expect(readTop()).toBe(400);
    });
  });

  describe('credits', () => {
    it('blocks compose when unconfigured and does not POST', () => {
      const getAICredits = vi.fn(() =>
        of({ ...okCredits, configured: false, remainingTokens: 0, limitTokens: 100, unlimited: false }),
      );
      const { f, c, api } = setup({ getAICredits });
      expect(c.blockReason()).toBe('unconfigured');
      expect(f.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
        AI_UNCONFIGURED_MESSAGE,
      );
      expect(text(f)).not.toContain(AI_LOW_REMAINING_MESSAGE);
      c.draft.set('hi');
      c.send();
      expect(api.postProjectAIChat).not.toHaveBeenCalled();
      f.detectChanges();
      expect((f.nativeElement.querySelector('#ai-chat-input') as HTMLTextAreaElement).disabled).toBe(
        true,
      );
      expect(
        (f.nativeElement.querySelector('.ai-chat-compose button[type="submit"]') as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect(f.nativeElement.querySelector('a')?.getAttribute('href')).toBe('/settings');
      expect(button(f, '.ai-chat-delete-shown').disabled).toBe(false);
    });

    it('blocks compose when exhausted without low-remaining status', () => {
      const getAICredits = vi.fn(() =>
        of({ ...okCredits, unlimited: false, limitTokens: 1000, usedTokens: 1000, remainingTokens: 0 }),
      );
      const { f, c, api } = setup({ getAICredits });
      expect(c.blockReason()).toBe('exhausted');
      expect(f.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
        AI_EXHAUSTED_MESSAGE,
      );
      expect(text(f)).not.toContain(AI_LOW_REMAINING_MESSAGE);
      c.draft.set('hi');
      c.send();
      expect(api.postProjectAIChat).not.toHaveBeenCalled();
    });

    it('shows low remaining status and still sends', () => {
      const getAICredits = vi.fn(() =>
        of({ ...okCredits, unlimited: false, limitTokens: 1000, usedTokens: 950, remainingTokens: 50 }),
      );
      const { f, c, api } = setup({ getAICredits });
      expect(c.lowRemaining()).toBe(true);
      expect(f.nativeElement.querySelector('[role="status"]')?.textContent).toContain(
        AI_LOW_REMAINING_MESSAGE,
      );
      c.draft.set('hi');
      c.send();
      expect(api.postProjectAIChat).toHaveBeenCalled();
    });

    it('does not POST while credits are loading, then allows send', () => {
      const pending = new Subject<AICredits>();
      const { c, api } = setup({ getAICredits: vi.fn(() => pending) });
      expect(c.creditsLoading()).toBe(true);
      c.draft.set('hi');
      c.send();
      expect(api.postProjectAIChat).not.toHaveBeenCalled();
      pending.next(okCredits);
      pending.complete();
      expect(c.creditsLoading()).toBe(false);
      c.send();
      expect(api.postProjectAIChat).toHaveBeenCalled();
    });

    it('clears blocked state when credits request fails after success', () => {
      const getAICredits = vi
        .fn()
        .mockReturnValueOnce(of({ ...okCredits, configured: false }))
        .mockReturnValueOnce(throwError(() => ({ status: 500 })));
      const { c, api } = setup({ getAICredits });
      expect(c.composeBlocked()).toBe(true);
      c.reload();
      expect(c.composeBlocked()).toBe(false);
      expect(c.credits()).toBeNull();
      c.draft.set('hi');
      c.send();
      expect(api.postProjectAIChat).toHaveBeenCalled();
    });
  });

  describe('apply to the open item', () => {
    it('shows apply buttons only when the open item is editable', () => {
      const { f } = setup();
      expect(applyButtons(f)).toEqual(['説明に反映', 'コメント追加']);
      f.componentRef.setInput('focusItem', { ...focus, canEdit: false });
      f.detectChanges();
      expect(applyButtons(f)).toEqual([]);
    });

    it('shows no apply buttons without an open item (board / backlog)', () => {
      const { f } = setup({}, { focusItem: null });
      expect(f.nativeElement.querySelector('.ai-chat-msg[data-role="assistant"]')).toBeTruthy();
      expect(applyButtons(f)).toEqual([]);
    });

    it('does not apply when the open item is not editable even if called', () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { c, api } = setup({}, { focusItem: { ...focus, canEdit: false } });
      c.applyToDescription('x');
      c.applyAsComment('x');
      expect(confirm).not.toHaveBeenCalled();
      expect(api.updateItem).not.toHaveBeenCalled();
      expect(api.createComment).not.toHaveBeenCalled();
    });

    it('confirms the description apply with the item number, title and notice', () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const updated = { id: 10, description: '新説明', updatedAt: 't2' };
      const { c, api } = setup({ updateItem: vi.fn(() => of(updated)) });
      const applied: unknown[] = [];
      c.descriptionApplied.subscribe((item) => applied.push(item));
      c.applyToDescription('新説明');
      expect(confirm).toHaveBeenCalledWith(
        '#3 ログインの修正 の説明をこの内容で置き換えますか？ 回答には、ほかのアイテムの内容が含まれていることがあります。',
      );
      expect(api.updateItem).toHaveBeenCalledWith(10, { description: '新説明' });
      expect(applied).toEqual([updated]);
      expect(c.applying()).toBe(false);
    });

    it('confirms the comment apply with the item number, title and notice', () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { c, api } = setup();
      const applied: unknown[] = [];
      c.commentApplied.subscribe(() => applied.push(true));
      c.applyAsComment('要約です');
      expect(confirm).toHaveBeenCalledWith(
        '#3 ログインの修正 にこの内容をコメントとして追加しますか？ 回答には、ほかのアイテムの内容が含まれていることがあります。',
      );
      expect(api.createComment).toHaveBeenCalledWith(3, { body: '要約です' }, 1);
      expect(applied).toEqual([true]);
      expect(c.applying()).toBe(false);
      expect(c.error()).toBe('');
    });

    it('skips apply when confirm is cancelled (L-408)', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      const { c, api } = setup();
      c.applyToDescription('x');
      c.applyAsComment('x');
      expect(api.updateItem).not.toHaveBeenCalled();
      expect(api.createComment).not.toHaveBeenCalled();
    });

    it('does not report success when description apply fails (L-001)', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const updateItem = vi.fn(() => throwError(() => ({ status: 500, error: { message: '失敗' } })));
      const { c } = setup({ updateItem });
      const applied: unknown[] = [];
      c.descriptionApplied.subscribe((item) => applied.push(item));
      c.applyToDescription('新説明');
      expect(c.applying()).toBe(false);
      expect(c.error()).toBe('失敗');
      expect(applied).toEqual([]);
    });

    it('blocks overlong comment apply before confirm', () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { c, api } = setup();
      c.applyAsComment('あ'.repeat(4001));
      expect(confirm).not.toHaveBeenCalled();
      expect(api.createComment).not.toHaveBeenCalled();
      expect(c.error()).toContain('4000');
    });
  });

  describe('stale responses: projectId', () => {
    it('reloads the conversation, the list and credits when projectId changes', () => {
      const getLatestProjectAIChat = vi.fn().mockReturnValueOnce(of(latest)).mockReturnValueOnce(of(otherChat));
      const listProjectAIConversations = vi
        .fn()
        .mockReturnValueOnce(of([c5, c4]))
        .mockReturnValueOnce(of([c4]));
      const { f, c, api } = setup({ getLatestProjectAIChat, listProjectAIConversations });
      c.draft.set('書きかけ');
      c.toggleHistory();
      f.componentRef.setInput('projectId', 2);
      f.detectChanges();
      expect(getLatestProjectAIChat).toHaveBeenLastCalledWith(2);
      expect(listProjectAIConversations).toHaveBeenLastCalledWith(2);
      expect(api.getAICredits).toHaveBeenCalledTimes(2);
      expect(c.conversationId()).toBe(4);
      expect(c.messages()).toEqual([m3]);
      expect(c.conversations()).toEqual([c4]);
      expect(c.draft()).toBe('');
      expect(c.historyOpen()).toBe(false);
    });

    it('does not show the previous project conversation or list while the new one loads', () => {
      const pending = new Subject<ProjectAIChatView>();
      const pendingList = new Subject<ProjectAIConversation[]>();
      const getLatestProjectAIChat = vi.fn().mockReturnValueOnce(of(latest)).mockReturnValueOnce(pending);
      const listProjectAIConversations = vi
        .fn()
        .mockReturnValueOnce(of([c5, c4]))
        .mockReturnValueOnce(pendingList);
      const { f, c } = setup({ getLatestProjectAIChat, listProjectAIConversations });
      f.componentRef.setInput('projectId', 2);
      f.detectChanges();
      expect(c.messages()).toEqual([]);
      expect(c.conversationId()).toBeNull();
      expect(c.conversations()).toEqual([]);
      expect(c.listState()).toBe('loading');
      expect(c.loading()).toBe(true);
    });

    it('drops a stale conversation response after projectId change', () => {
      const pending = new Subject<ProjectAIChatView>();
      const getLatestProjectAIChat = vi.fn().mockReturnValueOnce(pending).mockReturnValueOnce(of(otherChat));
      const { f, c } = setup({ getLatestProjectAIChat });
      f.componentRef.setInput('projectId', 2);
      f.detectChanges();
      pending.next(latest);
      pending.complete();
      expect(c.messages()).toEqual([m3]);
      expect(c.conversationId()).toBe(4);
    });

    it('drops a stale list response after projectId change', () => {
      const pending = new Subject<ProjectAIConversation[]>();
      const listProjectAIConversations = vi
        .fn()
        .mockReturnValueOnce(pending)
        .mockReturnValueOnce(of([c4]));
      const { f, c } = setup({ listProjectAIConversations });
      f.componentRef.setInput('projectId', 2);
      f.detectChanges();
      expect(pending.observed).toBe(false);
      pending.next([c5, c4]);
      expect(c.conversations()).toEqual([c4]);
    });

    it('drops a stale switch response after projectId change', () => {
      const pending = new Subject<ProjectAIConversationView>();
      const { f, c } = setup({ getProjectAIConversation: vi.fn(() => pending) });
      c.selectConversation(4);
      f.componentRef.setInput('projectId', 2);
      f.detectChanges();
      expect(pending.observed).toBe(false);
      pending.next(older);
      expect(c.conversationId()).toBe(5);
      expect(c.messages()).toEqual([m1, m2]);
      expect(c.switching()).toBe(false);
    });

    it('drops a stale credits response after projectId change (L-037)', () => {
      const pending = new Subject<AICredits>();
      const getAICredits = vi
        .fn()
        .mockReturnValueOnce(pending)
        .mockReturnValueOnce(of({ ...okCredits, configured: false }));
      const { f, c } = setup({ getAICredits });
      f.componentRef.setInput('projectId', 2);
      f.detectChanges();
      pending.next(okCredits);
      pending.complete();
      expect(c.blockReason()).toBe('unconfigured');
    });

    it('drops a stale answer after projectId change and lets the user send again', () => {
      const pending = new Subject<ProjectAIChatPostResponse>();
      const getLatestProjectAIChat = vi.fn().mockReturnValueOnce(of(noChat)).mockReturnValueOnce(of(otherChat));
      const postProjectAIChat = vi.fn().mockReturnValueOnce(pending).mockReturnValueOnce(of(posted));
      const { f, c, sendingEvents } = setup({ getLatestProjectAIChat, postProjectAIChat });
      c.draft.set('hi');
      c.send();
      expect(c.sending()).toBe(true);
      f.componentRef.setInput('projectId', 2);
      f.detectChanges();
      expect(pending.observed).toBe(false);
      pending.next(posted);
      expect(c.messages()).toEqual([m3]);
      expect(c.sending()).toBe(false);
      expect(sendingEvents).toEqual([true, false]);
      c.draft.set('again');
      c.send();
      expect(postProjectAIChat).toHaveBeenLastCalledWith(2, 'again', 4, 3);
    });

    it('drops a stale delete response after projectId change', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const pending = new Subject<void>();
      const getLatestProjectAIChat = vi.fn().mockReturnValueOnce(of(latest)).mockReturnValueOnce(of(latest));
      const { f, c } = setup({
        getLatestProjectAIChat,
        deleteProjectAIConversation: vi.fn(() => pending),
      });
      c.deleteShownConversation();
      expect(c.deleting()).toBe(true);
      f.componentRef.setInput('projectId', 2);
      f.detectChanges();
      pending.next();
      expect(c.conversationId()).toBe(5);
      expect(c.messages()).toEqual([m1, m2]);
      expect(c.conversations()).toEqual([c5, c4]);
      expect(c.deleting()).toBe(false);
    });
  });

  describe('stale responses: focusItem only', () => {
    const other: AiChatFocusItem = { number: 4, itemId: 20, title: '別のアイテム', canEdit: true };

    it('does not reload history or credits when only focusItem changes', () => {
      const { f, c, api } = setup();
      c.draft.set('書きかけ');
      f.componentRef.setInput('focusItem', other);
      f.detectChanges();
      f.componentRef.setInput('focusItem', null);
      f.detectChanges();
      expect(api.getLatestProjectAIChat).toHaveBeenCalledTimes(1);
      expect(api.getAICredits).toHaveBeenCalledTimes(1);
      expect(c.messages()).toEqual([m1, m2]);
      expect(c.draft()).toBe('書きかけ');
    });

    it('shows the answer when the user moved to another item in the same project', () => {
      const pending = new Subject<ProjectAIChatPostResponse>();
      const { f, c } = setup({
        getLatestProjectAIChat: vi.fn(() => of(noChat)),
        postProjectAIChat: vi.fn(() => pending),
      });
      c.draft.set('要約して');
      c.send();
      f.componentRef.setInput('focusItem', other);
      f.detectChanges();
      expect(c.sending()).toBe(true);
      pending.next(posted);
      expect(c.messages()).toEqual([m1, m2]);
      expect(c.sending()).toBe(false);
    });

    it('drops the description apply response when the open item changed', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const pending = new Subject<{ id: number }>();
      const { f, c } = setup({ updateItem: vi.fn(() => pending) });
      const applied: unknown[] = [];
      c.descriptionApplied.subscribe((item) => applied.push(item));
      c.applyToDescription('新説明');
      expect(c.applying()).toBe(true);
      f.componentRef.setInput('focusItem', other);
      f.detectChanges();
      expect(c.applying()).toBe(false);
      pending.next({ id: 10 });
      expect(applied).toEqual([]);
      expect(c.applying()).toBe(false);
    });

    it('drops the comment apply response and error when the open item changed', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const pending = new Subject<{ id: number }>();
      const { f, c } = setup({ createComment: vi.fn(() => pending) });
      const applied: unknown[] = [];
      c.commentApplied.subscribe(() => applied.push(true));
      c.applyAsComment('要約です');
      f.componentRef.setInput('focusItem', other);
      f.detectChanges();
      pending.error({ status: 500, error: { message: '失敗' } });
      expect(applied).toEqual([]);
      expect(c.error()).toBe('');
    });

    it('keeps the apply response when only title or canEdit of the same item changed', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const pending = new Subject<{ id: number }>();
      const { f, c } = setup({ updateItem: vi.fn(() => pending) });
      const applied: unknown[] = [];
      c.descriptionApplied.subscribe((item) => applied.push(item));
      c.applyToDescription('新説明');
      f.componentRef.setInput('focusItem', { ...focus, title: '改名' });
      f.detectChanges();
      expect(c.applying()).toBe(true);
      pending.next({ id: 10 });
      expect(applied).toEqual([{ id: 10 }]);
      expect(c.applying()).toBe(false);
    });
  });

  describe('stale responses: signed-in user', () => {
    it('empties the previous user conversation and list, and reloads when the user changes', () => {
      const pending = new Subject<ProjectAIChatView>();
      const pendingList = new Subject<ProjectAIConversation[]>();
      const getLatestProjectAIChat = vi.fn().mockReturnValueOnce(of(latest)).mockReturnValueOnce(pending);
      const listProjectAIConversations = vi
        .fn()
        .mockReturnValueOnce(of([c5, c4]))
        .mockReturnValueOnce(pendingList);
      const { f, c, user, api } = setup(
        { getLatestProjectAIChat, listProjectAIConversations },
        { layout: 'page', wide: true },
      );
      c.draft.set('前のユーザーの下書き');
      user.set(userOf(2));
      f.detectChanges();
      expect(c.messages()).toEqual([]);
      expect(c.conversationId()).toBeNull();
      expect(c.draft()).toBe('');
      expect(f.nativeElement.querySelector('.ai-chat-msg')).toBeNull();
      expect(rows(f)).toEqual([]);
      expect(getLatestProjectAIChat).toHaveBeenCalledTimes(2);
      expect(listProjectAIConversations).toHaveBeenCalledTimes(2);
      expect(api.getAICredits).toHaveBeenCalledTimes(2);
      pending.next(otherChat);
      pendingList.next([c4]);
      expect(c.messages()).toEqual([m3]);
      expect(c.conversations()).toEqual([c4]);
    });

    it('drops the in-flight answer of the previous user', () => {
      const pending = new Subject<ProjectAIChatPostResponse>();
      const getLatestProjectAIChat = vi.fn().mockReturnValueOnce(of(noChat)).mockReturnValueOnce(of(otherChat));
      const { f, c, user } = setup({ getLatestProjectAIChat, postProjectAIChat: vi.fn(() => pending) });
      c.draft.set('hi');
      c.send();
      user.set(userOf(2));
      f.detectChanges();
      expect(pending.observed).toBe(false);
      pending.next(posted);
      expect(c.messages()).toEqual([m3]);
      expect(c.sending()).toBe(false);
    });

    it('drops the previous user answer even before the view notices the change (L-571)', () => {
      const pending = new Subject<ProjectAIChatPostResponse>();
      const { c, user } = setup({
        getLatestProjectAIChat: vi.fn(() => of(noChat)),
        listProjectAIConversations: vi.fn(() => of([])),
        postProjectAIChat: vi.fn(() => pending),
      });
      c.draft.set('hi');
      c.send();
      user.set(userOf(2));
      pending.next(posted);
      expect(c.messages()).toEqual([]);
      expect(c.conversations()).toEqual([]);
    });

    it('drops a stale conversation response of the previous user', () => {
      const pending = new Subject<ProjectAIChatView>();
      const getLatestProjectAIChat = vi.fn().mockReturnValueOnce(pending).mockReturnValueOnce(of(otherChat));
      const { f, c, user } = setup({ getLatestProjectAIChat });
      user.set(userOf(2));
      f.detectChanges();
      pending.next(latest);
      expect(c.messages()).toEqual([m3]);
    });

    it('drops stale list and switch responses of the previous user before the view notices (L-571)', () => {
      const pendingList = new Subject<ProjectAIConversation[]>();
      const pendingSwitch = new Subject<ProjectAIConversationView>();
      const listProjectAIConversations = vi
        .fn()
        .mockReturnValueOnce(of([c5, c4]))
        .mockReturnValueOnce(pendingList);
      const { c, user } = setup({
        listProjectAIConversations,
        getProjectAIConversation: vi.fn(() => pendingSwitch),
      });
      c.selectConversation(4);
      c.loadConversations();
      user.set(userOf(2));
      pendingSwitch.next(older);
      pendingList.next([c4]);
      expect(c.conversationId()).toBe(5);
      expect(c.conversations()).toEqual([c5, c4]);
    });

    it('empties the conversation without reloading when the user signs out', () => {
      const { f, c, user, api } = setup();
      user.set(null);
      f.detectChanges();
      expect(c.messages()).toEqual([]);
      expect(c.conversations()).toEqual([]);
      expect(c.loading()).toBe(false);
      expect(api.getLatestProjectAIChat).toHaveBeenCalledTimes(1);
      expect(api.listProjectAIConversations).toHaveBeenCalledTimes(1);
    });

    it('does not reload when the same user object is replaced', () => {
      const { f, user, api } = setup();
      user.set({ ...userOf(1), displayName: '改名' });
      f.detectChanges();
      expect(api.getLatestProjectAIChat).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroy', () => {
    it('unsubscribes in-flight loads when destroyed', () => {
      const chat = new Subject<ProjectAIChatView>();
      const conversations = new Subject<ProjectAIConversation[]>();
      const credits = new Subject<AICredits>();
      const { f } = setup({
        getLatestProjectAIChat: vi.fn(() => chat),
        listProjectAIConversations: vi.fn(() => conversations),
        getAICredits: vi.fn(() => credits),
      });
      expect(chat.observed).toBe(true);
      expect(conversations.observed).toBe(true);
      expect(credits.observed).toBe(true);
      f.destroy();
      expect(chat.observed).toBe(false);
      expect(conversations.observed).toBe(false);
      expect(credits.observed).toBe(false);
    });

    it('unsubscribes an in-flight load of the given conversation when destroyed', () => {
      const given = new Subject<ProjectAIConversationView>();
      const { f } = setup(
        { getProjectAIConversation: vi.fn(() => given) },
        { initialConversationId: 4 },
      );
      expect(given.observed).toBe(true);
      f.destroy();
      expect(given.observed).toBe(false);
    });

    it('unsubscribes an in-flight send when destroyed', () => {
      const send = new Subject<ProjectAIChatPostResponse>();
      const { f, c } = setup({ postProjectAIChat: vi.fn(() => send) });
      c.draft.set('hi');
      c.send();
      expect(send.observed).toBe(true);
      f.destroy();
      expect(send.observed).toBe(false);
    });

    it('unsubscribes an in-flight switch when destroyed', () => {
      const pending = new Subject<ProjectAIConversationView>();
      const { f, c } = setup({ getProjectAIConversation: vi.fn(() => pending) });
      c.selectConversation(4);
      expect(pending.observed).toBe(true);
      f.destroy();
      expect(pending.observed).toBe(false);
    });

    it('unsubscribes an in-flight delete and apply when destroyed', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const remove = new Subject<void>();
      const apply = new Subject<{ id: number }>();
      const { f, c } = setup({
        deleteProjectAIConversation: vi.fn(() => remove),
        updateItem: vi.fn(() => apply),
      });
      c.applyToDescription('x');
      c.deleteShownConversation();
      expect(remove.observed).toBe(true);
      expect(apply.observed).toBe(true);
      f.destroy();
      expect(remove.observed).toBe(false);
      expect(apply.observed).toBe(false);
    });
  });

  describe('proposals', () => {
    it('shows the proposals under the answer and keeps their new state', async () => {
      const proposal: ProjectAIProposal = {
        id: 31, messageId: 2, kind: 'item_create', state: 'pending', title: '作る', columnId: 1, columnName: 'Todo',
        description: '', createdAt: '', updatedAt: '',
      };
      const withProposal: ProjectAIChatView = { conversation: c5, messages: [m1, { ...m2, proposals: [proposal] }] };
      const { f, c } = setup({ getLatestProjectAIChat: vi.fn(() => of(withProposal)) });
      f.detectChanges();
      const card = f.nativeElement.querySelector('app-project-ai-proposal-card');
      expect(card?.textContent).toContain('アイテムの作成（Todo）: 作る');
      let changedItems = 0;
      c.itemsChanged.subscribe(() => changedItems++);
      c.onProposalChanged({ ...proposal, state: 'dismissed' });
      f.detectChanges();
      expect(c.messages()[1].proposals![0].state).toBe('dismissed');
      expect(text(f)).toContain('破棄しました。');
      expect(changedItems).toBe(0);
    });
  });
});
