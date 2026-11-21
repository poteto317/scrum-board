import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiChatContext } from './ai-chat-context';
import { AiChatFab } from './ai-chat-fab';
import { Api, AICredits } from './api';
import { AuthSession } from './auth-session';
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

function setup(opts: {
  auth?: ReturnType<typeof authStub>;
  url?: string;
  getAICredits?: ReturnType<typeof vi.fn>;
} = {}) {
  const auth = opts.auth ?? authStub();
  const activeId = signal<number | null>(1);
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
      {
        provide: Api,
        useValue: {
          listAIChat: vi.fn(() => of([])),
          postAIChat: vi.fn(() => of({ messages: [] })),
          clearAIChat: vi.fn(() => of(undefined)),
          updateItem: vi.fn(() => of({ id: 10 })),
          createComment: vi.fn(() => of({ id: 1 })),
          getAICredits: opts.getAICredits ?? vi.fn(() => of(okCredits)),
          getAIUsage: vi.fn(() => of({})),
        },
      },
    ],
  });
  const router = TestBed.inject(Router);
  vi.spyOn(router, 'url', 'get').mockReturnValue(opts.url ?? '/');
  const ctx = TestBed.inject(AiChatContext);
  const f = TestBed.createComponent(AiChatFab);
  f.detectChanges();
  return { f, ctx, auth, activeId, router };
}

function flushRender() {
  TestBed.inject(ApplicationRef).tick();
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

  it('hides entry when not logged in', () => {
    const { f, ctx } = setup({ auth: authStub({ status: 'anonymous', user: null }) });
    ctx.setBoard([{ number: 1, projectId: 1, itemId: 10, title: 'A', canEdit: true }]);
    f.detectChanges();
    expect(f.nativeElement.querySelector('.ai-chat-fab-entry')).toBeNull();
  });

  it('hides entry on non-ai-chat routes', () => {
    const { f, ctx } = setup({ url: '/settings' });
    ctx.setBoard([{ number: 1, projectId: 1, itemId: 10, title: 'A', canEdit: true }]);
    f.detectChanges();
    expect(f.nativeElement.querySelector('.ai-chat-fab-entry')).toBeNull();
  });

  it('hides entry when board has no editable candidates', () => {
    const { f, ctx } = setup();
    ctx.setBoard([{ number: 1, projectId: 1, itemId: 10, title: 'A', canEdit: false }]);
    f.detectChanges();
    expect(f.nativeElement.querySelector('.ai-chat-fab-entry')).toBeNull();
  });

  it('hides entry on read-only detail (no routeTarget)', () => {
    const { f, ctx } = setup({ url: '/items/3' });
    ctx.clear();
    f.detectChanges();
    expect(f.nativeElement.querySelector('.ai-chat-fab-entry')).toBeNull();
  });

  it('closes panel and clears selection when navigating off ai-chat routes', () => {
    const { f, ctx } = setup();
    ctx.setBoard([{ number: 1, projectId: 1, itemId: 10, title: 'A', canEdit: true }]);
    f.detectChanges();
    (f.nativeElement.querySelector('.ai-chat-fab-entry') as HTMLButtonElement).click();
    f.detectChanges();
    f.componentInstance.onSelectChange('1:1:10');
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(true);
    // simulate routeUrl update that onNavigation reads
    (f.componentInstance as unknown as { routeUrl: { set: (u: string) => void } }).routeUrl.set(
      '/settings',
    );
    f.componentInstance.onNavigation();
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(false);
    expect(f.componentInstance.selected()).toBeNull();
  });

  it('does not close on Esc while a dialog is open', () => {
    const { f, ctx } = setup();
    ctx.setDetail(
      { number: 3, projectId: 1, itemId: 30 },
      { onDescriptionApplied: () => {}, onCommentApplied: () => {} },
    );
    f.detectChanges();
    (f.nativeElement.querySelector('.ai-chat-fab-entry') as HTMLButtonElement).click();
    f.detectChanges();
    vi.advanceTimersByTime(300);
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.appendChild(dialog);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(true);
    dialog.remove();
  });

  it('shows entry on board with editable candidates and opens panel', () => {
    const getAICredits = vi.fn(() => of(okCredits));
    const { f, ctx } = setup({ getAICredits });
    ctx.setBoard([
      { number: 1, projectId: 1, itemId: 10, title: 'A', canEdit: true },
      { number: 2, projectId: 1, itemId: 20, title: 'B', canEdit: false },
    ]);
    f.detectChanges();
    const entry = f.nativeElement.querySelector('.ai-chat-fab-entry') as HTMLButtonElement;
    expect(entry).toBeTruthy();
    expect(f.nativeElement.querySelector('app-item-ai-chat')).toBeNull();
    entry.click();
    f.detectChanges();
    expect(f.nativeElement.querySelector('.ai-chat-fab-panel')).toBeTruthy();
    expect(f.nativeElement.querySelector('app-item-ai-chat')).toBeNull();
    expect(getAICredits).not.toHaveBeenCalled();
    const hint = f.nativeElement.querySelector('.ai-chat-fab-hint');
    expect(hint?.textContent).toContain('アイテムを選ぶと');
  });

  it('mounts ItemAiChat after selecting an editable target', () => {
    const getAICredits = vi.fn(() => of(okCredits));
    const { f, ctx } = setup({ getAICredits });
    ctx.setBoard([{ number: 1, projectId: 1, itemId: 10, title: 'A', canEdit: true }]);
    f.detectChanges();
    (f.nativeElement.querySelector('.ai-chat-fab-entry') as HTMLButtonElement).click();
    f.detectChanges();
    f.componentInstance.onSelectChange('1:1:10');
    f.detectChanges();
    expect(f.nativeElement.querySelector('app-item-ai-chat')).toBeTruthy();
    expect(getAICredits).toHaveBeenCalled();
  });

  it('keeps entry openable when credits are exhausted', () => {
    const getAICredits = vi.fn(() => of(exhaustedCredits));
    const { f, ctx } = setup({ getAICredits });
    ctx.setDetail(
      { number: 3, projectId: 1, itemId: 30 },
      { onDescriptionApplied: () => {}, onCommentApplied: () => {} },
    );
    f.detectChanges();
    const entry = f.nativeElement.querySelector('.ai-chat-fab-entry') as HTMLButtonElement;
    expect(entry.disabled).toBe(false);
    entry.click();
    f.detectChanges();
    expect(f.nativeElement.querySelector('app-item-ai-chat')).toBeTruthy();
  });

  it('closes on Esc after open guard and restores focus to entry', () => {
    const { f, ctx } = setup();
    ctx.setDetail(
      { number: 3, projectId: 1, itemId: 30 },
      { onDescriptionApplied: () => {}, onCommentApplied: () => {} },
    );
    f.detectChanges();
    const entry = f.nativeElement.querySelector('.ai-chat-fab-entry') as HTMLButtonElement;
    entry.click();
    f.detectChanges();
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
    expect(document.activeElement).toBe(entry);
  });

  it('ignores Esc while composing or keyCode 229', () => {
    const { f, ctx } = setup();
    ctx.setDetail(
      { number: 3, projectId: 1, itemId: 30 },
      { onDescriptionApplied: () => {}, onCommentApplied: () => {} },
    );
    f.detectChanges();
    (f.nativeElement.querySelector('.ai-chat-fab-entry') as HTMLButtonElement).click();
    f.detectChanges();
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
    ctx.setDetail(
      { number: 3, projectId: 1, itemId: 30 },
      { onDescriptionApplied: () => {}, onCommentApplied: () => {} },
    );
    f.detectChanges();
    (f.nativeElement.querySelector('.ai-chat-fab-entry') as HTMLButtonElement).click();
    f.detectChanges();
    vi.advanceTimersByTime(300);
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, repeat: true }),
    );
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(true);
  });

  it('clears selected when candidate leaves the list', () => {
    const { f, ctx } = setup();
    ctx.setBoard([{ number: 1, projectId: 1, itemId: 10, title: 'A', canEdit: true }]);
    f.detectChanges();
    (f.nativeElement.querySelector('.ai-chat-fab-entry') as HTMLButtonElement).click();
    f.detectChanges();
    f.componentInstance.onSelectChange('1:1:10');
    f.detectChanges();
    expect(f.componentInstance.activeTarget()?.number).toBe(1);
    ctx.setBoard([{ number: 2, projectId: 1, itemId: 20, title: 'B', canEdit: true }]);
    f.detectChanges();
    expect(f.componentInstance.activeTarget()).toBeNull();
  });

  it('closes and clears selection on project switch', () => {
    const { f, ctx, activeId } = setup();
    ctx.setBoard([{ number: 1, projectId: 1, itemId: 10, title: 'A', canEdit: true }]);
    f.detectChanges();
    (f.nativeElement.querySelector('.ai-chat-fab-entry') as HTMLButtonElement).click();
    f.detectChanges();
    f.componentInstance.onSelectChange('1:1:10');
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(true);
    activeId.set(2);
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(false);
    expect(f.componentInstance.selected()).toBeNull();
  });

  it('skips focus restore when a dialog is open', () => {
    const { f, ctx } = setup();
    ctx.setDetail(
      { number: 3, projectId: 1, itemId: 30 },
      { onDescriptionApplied: () => {}, onCommentApplied: () => {} },
    );
    f.detectChanges();
    const entry = f.nativeElement.querySelector('.ai-chat-fab-entry') as HTMLButtonElement;
    entry.click();
    f.detectChanges();
    flushRender();
    vi.advanceTimersByTime(300);
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.appendChild(dialog);
    f.componentInstance.closePanel({ restoreFocus: true });
    f.detectChanges();
    flushRender();
    expect(document.activeElement).not.toBe(entry);
    dialog.remove();
  });

  it('detail sets route target without picker', () => {
    const { f, ctx } = setup();
    ctx.setDetail(
      { number: 9, projectId: 1, itemId: 90 },
      { onDescriptionApplied: () => {}, onCommentApplied: () => {} },
    );
    f.detectChanges();
    (f.nativeElement.querySelector('.ai-chat-fab-entry') as HTMLButtonElement).click();
    f.detectChanges();
    expect(f.nativeElement.querySelector('.ai-chat-fab-picker')).toBeNull();
    expect(f.componentInstance.activeTarget()?.number).toBe(9);
    expect(f.nativeElement.querySelector('app-item-ai-chat')).toBeTruthy();
  });

  it('ignores onSelectChange for non-editable option keys', () => {
    const { f, ctx } = setup();
    ctx.setBoard([
      { number: 1, projectId: 1, itemId: 10, title: 'A', canEdit: true },
      { number: 2, projectId: 1, itemId: 20, title: 'B', canEdit: false },
    ]);
    f.detectChanges();
    f.componentInstance.onSelectChange('2:1:20');
    expect(f.componentInstance.selected()).toBeNull();
  });

  it('forwards descriptionApplied and commentApplied to context handlers', () => {
    const onDescriptionApplied = vi.fn();
    const onCommentApplied = vi.fn();
    const { f, ctx } = setup();
    ctx.setDetail(
      { number: 3, projectId: 1, itemId: 30 },
      { onDescriptionApplied, onCommentApplied },
    );
    f.detectChanges();
    f.componentInstance.onDescriptionApplied({ id: 30 } as never);
    f.componentInstance.onCommentApplied();
    expect(onDescriptionApplied).toHaveBeenCalledWith({ id: 30 });
    expect(onCommentApplied).toHaveBeenCalled();
  });
});
