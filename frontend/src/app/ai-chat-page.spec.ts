import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiChatPage } from './ai-chat-page';
import { Api, AICredits } from './api';
import { AuthSession } from './auth-session';
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

function setup(opts: {
  bootstrapped?: boolean;
  switching?: boolean;
  activeId?: number | null;
} = {}) {
  const bootstrapped = signal(opts.bootstrapped ?? true);
  const switching = signal(opts.switching ?? false);
  const activeId = signal<number | null>(opts.activeId === undefined ? 1 : opts.activeId);
  const api = {
    listProjectAIChat: vi.fn(() => of([])),
    postProjectAIChat: vi.fn(),
    clearProjectAIChat: vi.fn(() => of(undefined)),
    getAICredits: vi.fn(() => of(okCredits)),
  };
  TestBed.configureTestingModule({
    imports: [AiChatPage],
    providers: [
      provideRouter([]),
      {
        provide: ProjectSession,
        useValue: { bootstrapped, switching, activeId, projects: signal([{ id: 1, name: 'P1', position: 0 }, { id: 7, name: 'P7', position: 1 }]) },
      },
      { provide: Api, useValue: api },
      {
        provide: AuthSession,
        useValue: { user: signal({ id: 1, loginName: 'u', displayName: 'U', role: 'member', disabled: false }) },
      },
    ],
  });
  const f = TestBed.createComponent(AiChatPage);
  f.detectChanges();
  TestBed.inject(ApplicationRef).tick();
  return { f, c: f.componentInstance, bootstrapped, switching, activeId, api };
}

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
    TestBed.resetTestingModule();
    const bootstrapped = signal(true);
    const switching = signal(false);
    const activeId = signal<number | null>(1);
    TestBed.configureTestingModule({
      imports: [AiChatPage],
      providers: [
        provideRouter([{ path: 'ai-chat', component: AiChatPage }]),
        {
          provide: ProjectSession,
          useValue: {
            bootstrapped,
            switching,
            activeId,
            projects: signal([{ id: 1, name: 'P1', position: 0 }]),
          },
        },
        {
          provide: Api,
          useValue: {
            listProjectAIChat: vi.fn(() => of([])),
            getAICredits: vi.fn(() => of(okCredits)),
          },
        },
        {
          provide: AuthSession,
          useValue: {
            user: signal({
              id: 1,
              loginName: 'u',
              displayName: 'U',
              role: 'member',
              disabled: false,
            }),
          },
        },
      ],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/ai-chat?project=01');
    const f = TestBed.createComponent(AiChatPage);
    f.detectChanges();
    expect(f.componentInstance.view()).toBe('invalid');
    expect(f.nativeElement.textContent).toContain('正しくありません');
    expect(f.nativeElement.querySelector('app-project-ai-chat')).toBeNull();
  });

  it('prefers ?project= over activeId so dock expand keeps the chat project', async () => {
    TestBed.resetTestingModule();
    const bootstrapped = signal(true);
    const switching = signal(false);
    const activeId = signal<number | null>(1);
    TestBed.configureTestingModule({
      imports: [AiChatPage],
      providers: [
        provideRouter([{ path: 'ai-chat', component: AiChatPage }]),
        {
          provide: ProjectSession,
          useValue: {
            bootstrapped,
            switching,
            activeId,
            projects: signal([
              { id: 1, name: 'P1', position: 0 },
              { id: 7, name: 'P7', position: 1 },
            ]),
          },
        },
        {
          provide: Api,
          useValue: {
            listProjectAIChat: vi.fn(() => of([])),
            getAICredits: vi.fn(() => of(okCredits)),
          },
        },
        {
          provide: AuthSession,
          useValue: {
            user: signal({
              id: 1,
              loginName: 'u',
              displayName: 'U',
              role: 'member',
              disabled: false,
            }),
          },
        },
      ],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/ai-chat?project=7');
    const f = TestBed.createComponent(AiChatPage);
    f.detectChanges();
    expect(f.componentInstance.projectId()).toBe(7);
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
