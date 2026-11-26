/** Inputs for deciding whether the back-to-top button is shown. */
export type BackToTopVisibilityInput = {
  /** Current vertical page scroll offset (window.scrollY). */
  scrollY: number;
  /** Viewport height (window.innerHeight). */
  viewportHeight: number;
  /**
   * True while the button has keyboard focus (not focus from a pointer press); keeps it mounted
   * so focus is not dropped to body.
   */
  focused: boolean;
};

/** Shown once the page is scrolled past half a viewport, or while the button has focus. */
export function isBackToTopVisible({
  scrollY,
  viewportHeight,
  focused,
}: BackToTopVisibilityInput): boolean {
  if (focused) return true;
  return viewportHeight > 0 && scrollY > viewportHeight / 2;
}

/** Smooth scroll unless the user prefers reduced motion (then jump instantly). */
export function backToTopScrollBehavior(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? 'auto' : 'smooth';
}
