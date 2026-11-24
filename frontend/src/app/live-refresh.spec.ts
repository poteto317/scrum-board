import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EMPTY, of, Subject, throwError } from 'rxjs';
import { backoffTicks, sameJson, startLiveRefresh, zoneAwareTimers } from './live-refresh';
import { NgZone } from '@angular/core';

describe('startLiveRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function mockDoc(hidden: boolean) {
    const listeners = new Map<string, EventListener>();
    const doc = {
      visibilityState: hidden ? ('hidden' as const) : ('visible' as const),
      addEventListener: vi.fn((type: string, fn: EventListener) => {
        listeners.set(type, fn);
      }),
      removeEventListener: vi.fn((type: string) => {
        listeners.delete(type);
      }),
      dispatch(type: string) {
        listeners.get(type)?.(new Event(type));
      },
      setHidden(v: boolean) {
        doc.visibilityState = v ? 'hidden' : 'visible';
      },
    };
    return doc;
  }

  it('calls fetch on each interval when enabled and visible', () => {
    const doc = mockDoc(false);
    const fetch = vi.fn(() => of({ n: 1 }));
    const apply = vi.fn();
    const stop = startLiveRefresh({
      intervalMs: 5000,
      enabled: () => true,
      fetch,
      apply,
      document: doc as unknown as Document,
    });
    expect(fetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ n: 1 });
    vi.advanceTimersByTime(5000);
    expect(fetch).toHaveBeenCalledTimes(2);
    stop();
  });

  it('does not fetch when enabled returns false', () => {
    const doc = mockDoc(false);
    const fetch = vi.fn(() => of(1));
    const stop = startLiveRefresh({
      intervalMs: 1000,
      enabled: () => false,
      fetch,
      apply: vi.fn(),
      document: doc as unknown as Document,
    });
    vi.advanceTimersByTime(5000);
    expect(fetch).not.toHaveBeenCalled();
    stop();
  });

  it('stops interval while hidden and fetches once when becoming visible', () => {
    const doc = mockDoc(false);
    const fetch = vi.fn(() => of(1));
    const stop = startLiveRefresh({
      intervalMs: 5000,
      enabled: () => true,
      fetch,
      apply: vi.fn(),
      document: doc as unknown as Document,
    });
    const initial = fetch.mock.calls.length;
    doc.setHidden(true);
    doc.dispatch('visibilitychange');
    vi.advanceTimersByTime(20000);
    expect(fetch.mock.calls.length).toBe(initial);
    doc.setHidden(false);
    doc.dispatch('visibilitychange');
    expect(fetch.mock.calls.length).toBe(initial + 1);
    stop();
  });

  it('does not apply stale responses (generation)', () => {
    const doc = mockDoc(false);
    const slow = new Subject<number>();
    let calls = 0;
    const fetch = vi.fn(() => {
      calls += 1;
      return calls === 1 ? slow.asObservable() : of(2);
    });
    const apply = vi.fn();
    const stop = startLiveRefresh({
      intervalMs: 5000,
      maxPendingMs: 8000,
      enabled: () => true,
      fetch,
      apply,
      document: doc as unknown as Document,
    });
    vi.advanceTimersByTime(5000);
    vi.advanceTimersByTime(5000); // pending 5s < 8s: skipped
    vi.advanceTimersByTime(5000); // pending 10s > 8s: the stalled request is replaced
    slow.next(1);
    slow.complete();
    expect(apply).toHaveBeenCalledWith(2);
    expect(apply).not.toHaveBeenCalledWith(1);
    stop();
  });

  it('does not apply if enabled becomes false while in flight', () => {
    const doc = mockDoc(false);
    const slow = new Subject<number>();
    let enabled = true;
    const apply = vi.fn();
    const stop = startLiveRefresh({
      intervalMs: 5000,
      enabled: () => enabled,
      fetch: () => slow.asObservable(),
      apply,
      document: doc as unknown as Document,
    });
    vi.advanceTimersByTime(5000);
    enabled = false;
    slow.next(1);
    slow.complete();
    expect(apply).not.toHaveBeenCalled();
    stop();
  });

  it('does not apply on fetch error', () => {
    const doc = mockDoc(false);
    const apply = vi.fn();
    const stop = startLiveRefresh({
      intervalMs: 5000,
      enabled: () => true,
      fetch: () => throwError(() => new Error('net')),
      apply,
      document: doc as unknown as Document,
    });
    vi.advanceTimersByTime(5000);
    expect(apply).not.toHaveBeenCalled();
    stop();
  });

  describe('slow or failing network', () => {
    /** Advances the fake clock by `ms` and returns how many requests have been made so far. */
    const advanceAndCount = (fetch: { mock: { calls: unknown[] } }) => (ms: number) => {
      vi.advanceTimersByTime(ms);
      return fetch.mock.calls.length;
    };

    const base = (doc: ReturnType<typeof mockDoc>) => ({
      intervalMs: 5000,
      enabled: () => true,
      apply: vi.fn(),
      document: doc as unknown as Document,
    });

    it('applies a response that takes longer than the interval, without starting a second request', () => {
      const doc = mockDoc(false);
      const slow = new Subject<number>();
      const fetch = vi.fn(() => slow.asObservable());
      const apply = vi.fn();
      const stop = startLiveRefresh({ ...base(doc), fetch, apply });
      vi.advanceTimersByTime(5000);
      expect(fetch).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(20000); // four more ticks while the first request is still in flight
      expect(fetch).toHaveBeenCalledTimes(1);
      slow.next(7);
      slow.complete();
      expect(apply).toHaveBeenCalledWith(7);
      vi.advanceTimersByTime(5000);
      expect(fetch).toHaveBeenCalledTimes(2);
      stop();
    });

    it('gives up on a request that has been in flight for maxPendingMs and asks again', () => {
      const doc = mockDoc(false);
      const fetch = vi.fn(() => new Subject<number>().asObservable());
      const stop = startLiveRefresh({ ...base(doc), fetch, maxPendingMs: 12000 });
      vi.advanceTimersByTime(5000);
      vi.advanceTimersByTime(10000); // ticks at 10s (pending 5s) and 15s (pending 10s): both skipped
      expect(fetch).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(5000); // tick at 20s: pending 15s > 12s
      expect(fetch).toHaveBeenCalledTimes(2);
      stop();
    });

    it('frees the next tick when a response is discarded because refresh was disabled', () => {
      const doc = mockDoc(false);
      const slow = new Subject<number>();
      let enabled = true;
      const fetch = vi.fn(() => slow.asObservable());
      const stop = startLiveRefresh({ ...base(doc), enabled: () => enabled, fetch });
      vi.advanceTimersByTime(5000);
      enabled = false;
      slow.next(1);
      slow.complete();
      enabled = true;
      vi.advanceTimersByTime(5000);
      expect(fetch).toHaveBeenCalledTimes(2);
      stop();
    });

    it('backs off after consecutive failures: 1, 2, 4 ticks are skipped', () => {
      const doc = mockDoc(false);
      const fetch = vi.fn(() => throwError(() => new Error('net')));
      const stop = startLiveRefresh({ ...base(doc), fetch });
      const at = advanceAndCount(fetch);
      expect(at(5000)).toBe(1); // t=5s: fails, skip next 1
      expect(at(5000)).toBe(1); // t=10s: skipped
      expect(at(5000)).toBe(2); // t=15s: fails, skip next 2
      expect(at(10000)).toBe(2); // t=20s, 25s: skipped
      expect(at(5000)).toBe(3); // t=30s: fails, skip next 4
      expect(at(20000)).toBe(3); // t=35s..50s: skipped
      expect(at(5000)).toBe(4); // t=55s
      stop();
    });

    it('caps the back-off at maxBackoffTicks', () => {
      const doc = mockDoc(false);
      const fetch = vi.fn(() => throwError(() => new Error('net')));
      const stop = startLiveRefresh({ ...base(doc), fetch, maxBackoffTicks: 2 });
      vi.advanceTimersByTime(5000); // 1st failure, skip 1
      vi.advanceTimersByTime(10000); // skip, fetch (2nd failure, skip 2)
      vi.advanceTimersByTime(15000); // skip, skip, fetch (3rd failure: still skip 2)
      expect(fetch).toHaveBeenCalledTimes(3);
      vi.advanceTimersByTime(15000); // skip, skip, fetch
      expect(fetch).toHaveBeenCalledTimes(4);
      stop();
    });

    it('a request that completes without a value (304) ends the failure streak: the server answered', () => {
      const doc = mockDoc(false);
      let mode: 'fail' | 'empty' = 'fail';
      const fetch = vi.fn(() => (mode === 'fail' ? throwError(() => new Error('net')) : EMPTY));
      const stop = startLiveRefresh({ ...base(doc), fetch });
      const at = advanceAndCount(fetch);
      expect(at(5000)).toBe(1); // fails (failure 1), skip 1
      mode = 'empty';
      expect(at(5000)).toBe(1); // skipped
      expect(at(5000)).toBe(2); // answers with nothing: streak over
      mode = 'fail';
      expect(at(5000)).toBe(3); // asked again at once
      expect(at(5000)).toBe(3); // this failure is failure 1 again: skip 1, not 2
      expect(at(5000)).toBe(4);
      stop();
    });

    it('survives fetch throwing synchronously: no stuck in-flight mark, counted as a failure', () => {
      const doc = mockDoc(false);
      let calls = 0;
      const fetch = vi.fn(() => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
        return of(1);
      });
      const apply = vi.fn();
      const stop = startLiveRefresh({ ...base(doc), fetch, apply });
      expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(5000); // skip 1 (failure back-off)
      expect(fetch).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(5000); // not blocked for 30s by a stuck mark
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(apply).toHaveBeenCalledWith(1);
      stop();
    });

    it('a success ends the back-off', () => {
      const doc = mockDoc(false);
      let fail = true;
      const fetch = vi.fn(() => (fail ? throwError(() => new Error('net')) : of(1)));
      const stop = startLiveRefresh({ ...base(doc), fetch });
      vi.advanceTimersByTime(5000); // fails, skip 1
      vi.advanceTimersByTime(5000); // skipped
      fail = false;
      vi.advanceTimersByTime(5000); // fetches and succeeds
      expect(fetch).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(5000); // no back-off any more
      expect(fetch).toHaveBeenCalledTimes(3);
      stop();
    });

    it('frees the next tick when a request completes without emitting (e.g. 304 filtered out)', () => {
      const doc = mockDoc(false);
      const fetch = vi.fn(() => EMPTY);
      const stop = startLiveRefresh({ ...base(doc), fetch });
      vi.advanceTimersByTime(15000);
      expect(fetch).toHaveBeenCalledTimes(3);
      stop();
    });

    it('still gives up on a stalled request when the wall clock moves backwards', () => {
      // The stall check uses performance.now, which the fake timers advance with the fake clock
      // but setSystemTime leaves alone; a Date.now-based check would wait for the clock to catch up.
      const doc = mockDoc(false);
      const fetch = vi.fn(() => new Subject<number>().asObservable());
      const stop = startLiveRefresh({ ...base(doc), fetch, maxPendingMs: 12000 });
      vi.advanceTimersByTime(5000);
      vi.setSystemTime(Date.now() - 10 * 60 * 1000);
      vi.advanceTimersByTime(15000); // ticks at 10s, 15s (pending 10s) skipped; 20s (pending 15s): gives up
      expect(fetch).toHaveBeenCalledTimes(2);
      stop();
    });

    it('returning to the tab replaces a request that was in flight', () => {
      const doc = mockDoc(false);
      const fetch = vi.fn(() => new Subject<number>().asObservable());
      const stop = startLiveRefresh({ ...base(doc), fetch });
      vi.advanceTimersByTime(5000);
      expect(fetch).toHaveBeenCalledTimes(1);
      doc.setHidden(true);
      doc.dispatch('visibilitychange');
      doc.setHidden(false);
      doc.dispatch('visibilitychange');
      expect(fetch).toHaveBeenCalledTimes(2);
      stop();
    });

    it('counts a request given up on as a failure, so a line that never answers is asked less often', () => {
      const doc = mockDoc(false);
      const fetch = vi.fn(() => new Subject<number>().asObservable());
      const stop = startLiveRefresh({ ...base(doc), fetch, maxPendingMs: 5000 });
      const at = advanceAndCount(fetch);
      expect(at(5000)).toBe(1); // t=5s
      expect(at(5000)).toBe(2); // t=10s: gave up (failure 1), skip 1
      expect(at(5000)).toBe(2); // t=15s: skipped
      expect(at(5000)).toBe(3); // t=20s: gave up (failure 2), skip 2
      expect(at(10000)).toBe(3); // t=25s, 30s: skipped
      expect(at(5000)).toBe(4); // t=35s
      stop();
    });

    it('returning to the tab fetches at once, even during a back-off', () => {
      const doc = mockDoc(false);
      const fetch = vi.fn(() => throwError(() => new Error('net')));
      const stop = startLiveRefresh({ ...base(doc), fetch });
      vi.advanceTimersByTime(5000); // fails, skip 1
      doc.setHidden(true);
      doc.dispatch('visibilitychange');
      doc.setHidden(false);
      doc.dispatch('visibilitychange');
      expect(fetch).toHaveBeenCalledTimes(2);
      stop();
    });
  });

  it('does not apply a response that arrives after stop', () => {
    const doc = mockDoc(false);
    const slow = new Subject<number>();
    const apply = vi.fn();
    const stop = startLiveRefresh({
      intervalMs: 5000,
      enabled: () => true,
      fetch: () => slow.asObservable(),
      apply,
      document: doc as unknown as Document,
    });
    vi.advanceTimersByTime(5000);
    stop();
    slow.next(1);
    expect(apply).not.toHaveBeenCalled();
  });

  it('stop clears timers and removes visibility listener', () => {
    const doc = mockDoc(false);
    const fetch = vi.fn(() => of(1));
    const stop = startLiveRefresh({
      intervalMs: 5000,
      enabled: () => true,
      fetch,
      apply: vi.fn(),
      document: doc as unknown as Document,
    });
    vi.advanceTimersByTime(5000);
    const afterStart = fetch.mock.calls.length;
    stop();
    expect(doc.removeEventListener).toHaveBeenCalled();
    vi.advanceTimersByTime(20000);
    expect(fetch.mock.calls.length).toBe(afterStart);
  });
});

describe('backoffTicks', () => {
  it('doubles per consecutive failure and stops at the cap', () => {
    expect([0, 1, 2, 3, 4, 5].map((n) => backoffTicks(n, 12))).toEqual([0, 1, 2, 4, 8, 12]);
    expect(backoffTicks(60, 12)).toBe(12);
    expect(backoffTicks(3, 2)).toBe(2);
  });
});

describe('sameJson', () => {
  it('compares JSON equality', () => {
    expect(sameJson({ a: 1 }, { a: 1 })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe('zoneAwareTimers', () => {
  it('runs the interval callback inside NgZone.run', () => {
    vi.useFakeTimers();
    const run = vi.fn((fn: () => void) => fn());
    const runOutsideAngular = vi.fn((fn: () => unknown) => fn());
    const zone = { run, runOutsideAngular } as unknown as NgZone;
    const timers = zoneAwareTimers(zone);
    const handler = vi.fn();
    const id = timers.setInterval!(handler, 1000);
    expect(runOutsideAngular).toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalled();
    expect(handler).toHaveBeenCalled();
    timers.clearInterval!(id);
    vi.useRealTimers();
  });
});
