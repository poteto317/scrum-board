import { NgZone } from '@angular/core';
import { Observable, Subscription } from 'rxjs';

export type LiveRefreshOptions<T> = {
  intervalMs?: number;
  enabled: () => boolean;
  fetch: () => Observable<T>;
  apply: (data: T) => void;
  /**
   * Checked on each tick: a request still pending after this long is cancelled, counted as a
   * failure and asked for again (so up to one interval later than this). Default 30s.
   */
  maxPendingMs?: number;
  /**
   * After consecutive failures, 1, 2, 4, ... ticks are skipped, up to this many. Only ticks that
   * would have fetched count (hidden or disabled ticks do not). Default 12 (a minute at the default interval).
   */
  maxBackoffTicks?: number;
  document?: Document;
  /** Defaults to global setInterval. Pass NgZone-wrapped schedulers so Angular whenStable is not blocked. */
  setInterval?: (handler: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval?: (id: ReturnType<typeof setInterval>) => void;
};

/** Schedulers that keep the poll interval outside Angular so whenStable is not blocked. */
export function zoneAwareTimers(
  zone: NgZone,
): Pick<LiveRefreshOptions<unknown>, 'setInterval' | 'clearInterval'> {
  return {
    setInterval: (handler, ms) =>
      zone.runOutsideAngular(() => setInterval(() => zone.run(handler), ms)),
    clearInterval: (id) => clearInterval(id),
  };
}

/** Ticks to skip after the `failures`-th consecutive failure: 1, 2, 4, ... up to `max`. */
export function backoffTicks(failures: number, max: number): number {
  return failures <= 0 ? 0 : Math.min(2 ** (failures - 1), max);
}

export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Starts polling; returns a stop function. Clears timers and visibility listener (L-108/L-109/L-217).
 * At most one request is in flight: a slow response is allowed to finish and be applied, a stalled
 * one is given up on after `maxPendingMs`, and consecutive failures space the requests out.
 * Returning to the tab asks at once.
 */
export function startLiveRefresh<T>(options: LiveRefreshOptions<T>): () => void {
  const doc = options.document ?? document;
  const intervalMs = options.intervalMs ?? 5000;
  const maxPendingMs = options.maxPendingMs ?? 30_000;
  const maxBackoffTicks = options.maxBackoffTicks ?? 12;
  const schedule = options.setInterval ?? setInterval;
  const unschedule = options.clearInterval ?? clearInterval;
  // Monotonic: the wall clock can jump back (NTP, resume) and would freeze the stall check.
  const now = () => performance.now();
  let generation = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let subscription: Subscription | null = null;
  // Set while a request is pending; null once it has answered, failed or completed.
  let pendingSince: number | null = null;
  let failures = 0;
  let ticksToSkip = 0;

  const clearTimer = () => {
    if (timer !== null) {
      unschedule(timer);
      timer = null;
    }
  };

  /** Space the next requests out; called for a failed request, one given up on, and a fetch that threw. */
  const recordFailure = () => {
    failures += 1;
    ticksToSkip = backoffTicks(failures, maxBackoffTicks);
  };

  /** The server answered (with or without a value): the request is over and the failure streak ends. */
  const recordAnswer = () => {
    pendingSince = null;
    failures = 0;
    ticksToSkip = 0;
  };

  const tick = () => {
    if (doc.visibilityState === 'hidden') return;
    if (!options.enabled()) return;
    if (ticksToSkip > 0) {
      ticksToSkip -= 1;
      return;
    }
    // A response slower than the interval must be allowed to finish: cancelling it on every
    // tick would mean it is never applied on a slow line. Wait, unless it has stalled.
    const stalled = pendingSince !== null && now() - pendingSince >= maxPendingMs;
    if (pendingSince !== null && !stalled) return;
    const gen = ++generation;
    subscription?.unsubscribe();
    if (stalled) recordFailure();
    let request: Observable<T>;
    try {
      request = options.fetch();
    } catch {
      // A fetch that throws before returning an Observable must not leave the in-flight mark set.
      pendingSince = null;
      recordFailure();
      return;
    }
    pendingSince = now();
    subscription = request.subscribe({
      next: (data) => {
        if (gen !== generation) return;
        recordAnswer();
        // Re-check after the response: reordering/modal may have started mid-flight.
        if (!options.enabled()) return;
        options.apply(data);
      },
      error: () => {
        // Silent background failure; ask less often while the line keeps failing.
        if (gen !== generation) return;
        pendingSince = null;
        recordFailure();
      },
      // A response filtered out upstream (e.g. 304 Not Modified) completes without a value: the
      // server answered, so the request is over (the next tick must not wait for it) and the
      // failure streak ends. `error` never reaches here.
      complete: () => {
        if (gen !== generation) return;
        recordAnswer();
      },
    });
  };

  const armTimer = () => {
    clearTimer();
    timer = schedule(tick, intervalMs);
  };

  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') {
      clearTimer();
      return;
    }
    // Back on the tab: ask at once, whatever the back-off was and whatever was in flight
    // (a request left over from before the tab was hidden may be stale or throttled).
    ticksToSkip = 0;
    pendingSince = null;
    tick();
    armTimer();
  };

  const start = () => {
    if (doc.visibilityState === 'hidden') return;
    // No immediate tick: callers often finish their first load() synchronously
    // before startLiveRefresh returns; an immediate tick would double-fetch.
    armTimer();
  };

  doc.addEventListener('visibilitychange', onVisibility);
  start();

  return () => {
    generation += 1;
    clearTimer();
    subscription?.unsubscribe();
    subscription = null;
    pendingSince = null;
    doc.removeEventListener('visibilitychange', onVisibility);
  };
}
