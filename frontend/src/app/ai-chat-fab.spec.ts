import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiChatContext } from './ai-chat-context';
import { AiChatFab } from './ai-chat-fab';
import type { AiChatFocusItem } from './ai-chat-target';
import { Api, AICredits } from './api';
import { AuthSession } from './auth-session';
import { ProjectAiChat } from './project-ai-chat';
import { ProjectSession } from './project-session';

const okCredits: AICredits = {
  limitTokens: null,
  usedTokens: 0,
  remainingTokens: null,
  unlimited: true,
  approximate: true,
  period: 'cumulative',
  configured: true,
};

const exhaustedCredits: AICredits = {
  limitTokens: 100,
  usedTokens: 100,
  remainingTokens: 0,
  unlimited: false,
  approximate: true,
  period: 'cumulative',
  configured: true,
};

function authStub(opts: { status?: string; user?: { id: number; loginName: string; displayName: string; role: string; disabled: boolean } | null } = {}) {
  const user =
    opts.user === null
      ? null
      : (opts.user ?? {
          id: 1,
          loginName: 'u',
          displayName: 'U',
          role: 'member',
          disabled: false,
        });
  return {
    status: signal(opts.status ?? 'authenticated'),
    user: signal(user),
  };
}

const handlers = { onDescriptionApplied: () => {}, onCommentApplied: () => {} };
const detailTarget = (
  partial: Partial<AiChatFocusItem> & { projectId?: number } = {},
): { projectId: number; item: AiChatFocusItem } => {
  const { projectId = 1, ...item } = partial;
  return {
    projectId,
    item: { number: 3, itemId: 30, title: 'ログインの修正', canEdit: true, ...item },
  };
};
const conversation = {
  id: 5,
  projectId: 1,
  title: '質問',
  createdAt: '2026-11-26T00:00:00Z',
  updatedAt: '2026-11-26T00:00:00Z',
};
const answer = {
  id: 2,
  projectId: 1,
  conversationId: 5,
  role: 'assistant',
  body: '回答',
  createdAt: '2026-11-26T00:00:00Z',
};

function setup(opts: {
  auth?: ReturnType<typeof authStub>;
  url?: string;
  activeId?: number | null;
  getAICredits?: ReturnType<typeof vi.fn>;
  getLatestProjectAIChat?: ReturnType<typeof vi.fn>;
} = {}) {
  const auth = opts.auth ?? authStub();
  const activeId = signal<number | null>(opts.activeId === undefined ? 1 : opts.activeId);
  const api = {
    getLatestProjectAIChat: opts.getLatestProjectAIChat ?? vi.fn(() => of({ conversation, messages: [answer] })),
    listProjectAIConversations: vi.fn(() => of([conversation])),
    getProjectAIConversation: vi.fn(() => of({ conversation, messages: [answer] })),
    deleteProjectAIConversation: vi.fn(() => of(undefined)),
    postProjectAIChat: vi.fn(() => of({ conversation, assistant: answer, messages: [answer] })),
    updateItem: vi.fn(() => of({ id: 10 })),
    createComment: vi.fn(() => of({ id: 1 })),
    getAICredits: opts.getAICredits ?? vi.fn(() => of(okCredits)),
  };
  TestBed.configureTestingModule({
    imports: [AiChatFab],
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      AiChatContext,
      { provide: AuthSession, useValue: auth },
      {
        provide: ProjectSession,
        useValue: { activeId },
      },
      { provide: Api, useValue: api },
    ],
  });
  const router = TestBed.inject(Router);
  vi.spyOn(router, 'url', 'get').mockReturnValue(opts.url ?? '/');
  const ctx = TestBed.inject(AiChatContext);
  const f = TestBed.createComponent(AiChatFab);
  f.detectChanges();
  return { f, ctx, auth, activeId, router, api };
}

function flushRender() {
  TestBed.inject(ApplicationRef).tick();
}

type Fab = ReturnType<typeof setup>['f'];
const entry = (f: Fab) => f.nativeElement.querySelector('.ai-chat-fab-entry') as HTMLButtonElement | null;
const chat = (f: Fab) => f.nativeElement.querySelector('app-project-ai-chat') as HTMLElement | null;
const applyButtonEls = (f: Fab) =>
  Array.from(
    (f.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.ai-chat-actions button'),
  );
const applyButtons = (f: Fab) => applyButtonEls(f).map((b) => b.textContent?.trim());
function openPanel(f: Fab) {
  entry(f)!.click();
  f.detectChanges();
}
const chatPanel = (f: Fab) =>
  f.debugElement.query(By.directive(ProjectAiChat)).componentInstance as ProjectAiChat;
const expandButton = (f: Fab) =>
  f.nativeElement.querySelector('.ai-chat-fab-expand') as HTMLButtonElement;
function ask(f: Fab, message: string) {
  const panel = chatPanel(f);
  panel.draft.set(message);
  panel.send();
  f.detectChanges();
}

describe('AiChatFab', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.querySelectorAll('dialog[open]').forEach((d) => d.removeAttribute('open'));
  });

  describe('entry', () => {
    it('hides entry when not logged in', () => {
      const { f, ctx } = setup({ auth: authStub({ status: 'anonymous', user: null }) });
      ctx.setBoard();
      f.detectChanges();
      expect(entry(f)).toBeNull();
    });

    it('hides entry for a disabled user', () => {
      const { f, ctx } = setup({
        auth: authStub({
          user: { id: 1, loginName: 'u', displayName: 'U', role: 'member', disabled: true },
        }),
      });
      ctx.setBoard();
      f.detectChanges();
      expect(entry(f)).toBeNull();
    });

    it('hides entry on non-ai-chat routes', () => {
      const { f, ctx } = setup({ url: '/settings' });
      ctx.setBoard();
      f.detectChanges();
      expect(entry(f)).toBeNull();
    });

    it('hides entry until a page tells its kind', () => {
      const { f } = setup();
      expect(entry(f)).toBeNull();
    });

    it('hides entry on board and backlog while no project is active', () => {
      const { f, ctx, activeId } = setup({ activeId: null });
      ctx.setBoard();
      f.detectChanges();
      expect(entry(f)).toBeNull();
      ctx.setBacklog();
      f.detectChanges();
      expect(entry(f)).toBeNull();
      activeId.set(1);
      f.detectChanges();
      expect(entry(f)).toBeTruthy();
    });

    it('hides entry on detail until the item is known', () => {
      const { f, ctx } = setup({ url: '/items/3' });
      ctx.clear();
      f.detectChanges();
      expect(entry(f)).toBeNull();
    });

    it('hides entry on detail when the item has no project', () => {
      const { f, ctx } = setup({ url: '/items/3' });
      ctx.setDetail(detailTarget({ projectId: 0 }), handlers);
      f.detectChanges();
      expect(entry(f)).toBeNull();
    });

    it('keeps entry on a read-only detail', () => {
      const { f, ctx } = setup({ url: '/items/3' });
      ctx.setDetail(detailTarget({ canEdit: false }), handlers);
      f.detectChanges();
      expect(entry(f)).toBeTruthy();
    });

    it('does not load anything until the panel is opened', () => {
      const { f, ctx, api } = setup();
      ctx.setBoard();
      f.detectChanges();
      expect(chat(f)).toBeNull();
      expect(api.getLatestProjectAIChat).not.toHaveBeenCalled();
      expect(api.getAICredits).not.toHaveBeenCalled();
    });

    it('keeps entry openable when credits are exhausted', () => {
      const { f, ctx } = setup({ getAICredits: vi.fn(() => of(exhaustedCredits)) });
      ctx.setBoard();
      f.detectChanges();
      expect(entry(f)!.disabled).toBe(false);
      openPanel(f);
      expect(chat(f)).toBeTruthy();
    });
  });

  describe('board and backlog', () => {
    it('asks about the active project without picking an item on board', () => {
      const { f, ctx, api } = setup({ activeId: 4 });
      ctx.setBoard();
      f.detectChanges();
      openPanel(f);
      expect(f.nativeElement.querySelector('select')).toBeNull();
      expect(chat(f)).toBeTruthy();
      expect(api.getLatestProjectAIChat).toHaveBeenCalledWith(4);
      ask(f, '期限が近いものは');
      expect(api.postProjectAIChat).toHaveBeenCalledWith(4, '期限が近いものは', 5, undefined);
    });

    it('asks about the active project without picking an item on backlog', () => {
      const { f, ctx, api } = setup({ url: '/backlog', activeId: 4 });
      ctx.setBacklog();
      f.detectChanges();
      openPanel(f);
      expect(f.nativeElement.querySelector('select')).toBeNull();
      ask(f, 'Doing は');
      expect(api.postProjectAIChat).toHaveBeenCalledWith(4, 'Doing は', 5, undefined);
    });

    it('shows no apply buttons on board', () => {
      const { f, ctx } = setup();
      ctx.setBoard();
      f.detectChanges();
      openPanel(f);
      expect(f.nativeElement.querySelector('.ai-chat-msg[data-role="assistant"]')).toBeTruthy();
      expect(applyButtons(f)).toEqual([]);
    });
  });

  describe('item detail', () => {
    it('uses the item project (not the active one) and sends the open item number', () => {
      const { f, ctx, api } = setup({ url: '/items/3', activeId: 1 });
      ctx.setDetail(detailTarget({ projectId: 7 }), handlers);
      f.detectChanges();
      openPanel(f);
      expect(api.getLatestProjectAIChat).toHaveBeenCalledWith(7);
      ask(f, '要約して');
      expect(api.postProjectAIChat).toHaveBeenCalledWith(7, '要約して', 5, 3);
    });

    it('shows apply buttons only when the open item is editable', () => {
      const { f, ctx } = setup({ url: '/items/3' });
      ctx.setDetail(detailTarget(), handlers);
      f.detectChanges();
      openPanel(f);
      expect(applyButtons(f)).toEqual(['説明に反映', 'コメント追加']);
      ctx.setDetail(detailTarget({ canEdit: false }), handlers);
      f.detectChanges();
      expect(applyButtons(f)).toEqual([]);
      expect(chat(f)).toBeTruthy();
    });

    it('confirms apply with the number and title of the open item', () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const { f, ctx } = setup({ url: '/items/3' });
      ctx.setDetail(detailTarget(), handlers);
      f.detectChanges();
      openPanel(f);
      const [toDescription, toComment] = applyButtonEls(f);
      toDescription.click();
      toComment.click();
      expect(confirm.mock.calls[0][0]).toContain('#3 ログインの修正 の説明を');
      expect(confirm.mock.calls[1][0]).toContain('#3 ログインの修正 に');
    });

    it('keeps the same chat (no reload) when moving to another item of the same project', () => {
      const { f, ctx, api } = setup({ url: '/items/3' });
      ctx.setDetail(detailTarget(), handlers);
      f.detectChanges();
      openPanel(f);
      const first = chat(f);
      ctx.setDetail(detailTarget({ number: 4, itemId: 40, title: '別' }), handlers);
      f.detectChanges();
      expect(chat(f)).toBe(first);
      expect(api.getLatestProjectAIChat).toHaveBeenCalledTimes(1);
      ask(f, 'これは');
      expect(api.postProjectAIChat).toHaveBeenCalledWith(1, 'これは', 5, 4);
    });

    it('keeps the chat and shows the in-flight answer when moving from one item detail to another', () => {
      const { f, ctx, api } = setup({ url: '/items/3' });
      ctx.setDetail(detailTarget(), handlers);
      f.detectChanges();
      openPanel(f);
      const firstEl = chat(f);
      const firstInstance = f.debugElement.query(By.directive(ProjectAiChat)).componentInstance;
      const pending = new Subject<{
        conversation: typeof conversation;
        assistant: typeof answer;
        messages: (typeof answer)[];
      }>();
      api.postProjectAIChat.mockReturnValue(pending);
      ask(f, '長い質問');
      // 実物の遷移順: 次のアイテムを読み込む間は開いているアイテムだけ外れ、読み込めたら setDetail
      ctx.releaseDetailItem();
      f.detectChanges();
      expect(entry(f)).toBeTruthy();
      expect(chat(f)).toBe(firstEl);
      expect(applyButtons(f)).toEqual([]);
      ctx.setDetail(detailTarget({ number: 4, itemId: 40, title: '別' }), handlers);
      f.detectChanges();
      expect(chat(f)).toBe(firstEl);
      expect(f.debugElement.query(By.directive(ProjectAiChat)).componentInstance).toBe(firstInstance);
      const late = { ...answer, id: 9, body: '移動の後に届いた回答' };
      pending.next({ conversation, assistant: late, messages: [answer, late] });
      pending.complete();
      f.detectChanges();
      expect(chat(f)!.textContent).toContain('移動の後に届いた回答');
      expect(api.getLatestProjectAIChat).toHaveBeenCalledTimes(1);
    });

    it('reloads the history when the next item detail belongs to another project', () => {
      const { f, ctx, api } = setup({ url: '/items/3' });
      ctx.setDetail(detailTarget(), handlers);
      f.detectChanges();
      openPanel(f);
      ctx.releaseDetailItem();
      f.detectChanges();
      ctx.setDetail(detailTarget({ number: 4, itemId: 40, projectId: 7 }), handlers);
      f.detectChanges();
      expect(chat(f)).toBeTruthy();
      expect(api.getLatestProjectAIChat).toHaveBeenLastCalledWith(7);
    });

    it('forwards descriptionApplied and commentApplied to context handlers', () => {
      const onDescriptionApplied = vi.fn();
      const onCommentApplied = vi.fn();
      const { f, ctx } = setup();
      ctx.setDetail(detailTarget(), { onDescriptionApplied, onCommentApplied });
      f.detectChanges();
      f.componentInstance.onDescriptionApplied({ id: 30 } as never);
      f.componentInstance.onCommentApplied();
      expect(onDescriptionApplied).toHaveBeenCalledWith({ id: 30 });
      expect(onCommentApplied).toHaveBeenCalled();
    });
  });

  describe('project switch', () => {
    it('closes the panel, then shows the history of the new project when reopened', () => {
      const other = { ...answer, id: 9, projectId: 2, body: '別のプロジェクトの回答' };
      const getLatestProjectAIChat = vi.fn((projectId: number) =>
        of({ conversation, messages: projectId === 2 ? [other] : [answer] }),
      );
      const { f, ctx, activeId } = setup({ getLatestProjectAIChat });
      ctx.setBoard();
      f.detectChanges();
      openPanel(f);
      expect(f.nativeElement.textContent).toContain('回答');
      activeId.set(2);
      f.detectChanges();
      expect(f.componentInstance.open()).toBe(false);
      expect(chat(f)).toBeNull();
      openPanel(f);
      expect(getLatestProjectAIChat).toHaveBeenLastCalledWith(2);
      expect(f.nativeElement.textContent).toContain('別のプロジェクトの回答');
      expect(f.nativeElement.querySelectorAll('.ai-chat-msg')).toHaveLength(1);
    });
  });

  describe('user switch', () => {
    it('shows the history of the new user, not the previous one', () => {
      const mine = { ...answer, id: 9, body: '次のユーザーの回答' };
      const getLatestProjectAIChat = vi
        .fn()
        .mockReturnValueOnce(of({ conversation, messages: [answer] }))
        .mockReturnValueOnce(of({ conversation, messages: [mine] }));
      const { f, ctx, auth } = setup({ getLatestProjectAIChat });
      ctx.setBoard();
      f.detectChanges();
      openPanel(f);
      auth.user.set({ id: 2, loginName: 'v', displayName: 'V', role: 'member', disabled: false });
      f.detectChanges();
      f.detectChanges();
      expect(getLatestProjectAIChat).toHaveBeenCalledTimes(2);
      const bodies = Array.from(f.nativeElement.querySelectorAll('.ai-chat-body')).map(
        (el) => (el as HTMLElement).textContent,
      );
      expect(bodies).toEqual(['次のユーザーの回答']);
    });
  });

  describe('open and close', () => {
    it('closes panel when navigating off ai-chat routes', () => {
      const { f, ctx } = setup();
      ctx.setBoard();
      f.detectChanges();
      openPanel(f);
      expect(f.componentInstance.open()).toBe(true);
      // simulate routeUrl update that onNavigation reads
      (f.componentInstance as unknown as { routeUrl: { set: (u: string) => void } }).routeUrl.set(
        '/settings',
      );
      f.componentInstance.onNavigation();
      f.detectChanges();
      expect(f.componentInstance.open()).toBe(false);
    });

    it('does not close on Esc while a dialog is open', () => {
      const { f, ctx } = setup();
      ctx.setBoard();
      f.detectChanges();
      openPanel(f);
      vi.advanceTimersByTime(300);
      const dialog = document.createElement('dialog');
      dialog.setAttribute('open', '');
      document.body.appendChild(dialog);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      f.detectChanges();
      expect(f.componentInstance.open()).toBe(true);
      dialog.remove();
    });

    it('closes on Esc after open guard and restores focus to entry', () => {
      const { f, ctx } = setup();
      ctx.setBoard();
      f.detectChanges();
      const btn = entry(f)!;
      openPanel(f);
      flushRender();
      expect(f.componentInstance.open()).toBe(true);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      f.detectChanges();
      expect(f.componentInstance.open()).toBe(true);
      vi.advanceTimersByTime(300);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      f.detectChanges();
      flushRender();
      expect(f.componentInstance.open()).toBe(false);
      expect(document.activeElement).toBe(btn);
    });

    it('ignores Esc while composing or keyCode 229', () => {
      const { f, ctx } = setup();
      ctx.setBoard();
      f.detectChanges();
      openPanel(f);
      vi.advanceTimersByTime(300);
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }),
      );
      f.detectChanges();
      expect(f.componentInstance.open()).toBe(true);
      const ime = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      Object.defineProperty(ime, 'keyCode', { get: () => 229 });
      document.dispatchEvent(ime);
      f.detectChanges();
      expect(f.componentInstance.open()).toBe(true);
    });

    it('ignores Esc repeat', () => {
      const { f, ctx } = setup();
      ctx.setBoard();
      f.detectChanges();
      openPanel(f);
      vi.advanceTimersByTime(300);
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, repeat: true }),
      );
      f.detectChanges();
      expect(f.componentInstance.open()).toBe(true);
    });

    it('skips focus restore when a dialog is open', () => {
      const { f, ctx } = setup();
      ctx.setBoard();
      f.detectChanges();
      const btn = entry(f)!;
      openPanel(f);
      flushRender();
      vi.advanceTimersByTime(300);
      const dialog = document.createElement('dialog');
      dialog.setAttribute('open', '');
      document.body.appendChild(dialog);
      f.componentInstance.closePanel({ restoreFocus: true });
      f.detectChanges();
      flushRender();
      expect(document.activeElement).not.toBe(btn);
      dialog.remove();
    });

    it('renders a full-height dock panel with expand control', () => {
      const { f, ctx } = setup();
      ctx.setBoard();
      f.detectChanges();
      openPanel(f);
      const panel = f.nativeElement.querySelector('#ai-chat-fab-panel') as HTMLElement;
      expect(panel).toBeTruthy();
      expect(panel.querySelector('.ai-chat-fab-expand')).toBeTruthy();
      expect(panel.querySelector('.ai-chat--dock')).toBeTruthy();
    });

    it('does not close on Esc while a textarea is focused (L-522)', () => {
      const { f, ctx } = setup();
      ctx.setBoard();
      f.detectChanges();
      openPanel(f);
      vi.advanceTimersByTime(300);
      const ta = f.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
      expect(ta).toBeTruthy();
      ta.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      f.detectChanges();
      expect(f.componentInstance.open()).toBe(true);
    });

    it('closes the dock only after a successful navigate to /ai-chat', async () => {
      const { f, ctx, router } = setup();
      ctx.setBoard();
      f.detectChanges();
      openPanel(f);
      const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      await f.componentInstance.expandToPage();
      f.detectChanges();
      expect(nav).toHaveBeenCalledWith(['/ai-chat'], {
        queryParams: { project: 1, conversation: 5 },
      });
      expect(f.componentInstance.open()).toBe(false);
      expect(f.componentInstance.expanding()).toBe(false);
    });

    it('hands the conversation picked in the dock over to the page', async () => {
      const { f, ctx, router, api } = setup();
      ctx.setBoard();
      f.detectChanges();
      openPanel(f);
      const picked = { ...conversation, id: 8 };
      api.getProjectAIConversation.mockReturnValue(of({ conversation: picked, messages: [] }));
      chatPanel(f).selectConversation(8);
      const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      await f.componentInstance.expandToPage();
      expect(nav).toHaveBeenCalledWith(['/ai-chat'], {
        queryParams: { project: 1, conversation: 8 },
      });
    });

    it('hands an unsaved new conversation over as conversation=new', async () => {
      const { f, ctx, router } = setup();
      ctx.setBoard();
      f.detectChanges();
      openPanel(f);
      chatPanel(f).startNew();
      const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      await f.componentInstance.expandToPage();
      expect(nav).toHaveBeenCalledWith(['/ai-chat'], {
        queryParams: { project: 1, conversation: 'new' },
      });
    });

    it('opens the page without a conversation while the dock has not settled one yet', async () => {
      const { f, ctx, router } = setup({ getLatestProjectAIChat: vi.fn(() => new Subject()) });
      ctx.setBoard();
      f.detectChanges();
      openPanel(f);
      const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      await f.componentInstance.expandToPage();
      expect(nav).toHaveBeenCalledWith(['/ai-chat'], { queryParams: { project: 1 } });
    });

    it('does not carry the conversation of a closed dock over to the next one', async () => {
      const { f, ctx, router, api } = setup();
      ctx.setBoard();
      f.detectChanges();
      openPanel(f);
      f.componentInstance.closePanel({ restoreFocus: false });
      f.detectChanges();
      api.getLatestProjectAIChat.mockReturnValue(new Subject());
      openPanel(f);
      const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      await f.componentInstance.expandToPage();
      expect(nav).toHaveBeenCalledWith(['/ai-chat'], { queryParams: { project: 1 } });
    });

    it('cannot expand while the dock is sending, and can again after the answer', async () => {
      const { f, ctx, router, api } = setup();
      ctx.setBoard();
      f.detectChanges();
      openPanel(f);
      const pending = new Subject<unknown>();
      api.postProjectAIChat.mockReturnValue(pending as never);
      const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      ask(f, '長い質問');
      expect(expandButton(f).disabled).toBe(true);
      await f.componentInstance.expandToPage();
      expect(nav).not.toHaveBeenCalled();
      expect(f.componentInstance.open()).toBe(true);
      pending.next({ conversation, assistant: answer, messages: [answer] });
      f.detectChanges();
      expect(expandButton(f).disabled).toBe(false);
      await f.componentInstance.expandToPage();
      expect(nav).toHaveBeenCalledTimes(1);
    });

    it('can expand after a dock that was closed while sending is opened again', () => {
      const { f, ctx, api } = setup();
      ctx.setBoard();
      f.detectChanges();
      openPanel(f);
      api.postProjectAIChat.mockReturnValue(new Subject() as never);
      ask(f, '長い質問');
      expect(expandButton(f).disabled).toBe(true);
      f.componentInstance.closePanel({ restoreFocus: false });
      f.detectChanges();
      openPanel(f);
      expect(expandButton(f).disabled).toBe(false);
    });

    it('can expand, without the previous conversation, after moving from the board to an item detail while sending', async () => {
      const { f, ctx, router, api } = setup();
      ctx.setBoard();
      f.detectChanges();
      openPanel(f);
      api.postProjectAIChat.mockReturnValue(new Subject() as never);
      ask(f, '長い質問');
      expect(expandButton(f).disabled).toBe(true);
      // ボードが破棄され、詳細が自分を伝える。パネルは開いたまま、チャットは作り直される
      ctx.clear();
      f.detectChanges();
      api.getLatestProjectAIChat.mockReturnValue(new Subject());
      ctx.setDetail(detailTarget(), handlers);
      f.detectChanges();
      expect(f.componentInstance.open()).toBe(true);
      expect(chat(f)).toBeTruthy();
      expect(expandButton(f).disabled).toBe(false);
      const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      await f.componentInstance.expandToPage();
      expect(nav).toHaveBeenCalledWith(['/ai-chat'], { queryParams: { project: 1 } });
    });

    it('does not hand the conversation of the previous project over while the next one is loading', async () => {
      const { f, ctx, router, api } = setup({ url: '/items/3' });
      ctx.setDetail(detailTarget(), handlers);
      f.detectChanges();
      openPanel(f);
      ctx.releaseDetailItem();
      f.detectChanges();
      api.getLatestProjectAIChat.mockReturnValue(new Subject());
      ctx.setDetail(detailTarget({ number: 4, itemId: 40, projectId: 7 }), handlers);
      f.detectChanges();
      const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      await f.componentInstance.expandToPage();
      expect(nav).toHaveBeenCalledWith(['/ai-chat'], { queryParams: { project: 7 } });
    });

    it('keeps the conversation the new chat reports right after it is made again', async () => {
      const { f, ctx, router } = setup();
      ctx.setBoard();
      f.detectChanges();
      openPanel(f);
      ctx.clear();
      f.detectChanges();
      ctx.setDetail(detailTarget(), handlers);
      f.detectChanges();
      const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      await f.componentInstance.expandToPage();
      expect(nav).toHaveBeenCalledWith(['/ai-chat'], {
        queryParams: { project: 1, conversation: 5 },
      });
    });

    it('passes the detail project id when it differs from activeId', async () => {
      const { f, ctx, router, activeId } = setup({ activeId: 1 });
      activeId.set(1);
      ctx.setDetail(detailTarget({ projectId: 7 }), handlers);
      f.detectChanges();
      openPanel(f);
      const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      await f.componentInstance.expandToPage();
      expect(nav).toHaveBeenCalledWith(['/ai-chat'], {
        queryParams: { project: 7, conversation: 5 },
      });
    });

    it('keeps the dock open when navigate fails', async () => {
      const { f, ctx, router } = setup();
      ctx.setBoard();
      f.detectChanges();
      openPanel(f);
      vi.spyOn(router, 'navigate').mockResolvedValue(false);
      await f.componentInstance.expandToPage();
      f.detectChanges();
      expect(f.componentInstance.open()).toBe(true);
      expect(f.componentInstance.expanding()).toBe(false);
    });

    it('keeps the dock open when navigate rejects', async () => {
      const { f, ctx, router } = setup();
      ctx.setBoard();
      f.detectChanges();
      openPanel(f);
      vi.spyOn(router, 'navigate').mockRejectedValue(new Error('nav failed'));
      await f.componentInstance.expandToPage();
      f.detectChanges();
      expect(f.componentInstance.open()).toBe(true);
      expect(f.componentInstance.expanding()).toBe(false);
    });
  });
});
