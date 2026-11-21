import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { SettingsPage } from './settings';

describe('SettingsPage', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('shows usage when configured', () => {
    const getAIUsage = vi.fn(() =>
      of({ requestCount: 2, inputTokens: 10, outputTokens: 20, configured: true }),
    );
    TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [provideRouter([]), { provide: Api, useValue: { getAIUsage } }],
    });
    const f = TestBed.createComponent(SettingsPage);
    f.detectChanges();
    expect(getAIUsage).toHaveBeenCalled();
    expect(f.componentInstance.usage()?.requestCount).toBe(2);
    expect(f.nativeElement.textContent).toContain('設定済み');
    expect(f.nativeElement.textContent).toContain('2');
  });

  it('shows unset guidance when key missing', () => {
    const getAIUsage = vi.fn(() =>
      of({ requestCount: 0, inputTokens: 0, outputTokens: 0, configured: false }),
    );
    TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [provideRouter([]), { provide: Api, useValue: { getAIUsage } }],
    });
    const f = TestBed.createComponent(SettingsPage);
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('ANTHROPIC_API_KEY');
    expect(f.nativeElement.textContent).toContain('未設定');
  });

  it('shows error when usage load fails', () => {
    const getAIUsage = vi.fn(() => throwError(() => ({ status: 401, error: { message: '要ログイン' } })));
    TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [provideRouter([]), { provide: Api, useValue: { getAIUsage } }],
    });
    const f = TestBed.createComponent(SettingsPage);
    f.detectChanges();
    expect(f.componentInstance.error()).toBeTruthy();
  });
});
