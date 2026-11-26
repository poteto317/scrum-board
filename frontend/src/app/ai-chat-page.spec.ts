import { ApplicationRef, DebugElement, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiChatPage } from './ai-chat-page';
import { Api, AICredits } from './api';
import { AuthSession } from './auth-session';
import { ProjectAiChat } from './project-ai-chat';
import { ProjectSession } from './project-session';
import { routes } from './app.routes';
import { authGuard } from './auth.guard';

const okCredits: AICredits = {
  limitTokens: null,
  usedTokens: 0,
  remainingTokens: null,
  unlimited: true,
  approximate: true,
  period: 'cumulative',
  configured: true,
};

const conversation = {
  id: 5,
  projectId: 1,
  title: '質問',
  createdAt: '2026-11-26T00:00:00Z',
  updatedAt: '2026-11-26T00:00:00Z',
};
const picked = { ...conversation, id: 8, title: '別の質問' };

function apiStub() {
  return {
    getLatestProjectAIChat: vi.fn(() => of({ conversation, messages: [] })),
    listProjectAIConversations: vi.fn(() => of([conversation, picked])),
    getProjectAIConversation: vi.fn((_: number, conversationId: number) =>
      of({ conversation: { ...picked, id: conversationId }, messages: [] }),
    ),
    deleteProjectAIConversation: vi.fn(() => of(undefined)),
    postProjectAIChat: vi.fn(),
    getAICredits: vi.fn(() => of(okCredits)),
  };
}

const authStub = () => ({
  user: signal({ id: 1, loginName: 'u', displayName: 'U', role: 'member', disabled: false }),
});

const projectList = [
  { id: 1, name: 'P1', position: 0 },
  { id: 7, name: 'P7', position: 1 },
];

function setup(opts: {
  bootstrapped?: boolean;
  switching?: boolean;
  activeId?: number | null;
} = {}) {
  const bootstrapped = signal(opts.bootstrapped ?? true);
  const switching = signal(opts.switching ?? false);
  const activeId = signal<number | null>(opts.activeId === undefined ? 1 : opts.activeId);
  const api = apiStub();
  TestBed.configureTestingModule({
    imports: [AiChatPage],
    providers: [
      provideRouter([]),
      {
        provide: ProjectSession,
        useValue: { bootstrapped, switching, activeId, projects: signal(projectList) },
      },
      { provide: Api, useValue: api },
      { provide: AuthSession, useValue: authStub() },
    ],
  });
  const f = TestBed.createComponent(AiChatPage);
  f.detectChanges();
  TestBed.inject(ApplicationRef).tick();
  return { f, c: f.componentInstance, bootstrapped, switching, activeId, api };
}

/** 実際の URL（クエリ付き）で開く */
async function setupAt(url: string, projects = projectList) {
  const api = apiStub();
  TestBed.configureTestingModule({
    imports: [AiChatPage],
    providers: [
      provideRouter([{ path: 'ai-chat', component: AiChatPage }]),
      {
        provide: ProjectSession,
        useValue: {
          bootstrapped: signal(true),
          switching: signal(false),
          activeId: signal<number | null>(1),
          projects: signal(projects),
        },
      },
      { provide: Api, useValue: api },
      { provide: AuthSession, useValue: authStub() },
    ],
  });
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  const navigate = vi.spyOn(router, 'navigate');
  const f = TestBed.createComponent(AiChatPage);
  f.detectChanges();
  await f.whenStable();
  return { f, c: f.componentInstance, api, router, navigate };
}

const chatOf = (f: { debugElement: DebugElement }) =>
  f.debugElement.query(By.directive(ProjectAiChat)).componentInstance as ProjectAiChat;

describe('AiChatPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('shows waiting while not bootstrapped or switching', () => {
    const { f, bootstrapped } = setup({ bootstrapped: false });
    expect(f.nativeElement.textContent).toContain('読み込み中');
    expect(f.nativeElement.querySelector('app-project-ai-chat')).toBeNull();
    bootstrapped.set(true);
    f.detectChanges();
    expect(f.nativeElement.querySelector('app-project-ai-chat')).not.toBeNull();
  });

  it('shows empty guidance when no project is selected', () => {
    const { f } = setup({ activeId: null });
    expect(f.nativeElement.textContent).toContain('プロジェクトを選ぶと');
    expect(f.nativeElement.querySelector('app-project-ai-chat')).toBeNull();
    expect(f.nativeElement.textContent).not.toContain('ログイン');
  });

  it('renders ProjectAiChat in page layout without focusItem', () => {
    const { f } = setup({ activeId: 2 });
    const chat = f.nativeElement.querySelector('app-project-ai-chat');
    expect(chat).not.toBeNull();
    expect(f.nativeElement.querySelector('.ai-chat--page')).not.toBeNull();
    expect(f.nativeElement.querySelectorAll('.ai-chat-actions button').length).toBe(0);
  });

  it('shows invalid alert for bad ?project= and does not fall back to activeId', async () => {
    const { f } = await setupAt('/ai-chat?project=01', [projectList[0]]);
    expect(f.componentInstance.view()).toBe('invalid');
    expect(f.nativeElement.textContent).toContain('正しくありません');
    expect(f.nativeElement.querySelector('app-project-ai-chat')).toBeNull();
  });

  it('prefers ?project= over activeId so dock expand keeps the chat project', async () => {
    const { f } = await setupAt('/ai-chat?project=7');
    expect(f.componentInstance.projectId()).toBe(7);
  });

  describe('?conversation=', () => {
    it('opens the conversation of the id in the query', async () => {
      const { f, api } = await setupAt('/ai-chat?project=7&conversation=8');
      expect(api.getProjectAIConversation).toHaveBeenCalledWith(7, 8);
      expect(api.getLatestProjectAIChat).not.toHaveBeenCalled();
      expect(chatOf(f).conversationId()).toBe(8);
    });

    it('opens an empty new conversation for conversation=new', async () => {
      const { f, api, router, navigate } = await setupAt('/ai-chat?project=7&conversation=new');
      expect(api.getProjectAIConversation).not.toHaveBeenCalled();
      expect(api.getLatestProjectAIChat).not.toHaveBeenCalled();
      expect(chatOf(f).conversationId()).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
      expect(router.url).toBe('/ai-chat?project=7&conversation=new');
    });

    it('opens the latest conversation when the query is absent, and writes it to the URL', async () => {
      const { f, api, router } = await setupAt('/ai-chat?project=7');
      expect(api.getLatestProjectAIChat).toHaveBeenCalledWith(7);
      expect(api.getProjectAIConversation).not.toHaveBeenCalled();
      expect(chatOf(f).conversationId()).toBe(5);
      expect(router.url).toBe('/ai-chat?project=7&conversation=5');
    });

    it('treats an invalid query as absent', async () => {
      for (const raw of ['abc', '0', '-3', '01']) {
        const { api } = await setupAt(`/ai-chat?project=7&conversation=${raw}`);
        expect(api.getLatestProjectAIChat).toHaveBeenCalledWith(7);
        expect(api.getProjectAIConversation).not.toHaveBeenCalled();
        TestBed.resetTestingModule();
      }
    });

    it('does not navigate when the URL already names the shown conversation', async () => {
      const { navigate } = await setupAt('/ai-chat?project=7&conversation=8');
      expect(navigate).not.toHaveBeenCalled();
    });

    it('rewrites conversation in place and keeps project when the conversation is switched', async () => {
      const { f, api, router, navigate } = await setupAt('/ai-chat?project=7&conversation=5');
      chatOf(f).selectConversation(8);
      await f.whenStable();
      expect(navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({
          queryParams: { conversation: 8 },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        }),
      );
      expect(router.url).toBe('/ai-chat?project=7&conversation=8');
      // URL を書き換えても、読み直さない（initialConversationId は最初の読み込みだけ）
      expect(api.getProjectAIConversation).toHaveBeenCalledTimes(2);
      expect(api.getLatestProjectAIChat).not.toHaveBeenCalled();
    });

    it('writes conversation=new when a new conversation is started', async () => {
      const { f, router } = await setupAt('/ai-chat?project=7&conversation=5');
      chatOf(f).startNew();
      await f.whenStable();
      expect(router.url).toBe('/ai-chat?project=7&conversation=new');
    });

    it('keeps the path without project when it was opened without one', async () => {
      const { f, router } = await setupAt('/ai-chat');
      await f.whenStable();
      expect(router.url).toBe('/ai-chat?conversation=5');
    });
  });

  it('goes back via Location when history has entries', () => {
    const { f, c } = setup();
    const location = TestBed.inject(Location);
    const back = vi.spyOn(location, 'back');
    Object.defineProperty(history, 'length', { configurable: true, get: () => 3 });
    c.goBack();
    expect(back).toHaveBeenCalled();
  });

  it('navigates home when history is empty', async () => {
    const { f, c } = setup();
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    Object.defineProperty(history, 'length', { configurable: true, get: () => 1 });
    c.goBack();
    expect(nav).toHaveBeenCalledWith('/');
    f.detectChanges();
  });

  it('registers /ai-chat with authGuard', async () => {
    const route = routes.find((r) => r.path === 'ai-chat');
    expect(route).toBeTruthy();
    expect(route?.canActivate).toEqual(expect.arrayContaining([authGuard]));
    const loaded = await route!.loadComponent!();
    expect(loaded).toBeTruthy();
  });
});
