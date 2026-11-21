import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api, AIChatMessage, AICredits } from './api';
import {
  AI_EXHAUSTED_MESSAGE,
  AI_LOW_REMAINING_MESSAGE,
  AI_UNCONFIGURED_MESSAGE,
} from './ai-unavailable-copy';
import { ItemAiChat } from './item-ai-chat';

const m1: AIChatMessage = {
  id: 1,
  role: 'user',
  body: '要約して',
  createdAt: '2026-11-21T00:00:00Z',
};
const m2: AIChatMessage = {
  id: 2,
  role: 'assistant',
  body: '要約です',
  createdAt: '2026-11-21T00:00:01Z',
};

const okCredits: AICredits = {
  limitTokens: null,
  usedTokens: 0,
  remainingTokens: null,
  unlimited: true,
  approximate: true,
  period: 'cumulative',
  configured: true,
};

function setup(api: {
  listAIChat?: ReturnType<typeof vi.fn>;
  postAIChat?: ReturnType<typeof vi.fn>;
  clearAIChat?: ReturnType<typeof vi.fn>;
  updateItem?: ReturnType<typeof vi.fn>;
  createComment?: ReturnType<typeof vi.fn>;
  getAICredits?: ReturnType<typeof vi.fn>;
  getAIUsage?: ReturnType<typeof vi.fn>;
} = {}) {
  const getAIUsage = api.getAIUsage ?? vi.fn(() => of({}));
  TestBed.configureTestingModule({
    imports: [ItemAiChat],
    providers: [
      provideRouter([]),
      {
        provide: Api,
        useValue: {
          listAIChat: vi.fn(() => of([m1, m2])),
          postAIChat: vi.fn(() => of({ messages: [m1, m2] })),
          clearAIChat: vi.fn(() => of(undefined)),
          updateItem: vi.fn(() => of({ id: 10 })),
          createComment: vi.fn(() => of({ id: 1 })),
          getAICredits: vi.fn(() => of(okCredits)),
          ...api,
          getAIUsage,
        },
      },
    ],
  });
  const f = TestBed.createComponent(ItemAiChat);
  f.componentRef.setInput('number', 3);
  f.componentRef.setInput('projectId', 1);
  f.componentRef.setInput('itemId', 10);
  f.detectChanges();
  return { f, getAIUsage };
}

describe('ItemAiChat', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('loads history on init', () => {
    const listAIChat = vi.fn(() => of([m1, m2]));
    const getAICredits = vi.fn(() => of(okCredits));
    const { f, getAIUsage } = setup({ listAIChat, getAICredits });
    expect(listAIChat).toHaveBeenCalledWith(3, 1);
    expect(getAICredits).toHaveBeenCalled();
    expect(f.componentInstance.messages()).toEqual([m1, m2]);
    expect(getAIUsage).not.toHaveBeenCalled();
  });

  it('sends a message and replaces history', () => {
    const postAIChat = vi.fn(() => of({ messages: [m1, m2] }));
    const { f } = setup({ postAIChat });
    f.componentInstance.draft.set('要約して');
    f.componentInstance.send();
    expect(postAIChat).toHaveBeenCalledWith(3, '要約して', 1);
    expect(f.componentInstance.draft()).toBe('');
    expect(f.componentInstance.sending()).toBe(false);
    expect(f.componentInstance.error()).toBe('');
  });

  it('keeps draft and shows server message on 503 (L-001)', () => {
    const postAIChat = vi.fn(() =>
      throwError(() => ({ status: 503, error: { message: 'AIが設定されていません。' } })),
    );
    const { f } = setup({ postAIChat });
    f.componentInstance.draft.set('hi');
    f.componentInstance.send();
    expect(f.componentInstance.draft()).toBe('hi');
    expect(f.componentInstance.sending()).toBe(false);
    expect(f.componentInstance.error()).toBe('AIが設定されていません。');
  });

  it('keeps draft and shows server message on 429', () => {
    const postAIChat = vi.fn(() =>
      throwError(() => ({
        status: 429,
        error: { message: 'AI利用上限に達しています。', code: 'ai_credit_limit' },
      })),
    );
    const { f } = setup({ postAIChat });
    f.componentInstance.draft.set('hi');
    f.componentInstance.send();
    expect(f.componentInstance.draft()).toBe('hi');
    expect(f.componentInstance.error()).toBe('AI利用上限に達しています。');
  });

  it('blocks compose when unconfigured and does not POST', () => {
    const postAIChat = vi.fn(() => of({ messages: [m1, m2] }));
    const getAICredits = vi.fn(() =>
      of({
        ...okCredits,
        configured: false,
        remainingTokens: 0,
        limitTokens: 100,
        unlimited: false,
      }),
    );
    const { f } = setup({ postAIChat, getAICredits });
    f.detectChanges();
    expect(f.componentInstance.composeBlocked()).toBe(true);
    expect(f.componentInstance.blockReason()).toBe('unconfigured');
    expect(f.componentInstance.creditsLoading()).toBe(false);
    expect(f.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      AI_UNCONFIGURED_MESSAGE,
    );
    expect(f.nativeElement.querySelector('[role="status"]')?.textContent ?? '').not.toContain(
      AI_LOW_REMAINING_MESSAGE,
    );
    f.componentInstance.draft.set('hi');
    f.componentInstance.send();
    expect(postAIChat).not.toHaveBeenCalled();
    f.detectChanges();
    const input = f.nativeElement.querySelector('#ai-chat-input') as HTMLTextAreaElement;
    const submit = f.nativeElement.querySelector(
      '.ai-chat-compose button[type="submit"]',
    ) as HTMLButtonElement;
    expect(input.disabled).toBe(true);
    expect(submit.disabled).toBe(true);
    expect(f.nativeElement.querySelector('a')?.getAttribute('href')).toBe('/settings');
    const clearBtn = f.nativeElement.querySelector('.ai-chat-head button') as HTMLButtonElement;
    expect(clearBtn.disabled).toBe(false);
  });

  it('blocks compose when exhausted without low-remaining status', () => {
    const postAIChat = vi.fn(() => of({ messages: [m1, m2] }));
    const getAICredits = vi.fn(() =>
      of({
        ...okCredits,
        configured: true,
        unlimited: false,
        limitTokens: 1000,
        usedTokens: 1000,
        remainingTokens: 0,
      }),
    );
    const { f } = setup({ postAIChat, getAICredits });
    f.detectChanges();
    expect(f.componentInstance.blockReason()).toBe('exhausted');
    expect(f.componentInstance.creditsLoading()).toBe(false);
    expect(f.nativeElement.querySelector('[role="alert"]')?.textContent).toContain(
      AI_EXHAUSTED_MESSAGE,
    );
    expect(f.nativeElement.textContent).not.toContain(AI_LOW_REMAINING_MESSAGE);
    f.componentInstance.draft.set('hi');
    f.componentInstance.send();
    expect(postAIChat).not.toHaveBeenCalled();
    f.detectChanges();
    const input = f.nativeElement.querySelector('#ai-chat-input') as HTMLTextAreaElement;
    const submit = f.nativeElement.querySelector(
      '.ai-chat-compose button[type="submit"]',
    ) as HTMLButtonElement;
    expect(input.disabled).toBe(true);
    expect(submit.disabled).toBe(true);
    expect(f.nativeElement.querySelector('a')?.getAttribute('href')).toBe('/settings');
    const clearBtn = f.nativeElement.querySelector('.ai-chat-head button') as HTMLButtonElement;
    expect(clearBtn.disabled).toBe(false);
  });

  it('shows low remaining status and still sends', () => {
    const postAIChat = vi.fn(() => of({ messages: [m1, m2] }));
    const getAICredits = vi.fn(() =>
      of({
        ...okCredits,
        unlimited: false,
        limitTokens: 1000,
        usedTokens: 950,
        remainingTokens: 50,
      }),
    );
    const { f } = setup({ postAIChat, getAICredits });
    f.detectChanges();
    expect(f.componentInstance.lowRemaining()).toBe(true);
    expect(f.nativeElement.querySelector('[role="status"]')?.textContent).toContain(
      AI_LOW_REMAINING_MESSAGE,
    );
    f.componentInstance.draft.set('hi');
    f.componentInstance.send();
    expect(postAIChat).toHaveBeenCalled();
  });

  it('does not POST while credits are loading, then allows send', () => {
    const pending = new Subject<AICredits>();
    const postAIChat = vi.fn(() => of({ messages: [m1, m2] }));
    const getAICredits = vi.fn(() => pending);
    const { f } = setup({ postAIChat, getAICredits });
    expect(f.componentInstance.creditsLoading()).toBe(true);
    f.componentInstance.draft.set('hi');
    f.componentInstance.send();
    expect(postAIChat).not.toHaveBeenCalled();
    pending.next(okCredits);
    pending.complete();
    f.detectChanges();
    expect(f.componentInstance.creditsLoading()).toBe(false);
    f.componentInstance.send();
    expect(postAIChat).toHaveBeenCalled();
  });

  it('clears blocked state when credits request fails after success', () => {
    const postAIChat = vi.fn(() => of({ messages: [m1, m2] }));
    const getAICredits = vi
      .fn()
      .mockReturnValueOnce(
        of({
          ...okCredits,
          configured: false,
        }),
      )
      .mockReturnValueOnce(throwError(() => ({ status: 500 })));
    const { f } = setup({ postAIChat, getAICredits });
    expect(f.componentInstance.composeBlocked()).toBe(true);
    f.componentInstance.reload();
    expect(f.componentInstance.composeBlocked()).toBe(false);
    expect(f.componentInstance.credits()).toBeNull();
    f.componentInstance.draft.set('hi');
    f.componentInstance.send();
    expect(postAIChat).toHaveBeenCalled();
  });

  it('drops stale credits after number change (L-037)', () => {
    const pending = new Subject<AICredits>();
    const getAICredits = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockReturnValueOnce(
        of({
          ...okCredits,
          configured: false,
        }),
      );
    const { f } = setup({ getAICredits });
    f.componentRef.setInput('number', 4);
    f.detectChanges();
    pending.next(okCredits);
    pending.complete();
    expect(f.componentInstance.blockReason()).toBe('unconfigured');
    expect(f.componentInstance.credits()?.configured).toBe(false);
  });

  it('drops stale credits after projectId change (L-037)', () => {
    const pending = new Subject<AICredits>();
    const getAICredits = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockReturnValueOnce(
        of({
          ...okCredits,
          configured: false,
        }),
      );
    const { f } = setup({ getAICredits });
    f.componentRef.setInput('projectId', 2);
    f.detectChanges();
    pending.next(okCredits);
    pending.complete();
    expect(f.componentInstance.blockReason()).toBe('unconfigured');
  });

  it('drops stale credits after itemId change (L-037)', () => {
    const pending = new Subject<AICredits>();
    const getAICredits = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockReturnValueOnce(
        of({
          ...okCredits,
          configured: false,
        }),
      );
    const { f } = setup({ getAICredits });
    f.componentRef.setInput('itemId', 99);
    f.detectChanges();
    pending.next(okCredits);
    pending.complete();
    expect(f.componentInstance.blockReason()).toBe('unconfigured');
  });

  it('does not clear applying flag as success when description apply fails (L-001)', () => {
    const updateItem = vi.fn(() => throwError(() => ({ status: 500, error: { message: '失敗' } })));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { f } = setup({ updateItem });
    const applied: unknown[] = [];
    f.componentInstance.descriptionApplied.subscribe((item) => applied.push(item));
    f.componentInstance.applyToDescription('新説明');
    expect(updateItem).toHaveBeenCalledWith(10, { description: '新説明' });
    expect(f.componentInstance.applying()).toBe(false);
    expect(f.componentInstance.error()).toBeTruthy();
    expect(applied).toEqual([]);
  });

  it('emits descriptionApplied on successful apply', () => {
    const updated = { id: 10, description: '新説明', updatedAt: 't2' };
    const updateItem = vi.fn(() => of(updated));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { f } = setup({ updateItem });
    const applied: unknown[] = [];
    f.componentInstance.descriptionApplied.subscribe((item) => applied.push(item));
    f.componentInstance.applyToDescription('新説明');
    expect(applied).toEqual([updated]);
  });

  it('applies assistant text as comment after confirm', () => {
    const createComment = vi.fn(() => of({ id: 9 }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { f } = setup({ createComment });
    const applied: unknown[] = [];
    f.componentInstance.commentApplied.subscribe(() => applied.push(true));
    f.componentInstance.applyAsComment('要約です');
    expect(createComment).toHaveBeenCalledWith(3, { body: '要約です' }, 1);
    expect(f.componentInstance.applying()).toBe(false);
    expect(f.componentInstance.error()).toBe('');
    expect(applied).toEqual([true]);
  });

  it('ignores Enter while IME is composing', () => {
    const postAIChat = vi.fn(() => of({ messages: [m1, m2] }));
    const { f } = setup({ postAIChat });
    f.componentInstance.draft.set('途中');
    f.componentInstance.onComposeKeydown({
      key: 'Enter',
      shiftKey: false,
      isComposing: true,
      keyCode: 229,
      preventDefault: () => undefined,
    } as KeyboardEvent);
    expect(postAIChat).not.toHaveBeenCalled();
  });

  it('skips apply when confirm is cancelled (L-408)', () => {
    const updateItem = vi.fn(() => of({ id: 10 }));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { f } = setup({ updateItem });
    f.componentInstance.applyToDescription('x');
    expect(updateItem).not.toHaveBeenCalled();
  });

  it('drops stale list response after number change', () => {
    const pending = new Subject<AIChatMessage[]>();
    const listAIChat = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockReturnValueOnce(of([m2]));
    const { f } = setup({ listAIChat });
    f.componentRef.setInput('number', 4);
    f.detectChanges();
    pending.next([m1]);
    pending.complete();
    expect(f.componentInstance.messages()).toEqual([m2]);
  });

  it('blocks overlong comment apply before confirm', () => {
    const createComment = vi.fn(() => of({ id: 9 }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { f } = setup({ createComment });
    f.componentInstance.applyAsComment('あ'.repeat(4001));
    expect(confirm).not.toHaveBeenCalled();
    expect(createComment).not.toHaveBeenCalled();
    expect(f.componentInstance.error()).toContain('4000');
  });
});
