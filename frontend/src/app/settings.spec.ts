import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api, AICredits } from './api';
import { AuthSession } from './auth-session';
import { AI_EXHAUSTED_MESSAGE, AI_LOW_REMAINING_MESSAGE } from './ai-unavailable-copy';
import {
  AI_CREDITS_APPROXIMATE_NOTE,
  AI_CREDITS_EXHAUSTED_ADMIN,
  AI_CREDITS_EXHAUSTED_MEMBER,
  AI_CREDITS_LIMIT_INVALID,
} from './ai-credits-settings-copy';
import { SettingsPage } from './settings';

const okUsage = { requestCount: 2, inputTokens: 10, outputTokens: 20, configured: true };

function credits(partial: Partial<AICredits> = {}): AICredits {
  return {
    limitTokens: 1000,
    usedTokens: 100,
    remainingTokens: 900,
    unlimited: false,
    approximate: true,
    period: 'cumulative',
    configured: true,
    ...partial,
  };
}

function setup(opts: {
  isAdmin?: boolean;
  getAIUsage?: ReturnType<typeof vi.fn>;
  getAICredits?: ReturnType<typeof vi.fn>;
  putAICredits?: ReturnType<typeof vi.fn>;
} = {}) {
  const getAIUsage = opts.getAIUsage ?? vi.fn(() => of(okUsage));
  const getAICredits = opts.getAICredits ?? vi.fn(() => of(credits()));
  const putAICredits = opts.putAICredits ?? vi.fn(() => of(credits({ limitTokens: 5000, remainingTokens: 4900 })));
  TestBed.configureTestingModule({
    imports: [SettingsPage],
    providers: [
      provideRouter([]),
      { provide: Api, useValue: { getAIUsage, getAICredits, putAICredits } },
      {
        provide: AuthSession,
        useValue: {
          isAdmin: () => opts.isAdmin ?? false,
          user: () => ({ role: opts.isAdmin ? 'admin' : 'member' }),
        },
      },
    ],
  });
  const f = TestBed.createComponent(SettingsPage);
  f.detectChanges();
  return { f, getAIUsage, getAICredits, putAICredits };
}

describe('SettingsPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('keeps chat exhausted copy aligned with settings capability', () => {
    expect(AI_EXHAUSTED_MESSAGE).toBe(
      'AI の利用上限に達しています。設定で上限を確認・変更できます。',
    );
  });

  it('shows usage when configured', () => {
    const { f, getAIUsage } = setup();
    expect(getAIUsage).toHaveBeenCalled();
    expect(f.componentInstance.usage()?.requestCount).toBe(2);
    expect(f.nativeElement.textContent).toContain('設定済み');
    expect(f.nativeElement.textContent).toContain('2');
  });

  it('loads usage and credits in parallel', () => {
    const { getAIUsage, getAICredits } = setup();
    expect(getAIUsage).toHaveBeenCalled();
    expect(getAICredits).toHaveBeenCalled();
  });

  it('shows credit remaining used limit period and approximate note', () => {
    const { f } = setup({
      getAICredits: vi.fn(() =>
        of(credits({ remainingTokens: 123, usedTokens: 77, limitTokens: 200 })),
      ),
    });
    const text = f.nativeElement.textContent as string;
    expect(text).toContain('123');
    expect(text).toContain('77');
    expect(text).toContain('200');
    expect(text).toContain('累計');
    expect(text).toContain(AI_CREDITS_APPROXIMATE_NOTE);
  });

  it('shows 上限なし for unlimited remaining and limit', () => {
    const { f } = setup({
      getAICredits: vi.fn(() =>
        of(
          credits({
            unlimited: true,
            limitTokens: null,
            remainingTokens: null,
          }),
        ),
      ),
    });
    const text = f.nativeElement.textContent as string;
    expect(text.match(/上限なし/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('shows credits loading status while pending', () => {
    const pending = new Subject<AICredits>();
    const { f } = setup({ getAICredits: vi.fn(() => pending) });
    expect(f.nativeElement.textContent).toContain('読み込み中…');
  });

  it('shows credits error alert and reloads on retry', () => {
    const getAICredits = vi
      .fn()
      .mockReturnValueOnce(throwError(() => ({ status: 500, error: { message: 'クレジット失敗' } })))
      .mockReturnValueOnce(of(credits()));
    const { f } = setup({ getAICredits });
    expect(f.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('クレジット失敗');
    const btn = Array.from(f.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
      (b) => b.textContent?.includes('再読み込み'),
    );
    expect(btn).toBeTruthy();
    btn!.click();
    f.detectChanges();
    expect(getAICredits).toHaveBeenCalledTimes(2);
  });

  it('shows low remaining status with message', () => {
    const { f } = setup({
      getAICredits: vi.fn(() => of(credits({ limitTokens: 1000, remainingTokens: 99 }))),
    });
    const status = f.nativeElement.querySelector('[role="status"]');
    expect(status?.textContent).toContain(AI_LOW_REMAINING_MESSAGE);
  });

  it('shows member exhausted copy without edit UI', () => {
    const { f } = setup({
      isAdmin: false,
      getAICredits: vi.fn(() => of(credits({ remainingTokens: 0 }))),
    });
    expect(f.nativeElement.textContent).toContain(AI_CREDITS_EXHAUSTED_MEMBER);
    expect(f.nativeElement.textContent).not.toContain('上限トークン');
    expect(f.nativeElement.querySelector('.credits-edit')).toBeNull();
  });

  it('treats remainingTokens null as exhausted (fail-closed)', () => {
    const { f } = setup({
      isAdmin: false,
      getAICredits: vi.fn(() =>
        of(credits({ unlimited: false, remainingTokens: null, limitTokens: 1000 })),
      ),
    });
    expect(f.nativeElement.textContent).toContain(AI_CREDITS_EXHAUSTED_MEMBER);
  });

  it('shows admin exhausted copy', () => {
    const { f } = setup({
      isAdmin: true,
      getAICredits: vi.fn(() => of(credits({ remainingTokens: 0 }))),
    });
    expect(f.nativeElement.textContent).toContain(AI_CREDITS_EXHAUSTED_ADMIN);
  });

  it('shows unset guidance when key missing and hides exhausted', () => {
    const { f } = setup({
      getAIUsage: vi.fn(() =>
        of({ requestCount: 0, inputTokens: 0, outputTokens: 0, configured: false }),
      ),
      getAICredits: vi.fn(() =>
        of(credits({ configured: false, remainingTokens: 0 })),
      ),
    });
    expect(f.nativeElement.textContent).toContain('ANTHROPIC_API_KEY');
    expect(f.nativeElement.textContent).not.toContain(AI_CREDITS_EXHAUSTED_MEMBER);
    expect(f.nativeElement.textContent).not.toContain(AI_CREDITS_EXHAUSTED_ADMIN);
  });

  it('keeps usage visible when credits fail', () => {
    const { f } = setup({
      getAICredits: vi.fn(() => throwError(() => ({ status: 500, error: { message: 'c-fail' } }))),
    });
    expect(f.componentInstance.usage()?.requestCount).toBe(2);
    expect(f.nativeElement.textContent).toContain('c-fail');
  });

  it('keeps credits visible when usage fails', () => {
    const { f } = setup({
      getAIUsage: vi.fn(() => throwError(() => ({ status: 401, error: { message: '要ログイン' } }))),
      getAICredits: vi.fn(() => of(credits({ remainingTokens: 42 }))),
    });
    expect(f.componentInstance.error()).toBeTruthy();
    expect(f.nativeElement.textContent).toContain('42');
  });

  it('shows error when usage load fails', () => {
    const { f } = setup({
      getAIUsage: vi.fn(() => throwError(() => ({ status: 401, error: { message: '要ログイン' } }))),
    });
    expect(f.componentInstance.error()).toBeTruthy();
  });

  it('shows edit UI for admin and disables limit when unlimited', () => {
    const { f } = setup({
      isAdmin: true,
      getAICredits: vi.fn(() =>
        of(credits({ unlimited: true, limitTokens: null, remainingTokens: null })),
      ),
    });
    expect(f.nativeElement.querySelector('.credits-edit')).toBeTruthy();
    const input = f.nativeElement.querySelector('input[aria-label="上限トークン"]') as HTMLInputElement;
    expect(input.hasAttribute('disabled')).toBe(true);
  });

  it('saves unlimited with limitTokens null', () => {
    const putAICredits = vi.fn(() =>
      of(credits({ unlimited: true, limitTokens: null, remainingTokens: null })),
    );
    const { f } = setup({
      isAdmin: true,
      getAICredits: vi.fn(() => of(credits({ limitTokens: 100 }))),
      putAICredits,
    });
    f.componentInstance.onUnlimitedChange(true);
    f.componentInstance.saveCredits();
    expect(putAICredits).toHaveBeenCalledWith({ limitTokens: null });
  });

  it('saves numeric limit and updates credits from PUT response', () => {
    const putRes = credits({ limitTokens: 5000, usedTokens: 100, remainingTokens: 4900 });
    const putAICredits = vi.fn(() => of(putRes));
    const { f } = setup({
      isAdmin: true,
      getAICredits: vi.fn(() => of(credits({ limitTokens: 1000, remainingTokens: 900 }))),
      putAICredits,
    });
    f.componentInstance.onUnlimitedChange(false);
    f.componentInstance.onLimitInput('5000');
    f.componentInstance.saveCredits();
    f.detectChanges();
    expect(putAICredits).toHaveBeenCalledWith({ limitTokens: 5000 });
    expect(f.componentInstance.credits()?.limitTokens).toBe(5000);
    expect(f.nativeElement.textContent).toContain('4900');
    expect(f.nativeElement.textContent).toContain('5000');
  });

  it('shows saving label and blocks double submit while PUT is in flight', () => {
    const pending = new Subject<AICredits>();
    const putAICredits = vi.fn(() => pending);
    const { f } = setup({
      isAdmin: true,
      getAICredits: vi.fn(() => of(credits({ limitTokens: 1000 }))),
      putAICredits,
    });
    f.componentInstance.onLimitInput('2000');
    f.componentInstance.saveCredits();
    f.detectChanges();
    const btn = f.nativeElement.querySelector('.credits-edit button.primary') as HTMLButtonElement;
    expect(btn.textContent).toContain('保存中…');
    expect(btn.hasAttribute('disabled')).toBe(true);
    f.componentInstance.saveCredits();
    expect(putAICredits).toHaveBeenCalledTimes(1);
    pending.next(credits({ limitTokens: 2000, remainingTokens: 1900 }));
    pending.complete();
    f.detectChanges();
    expect(f.componentInstance.saving()).toBe(false);
  });

  it('ignores stale credits responses after reload', () => {
    const first = new Subject<AICredits>();
    const second = new Subject<AICredits>();
    const getAICredits = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const { f } = setup({ getAICredits });
    f.componentInstance.reloadCredits();
    second.next(credits({ remainingTokens: 11 }));
    second.complete();
    f.detectChanges();
    expect(f.componentInstance.credits()?.remainingTokens).toBe(11);
    first.next(credits({ remainingTokens: 99 }));
    first.complete();
    f.detectChanges();
    expect(f.componentInstance.credits()?.remainingTokens).toBe(11);
  });

  it('keeps draft and credits on save failure', () => {
    const putAICredits = vi.fn(() =>
      throwError(() => ({ status: 400, error: { message: 'サーバ拒否' } })),
    );
    const { f } = setup({
      isAdmin: true,
      getAICredits: vi.fn(() => of(credits({ limitTokens: 1000 }))),
      putAICredits,
    });
    f.componentInstance.onLimitInput('2000');
    f.componentInstance.saveCredits();
    f.detectChanges();
    expect(f.componentInstance.draftLimit()).toBe('2000');
    expect(f.componentInstance.credits()?.limitTokens).toBe(1000);
    expect(f.componentInstance.saveError()).toContain('サーバ拒否');
    expect(f.componentInstance.saving()).toBe(false);
  });

  it('rejects empty negative and non-integer without PUT', () => {
    const putAICredits = vi.fn(() => of(credits()));
    const { f } = setup({ isAdmin: true, putAICredits });
    f.componentInstance.onUnlimitedChange(false);

    f.componentInstance.onLimitInput('');
    f.componentInstance.saveCredits();
    expect(f.componentInstance.clientError()).toBe(AI_CREDITS_LIMIT_INVALID);

    f.componentInstance.onLimitInput('-1');
    f.componentInstance.saveCredits();
    expect(f.componentInstance.clientError()).toBe(AI_CREDITS_LIMIT_INVALID);

    f.componentInstance.onLimitInput('1.5');
    f.componentInstance.saveCredits();
    expect(f.componentInstance.clientError()).toBe(AI_CREDITS_LIMIT_INVALID);

    expect(putAICredits).not.toHaveBeenCalled();
  });

  it('hides edit UI for member', () => {
    const { f, putAICredits } = setup({ isAdmin: false });
    expect(f.nativeElement.querySelector('.credits-edit')).toBeNull();
    f.componentInstance.saveCredits();
    expect(putAICredits).not.toHaveBeenCalled();
  });
});
