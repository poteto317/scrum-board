import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiChatFocusItem } from './ai-chat-target';
import { Api, AICredits, ProjectAIChatPostResponse, ProjectAIMessage } from './api';
import {
  AI_EXHAUSTED_MESSAGE,
  AI_LOW_REMAINING_MESSAGE,
  AI_UNCONFIGURED_MESSAGE,
} from './ai-unavailable-copy';
import { AuthSession } from './auth-session';
import { ProjectAiChat } from './project-ai-chat';

const m1: ProjectAIMessage = {
  id: 1,
  projectId: 1,
  role: 'user',
  body: '要約して',
  createdAt: '2026-11-21T00:00:00Z',
};
const m2: ProjectAIMessage = {
  id: 2,
  projectId: 1,
  role: 'assistant',
  body: '要約です',
  createdAt: '2026-11-21T00:00:01Z',
};
const m3: ProjectAIMessage = { ...m2, id: 3, body: '別の履歴' };
const posted: ProjectAIChatPostResponse = { assistant: m2, messages: [m1, m2] };

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

function setup(
  api: {
    listProjectAIChat?: ReturnType<typeof vi.fn>;
    postProjectAIChat?: ReturnType<typeof vi.fn>;
    clearProjectAIChat?: ReturnType<typeof vi.fn>;
    updateItem?: ReturnType<typeof vi.fn>;
    createComment?: ReturnType<typeof vi.fn>;
    getAICredits?: ReturnType<typeof vi.fn>;
  } = {},
  opts: {
    focusItem?: AiChatFocusItem | null;
    user?: User | null;
    layout?: 'fab' | 'dock' | 'page';
  } = {},
) {
  const user = signal<User | null>(opts.user === undefined ? userOf(1) : opts.user);
  const stubs = {
    listProjectAIChat: vi.fn(() => of([m1, m2])),
    postProjectAIChat: vi.fn(() => of(posted)),
    clearProjectAIChat: vi.fn(() => of(undefined)),
    updateItem: vi.fn(() => of({ id: 10 })),
    createComment: vi.fn(() => of({ id: 1 })),
    getAICredits: vi.fn(() => of(okCredits)),
    ...api,
  };
  TestBed.configureTestingModule({
    imports: [ProjectAiChat],
    providers: [
      provideRouter([]),
      { provide: Api, useValue: stubs },
      { provide: AuthSession, useValue: { user } },
    ],
  });
  const f = TestBed.createComponent(ProjectAiChat);
  f.componentRef.setInput('projectId', 1);
  f.componentRef.setInput('focusItem', opts.focusItem === undefined ? focus : opts.focusItem);
  if (opts.layout) f.componentRef.setInput('layout', opts.layout);
  f.detectChanges();
  return { f, c: f.componentInstance, user, api: stubs };
}

const text = (f: { nativeElement: HTMLElement }) => f.nativeElement.textContent ?? '';
const applyButtons = (f: { nativeElement: HTMLElement }) =>
  Array.from(f.nativeElement.querySelectorAll<HTMLButtonElement>('.ai-chat-actions button')).map(
    (b) => b.textContent?.trim(),
  );

describe('ProjectAiChat', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
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

  describe('history', () => {
    it('loads the project history and credits on init', () => {
      const { c, api } = setup();
      expect(api.listProjectAIChat).toHaveBeenCalledTimes(1);
      expect(api.listProjectAIChat).toHaveBeenCalledWith(1);
      expect(api.getAICredits).toHaveBeenCalledTimes(1);
      expect(c.messages()).toEqual([m1, m2]);
    });

    it('shows the project-wide empty message', () => {
      const { f } = setup({ listProjectAIChat: vi.fn(() => of([])) });
      expect(f.nativeElement.querySelector('.ai-chat-empty')?.textContent).toBe(
        'このプロジェクトについて質問できます。',
      );
    });

    it('shows the load error and reloads on retry (L-001)', () => {
      const listProjectAIChat = vi
        .fn()
        .mockReturnValueOnce(throwError(() => ({ status: 500, error: { message: '失敗' } })))
        .mockReturnValueOnce(of([m1]));
      const { f, c } = setup({ listProjectAIChat });
      expect(c.loadError()).toBe('失敗');
      (f.nativeElement.querySelector('.ai-chat-error button') as HTMLButtonElement).click();
      expect(c.loadError()).toBe('');
      expect(c.messages()).toEqual([m1]);
    });

    it('clears own history after the project-scoped confirm', () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { c, api } = setup();
      c.clear();
      expect(confirm).toHaveBeenCalledWith(
        'このプロジェクトでの自分の AI チャット履歴を削除しますか？',
      );
      expect(api.clearProjectAIChat).toHaveBeenCalledWith(1);
      expect(c.messages()).toEqual([]);
      expect(c.clearing()).toBe(false);
    });

    it('keeps history when the clear confirm is cancelled', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      const { c, api } = setup();
      c.clear();
      expect(api.clearProjectAIChat).not.toHaveBeenCalled();
      expect(c.messages()).toEqual([m1, m2]);
    });

    it('keeps history and shows the error when clear fails (L-001)', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const clearProjectAIChat = vi.fn(() =>
        throwError(() => ({ status: 500, error: { message: '消せません' } })),
      );
      const { c } = setup({ clearProjectAIChat });
      c.clear();
      expect(c.messages()).toEqual([m1, m2]);
      expect(c.error()).toBe('消せません');
      expect(c.clearing()).toBe(false);
    });
  });

  describe('send', () => {
    it('sends without focusItemNumber when no item is open (board / backlog)', () => {
      const { c, api } = setup({}, { focusItem: null });
      c.draft.set('期限が近いものは');
      c.send();
      expect(api.postProjectAIChat).toHaveBeenCalledWith(1, '期限が近いものは', undefined);
      expect(c.messages()).toEqual([m1, m2]);
      expect(c.draft()).toBe('');
      expect(c.sending()).toBe(false);
      expect(c.error()).toBe('');
    });

    it('sends the open item number from item detail', () => {
      const { c, api } = setup();
      c.draft.set('要約して');
      c.send();
      expect(api.postProjectAIChat).toHaveBeenCalledWith(1, '要約して', 3);
    });

    it('sends the open item number even when the item is read-only', () => {
      const { c, api } = setup({}, { focusItem: { ...focus, canEdit: false } });
      c.draft.set('要約して');
      c.send();
      expect(api.postProjectAIChat).toHaveBeenCalledWith(1, '要約して', 3);
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
      const postProjectAIChat = vi.fn(() =>
        throwError(() => ({ status: 503, error: { message: 'AIが設定されていません。' } })),
      );
      const { c } = setup({ postProjectAIChat });
      c.draft.set('hi');
      c.send();
      expect(c.draft()).toBe('hi');
      expect(c.sending()).toBe(false);
      expect(c.error()).toBe('AIが設定されていません。');
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
      expect((f.nativeElement.querySelector('.ai-chat-head button') as HTMLButtonElement).disabled).toBe(
        false,
      );
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
    it('reloads history and credits when projectId changes', () => {
      const listProjectAIChat = vi.fn().mockReturnValueOnce(of([m1, m2])).mockReturnValueOnce(of([m3]));
      const { f, c, api } = setup({ listProjectAIChat });
      c.draft.set('書きかけ');
      f.componentRef.setInput('projectId', 2);
      f.detectChanges();
      expect(listProjectAIChat).toHaveBeenLastCalledWith(2);
      expect(api.getAICredits).toHaveBeenCalledTimes(2);
      expect(c.messages()).toEqual([m3]);
      expect(c.draft()).toBe('');
    });

    it('does not show the previous project history while the new one loads', () => {
      const pending = new Subject<ProjectAIMessage[]>();
      const listProjectAIChat = vi.fn().mockReturnValueOnce(of([m1, m2])).mockReturnValueOnce(pending);
      const { f, c } = setup({ listProjectAIChat });
      f.componentRef.setInput('projectId', 2);
      f.detectChanges();
      expect(c.messages()).toEqual([]);
      expect(c.loading()).toBe(true);
    });

    it('drops a stale list response after projectId change', () => {
      const pending = new Subject<ProjectAIMessage[]>();
      const listProjectAIChat = vi.fn().mockReturnValueOnce(pending).mockReturnValueOnce(of([m3]));
      const { f, c } = setup({ listProjectAIChat });
      f.componentRef.setInput('projectId', 2);
      f.detectChanges();
      pending.next([m1]);
      pending.complete();
      expect(c.messages()).toEqual([m3]);
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
      const listProjectAIChat = vi.fn().mockReturnValueOnce(of([])).mockReturnValueOnce(of([m3]));
      const postProjectAIChat = vi.fn().mockReturnValueOnce(pending).mockReturnValueOnce(of(posted));
      const { f, c } = setup({ listProjectAIChat, postProjectAIChat });
      c.draft.set('hi');
      c.send();
      expect(c.sending()).toBe(true);
      f.componentRef.setInput('projectId', 2);
      f.detectChanges();
      expect(pending.observed).toBe(false);
      pending.next(posted);
      expect(c.messages()).toEqual([m3]);
      expect(c.sending()).toBe(false);
      c.draft.set('again');
      c.send();
      expect(postProjectAIChat).toHaveBeenLastCalledWith(2, 'again', 3);
    });

    it('drops a stale clear response after projectId change', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const pending = new Subject<void>();
      const listProjectAIChat = vi.fn().mockReturnValueOnce(of([m1])).mockReturnValueOnce(of([m3]));
      const { f, c } = setup({ listProjectAIChat, clearProjectAIChat: vi.fn(() => pending) });
      c.clear();
      expect(c.clearing()).toBe(true);
      f.componentRef.setInput('projectId', 2);
      f.detectChanges();
      pending.next();
      expect(c.messages()).toEqual([m3]);
      expect(c.clearing()).toBe(false);
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
      expect(api.listProjectAIChat).toHaveBeenCalledTimes(1);
      expect(api.getAICredits).toHaveBeenCalledTimes(1);
      expect(c.messages()).toEqual([m1, m2]);
      expect(c.draft()).toBe('書きかけ');
    });

    it('shows the answer when the user moved to another item in the same project', () => {
      const pending = new Subject<ProjectAIChatPostResponse>();
      const { f, c } = setup({
        listProjectAIChat: vi.fn(() => of([])),
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
    it('empties the previous user history and reloads when the user changes', () => {
      const pending = new Subject<ProjectAIMessage[]>();
      const listProjectAIChat = vi.fn().mockReturnValueOnce(of([m1, m2])).mockReturnValueOnce(pending);
      const { f, c, user, api } = setup({ listProjectAIChat });
      c.draft.set('前のユーザーの下書き');
      user.set(userOf(2));
      f.detectChanges();
      expect(c.messages()).toEqual([]);
      expect(c.draft()).toBe('');
      expect(f.nativeElement.querySelector('.ai-chat-msg')).toBeNull();
      expect(listProjectAIChat).toHaveBeenCalledTimes(2);
      expect(api.getAICredits).toHaveBeenCalledTimes(2);
      pending.next([m3]);
      expect(c.messages()).toEqual([m3]);
    });

    it('drops the in-flight answer of the previous user', () => {
      const pending = new Subject<ProjectAIChatPostResponse>();
      const listProjectAIChat = vi.fn().mockReturnValueOnce(of([])).mockReturnValueOnce(of([m3]));
      const { f, c, user } = setup({ listProjectAIChat, postProjectAIChat: vi.fn(() => pending) });
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
        listProjectAIChat: vi.fn(() => of([])),
        postProjectAIChat: vi.fn(() => pending),
      });
      c.draft.set('hi');
      c.send();
      user.set(userOf(2));
      pending.next(posted);
      expect(c.messages()).toEqual([]);
    });

    it('drops a stale list response of the previous user', () => {
      const pending = new Subject<ProjectAIMessage[]>();
      const listProjectAIChat = vi.fn().mockReturnValueOnce(pending).mockReturnValueOnce(of([m3]));
      const { f, c, user } = setup({ listProjectAIChat });
      user.set(userOf(2));
      f.detectChanges();
      pending.next([m1, m2]);
      expect(c.messages()).toEqual([m3]);
    });

    it('empties history without reloading when the user signs out', () => {
      const { f, c, user, api } = setup();
      user.set(null);
      f.detectChanges();
      expect(c.messages()).toEqual([]);
      expect(c.loading()).toBe(false);
      expect(api.listProjectAIChat).toHaveBeenCalledTimes(1);
    });

    it('does not reload when the same user object is replaced', () => {
      const { f, user, api } = setup();
      user.set({ ...userOf(1), displayName: '改名' });
      f.detectChanges();
      expect(api.listProjectAIChat).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroy', () => {
    it('unsubscribes in-flight loads when destroyed', () => {
      const list = new Subject<ProjectAIMessage[]>();
      const credits = new Subject<AICredits>();
      const { f } = setup({ listProjectAIChat: vi.fn(() => list), getAICredits: vi.fn(() => credits) });
      expect(list.observed).toBe(true);
      expect(credits.observed).toBe(true);
      f.destroy();
      expect(list.observed).toBe(false);
      expect(credits.observed).toBe(false);
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

    it('unsubscribes an in-flight clear and apply when destroyed', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const clear = new Subject<void>();
      const apply = new Subject<{ id: number }>();
      const { f, c } = setup({
        clearProjectAIChat: vi.fn(() => clear),
        updateItem: vi.fn(() => apply),
      });
      c.clear();
      c.applyToDescription('x');
      expect(clear.observed).toBe(true);
      expect(apply.observed).toBe(true);
      f.destroy();
      expect(clear.observed).toBe(false);
      expect(apply.observed).toBe(false);
    });
  });
});
