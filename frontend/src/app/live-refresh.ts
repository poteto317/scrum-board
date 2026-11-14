import { NgZone } from '@angular/core';
import { Observable, Subscription } from 'rxjs';

export type LiveRefreshOptions<T> = {
  intervalMs?: number;
  enabled: () => boolean;
  fetch: () => Observable<T>;
  apply: (data: T) => void;
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

export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Starts polling; returns a stop function. Clears timers and visibility listener (L-108/L-109/L-217). */
export function startLiveRefresh<T>(options: LiveRefreshOptions<T>): () => void {
  const doc = options.document ?? document;
  const intervalMs = options.intervalMs ?? 5000;
  const schedule = options.setInterval ?? setInterval;
  const unschedule = options.clearInterval ?? clearInterval;
  let generation = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Subscription | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      unschedule(timer);
      timer = null;
    }
  };

  const tick = () => {
    if (doc.visibilityState === 'hidden') return;
    if (!options.enabled()) return;
    const gen = ++generation;
    inFlight?.unsubscribe();
    inFlight = options.fetch().subscribe({
      next: (data) => {
        if (gen !== generation) return;
        // Re-check after the response: reordering/modal may have started mid-flight.
        if (!options.enabled()) return;
        options.apply(data);
      },
      error: () => {
        /* silent background failure */
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
    inFlight?.unsubscribe();
    inFlight = null;
    doc.removeEventListener('visibilitychange', onVisibility);
  };
}
