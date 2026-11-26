import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { backToTopScrollBehavior, isBackToTopVisible } from './back-to-top';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Fixed bottom-right button that scrolls the page back to the top. One instance lives in App. */
@Component({
  selector: 'app-back-to-top',
  templateUrl: './back-to-top.component.html',
  styleUrl: './back-to-top.component.css',
  host: {
    '[class.with-ai-chat-fab]': 'aiChatFab()',
    '[class.dock-open]': 'dockOpen()',
  },
})
export class BackToTop {
  /** True on pages that show the 「AIに聞く」 button; the button stacks above it. */
  readonly aiChatFab = input(false);
  /** True while the AI chat dock is open; the button moves left of the dock. */
  readonly dockOpen = input(false);

  private readonly scrollY = signal(window.scrollY);
  private readonly viewportHeight = signal(window.innerHeight);
  private readonly focused = signal(false);
  /** Set on pointerdown so the focus that follows a mouse/touch press is not kept. */
  private pointerPressed = false;

  readonly visible = computed(() =>
    isBackToTopVisible({
      scrollY: this.scrollY(),
      viewportHeight: this.viewportHeight(),
      focused: this.focused(),
    }),
  );

  constructor() {
    const sync = () => this.readPosition();
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync, { passive: true });
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    });
  }

  scrollToTop() {
    const reduced = window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false;
    window.scrollTo({ top: 0, behavior: backToTopScrollBehavior(reduced) });
  }

  onPointerDown() {
    this.pointerPressed = true;
  }

  /**
   * The press ended (released, cancelled, or dragged away). Focus from the press, if any, has
   * already arrived on pointerdown, so a later keyboard focus is not mistaken for a pointer one.
   */
  onPointerEnd() {
    this.pointerPressed = false;
  }

  /**
   * Keep the button mounted only for keyboard focus, so focus is not dropped to body when it
   * would hide at the top. Focus from a pointer press is not kept, so the button hides at the top.
   */
  onFocus() {
    this.focused.set(!this.pointerPressed);
    this.pointerPressed = false;
  }

  onBlur() {
    this.focused.set(false);
    this.readPosition();
  }

  private readPosition() {
    this.scrollY.set(window.scrollY);
    this.viewportHeight.set(window.innerHeight);
  }
}
