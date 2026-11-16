import { TestBed } from '@angular/core/testing';
import { describe, it, expect, afterEach } from 'vitest';
import { CopyFeedbackBanner } from './copy-feedback-banner';

describe('CopyFeedbackBanner', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  const create = (message: string, kind: 'success' | 'failure' | '' = '') => {
    TestBed.configureTestingModule({
      imports: [CopyFeedbackBanner],
    });
    const f = TestBed.createComponent(CopyFeedbackBanner);
    f.componentRef.setInput('message', message);
    f.componentRef.setInput('kind', kind);
    f.detectChanges();
    return f;
  };

  it('does not render when message is empty', () => {
    const f = create('');
    expect(f.nativeElement.querySelector('.copy-feedback-banner')).toBeNull();
  });

  it('renders success class and icon', () => {
    const f = create('リンクをコピーしました', 'success');
    const banner = f.nativeElement.querySelector('.copy-feedback-banner') as HTMLElement;
    expect(banner).not.toBeNull();
    expect(banner.classList.contains('copy-feedback-banner--ok')).toBe(true);
    expect(banner.classList.contains('copy-feedback-banner--error')).toBe(false);
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.getAttribute('aria-live')).toBe('polite');
    expect(banner.querySelector('.copy-feedback-banner__icon')).not.toBeNull();
    expect(banner.textContent).toContain('リンクをコピーしました');
  });

  it('renders failure class and icon', () => {
    const f = create('リンクをコピーできませんでした', 'failure');
    const banner = f.nativeElement.querySelector('.copy-feedback-banner') as HTMLElement;
    expect(banner).not.toBeNull();
    expect(banner.classList.contains('copy-feedback-banner--error')).toBe(true);
    expect(banner.classList.contains('copy-feedback-banner--ok')).toBe(false);
    expect(banner.querySelector('.copy-feedback-banner__icon')).not.toBeNull();
    expect(banner.textContent).toContain('リンクをコピーできませんでした');
  });
});
