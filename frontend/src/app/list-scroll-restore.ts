import { afterNextRender, Injector } from '@angular/core';

export function clampNonNegative(n: number): number {
  return n < 0 ? 0 : n;
}

export function scrollPositionsDiffer(a: number, b: number, epsilon = 1): boolean {
  return Math.abs(a - b) > epsilon;
}

export type ScheduleScrollRestoreOptions = {
  shouldApply: () => boolean;
  injector: Injector;
  /** Positions at schedule time (parallel to `targets`). */
  captureBaseline: () => readonly number[];
  /** Positions at restore time; `null` = that target is absent (skip differ for it). */
  readCurrent: () => ReadonlyArray<number | null>;
  /** Apply clamped saved values (parallel to `targets`). */
  apply: (clamped: number[]) => void;
  /** Saved scroll values to restore. */
  targets: readonly number[];
  /** When baseline moved causes skip (not when `shouldApply` is false). */
  onSkipped?: () => void;
};

/** True when any present current position has moved past baseline (skip restore). */
export function scrollRestoreBaselineMoved(
  baseline: readonly number[],
  current: ReadonlyArray<number | null>,
): boolean {
  for (let i = 0; i < baseline.length; i++) {
    const cur = current[i];
    if (cur != null && scrollPositionsDiffer(cur, baseline[i]!)) return true;
  }
  return false;
}

/**
 * After the next render, restore scroll if no target has moved from its schedule-time baseline.
 */
export function scheduleScrollRestore(options: ScheduleScrollRestoreOptions): void {
  const baseline = options.captureBaseline();
  afterNextRender(
    () => {
      if (!options.shouldApply()) return;
      if (scrollRestoreBaselineMoved(baseline, options.readCurrent())) {
        options.onSkipped?.();
        return;
      }
      options.apply(options.targets.map(clampNonNegative));
    },
    { injector: options.injector },
  );
}
