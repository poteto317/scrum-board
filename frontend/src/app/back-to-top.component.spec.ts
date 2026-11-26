import { TestBed } from '@angular/core/testing';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BackToTop } from './back-to-top.component';

describe('BackToTop', () => {
  const original: Record<'scrollY' | 'innerHeight', PropertyDescriptor | undefined> = {
    scrollY: undefined,
    innerHeight: undefined,
  };

  beforeAll(() => {
    original.scrollY = Object.getOwnPropertyDescriptor(window, 'scrollY');
    original.innerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const key of ['scrollY', 'innerHeight'] as const) {
      const desc = original[key];
      if (desc) Object.defineProperty(window, key, desc);
      else delete (window as unknown as Record<string, unknown>)[key];
    }
  });

  function setScroll(y: number, height = 800) {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  }

  function create(inputs: { aiChatFab?: boolean; dockOpen?: boolean } = {}) {
    TestBed.configureTestingModule({ imports: [BackToTop] });
    const f = TestBed.createComponent(BackToTop);
    if (inputs.aiChatFab != null) f.componentRef.setInput('aiChatFab', inputs.aiChatFab);
    if (inputs.dockOpen != null) f.componentRef.setInput('dockOpen', inputs.dockOpen);
    f.detectChanges();
    return f;
  }

  type Fixture = ReturnType<typeof create>;

  const button = (f: Fixture) =>
    f.nativeElement.querySelector('button.back-to-top') as HTMLButtonElement | null;

  function fire(f: Fixture, type: 'scroll' | 'resize') {
    window.dispatchEvent(new Event(type));
    f.detectChanges();
  }

  it('renders no button at the top of the page', () => {
    setScroll(0);
    const f = create();
    expect(button(f)).toBeNull();
  });

  it('shows an accessible button after scrolling past half a viewport', () => {
    setScroll(0);
    const f = create();
    setScroll(401);
    fire(f, 'scroll');
    const b = button(f);
    expect(b).not.toBeNull();
    expect(b!.getAttribute('type')).toBe('button');
    expect(b!.textContent?.trim()).toBe('トップに戻る');
    expect(b!.classList.contains('secondary')).toBe(true);
    expect(f.nativeElement.querySelector('[aria-live]')).toBeNull();

    setScroll(100);
    fire(f, 'scroll');
    expect(button(f)).toBeNull();
  });

  it('re-evaluates the threshold on resize', () => {
    setScroll(450, 800);
    const f = create();
    expect(button(f)).not.toBeNull();

    setScroll(450, 1000);
    fire(f, 'resize');
    expect(button(f)).toBeNull();
  });

  it('scrolls the window to the top smoothly when clicked', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false }) as MediaQueryList),
    );
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    setScroll(1000);
    const f = create();
    button(f)!.click();
    expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('jumps instantly when reduced motion is preferred', () => {
    const mm = vi.fn(() => ({ matches: true }) as MediaQueryList);
    vi.stubGlobal('matchMedia', mm);
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    setScroll(1000);
    const f = create();
    button(f)!.click();
    expect(mm).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  });

  it('falls back to smooth scrolling when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    setScroll(1000);
    const f = create();
    button(f)!.click();
    expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('keeps a keyboard-focused button at the top and re-reads the position on blur', () => {
    setScroll(1000);
    const f = create();
    const b = button(f)!;
    b.dispatchEvent(new FocusEvent('focus'));
    // Position changes without a scroll event; blur alone must re-read it.
    setScroll(0);
    f.detectChanges();
    expect(button(f)).toBe(b);

    b.dispatchEvent(new FocusEvent('blur'));
    f.detectChanges();
    expect(button(f)).toBeNull();
  });

  it('does not keep the button after a pointer press focuses it', () => {
    setScroll(1000);
    const f = create();
    const b = button(f)!;
    b.dispatchEvent(new Event('pointerdown'));
    b.dispatchEvent(new FocusEvent('focus'));
    setScroll(0);
    fire(f, 'scroll');
    expect(button(f)).toBeNull();
  });

  it('keeps keyboard focus after a pointer press that did not focus (Safari)', () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    setScroll(1000);
    const f = create();
    const b = button(f)!;
    b.dispatchEvent(new Event('pointerdown'));
    b.click();
    b.dispatchEvent(new FocusEvent('focus'));
    setScroll(0);
    fire(f, 'scroll');
    expect(button(f)).toBe(b);
  });

  it('removes the same window listeners it added on destroy', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const f = create();
    const added = add.mock.calls.filter((c) => c[0] === 'scroll' || c[0] === 'resize');
    expect(added.map((c) => c[0]).sort()).toEqual(['resize', 'scroll']);
    f.destroy();
    for (const [type, handler] of added) {
      expect(remove).toHaveBeenCalledWith(type, handler);
    }
  });

  it('reflects the AI chat button and dock state as host classes', () => {
    const f = create();
    const host = f.nativeElement as HTMLElement;
    expect(host.classList.contains('with-ai-chat-fab')).toBe(false);
    expect(host.classList.contains('dock-open')).toBe(false);

    f.componentRef.setInput('aiChatFab', true);
    f.componentRef.setInput('dockOpen', true);
    f.detectChanges();
    expect(host.classList.contains('with-ai-chat-fab')).toBe(true);
    expect(host.classList.contains('dock-open')).toBe(true);
  });
});
