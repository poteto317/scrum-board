import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { of, Subject, throwError } from 'rxjs';
import { sameJson, startLiveRefresh, zoneAwareTimers } from './live-refresh';
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
      enabled: () => true,
      fetch,
      apply,
      document: doc as unknown as Document,
    });
    vi.advanceTimersByTime(5000);
    vi.advanceTimersByTime(5000);
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
