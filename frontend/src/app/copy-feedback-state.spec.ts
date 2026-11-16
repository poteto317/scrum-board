import { DestroyRef } from '@angular/core';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { CopyFeedbackState } from './copy-feedback-state';
import { LatestCopyFeedback } from './latest-copy-feedback';

function mockDestroyRef(): { ref: DestroyRef; onDestroy: (() => void) | undefined } {
  let onDestroy: (() => void) | undefined;
  const ref = {
    onDestroy: (fn: () => void) => {
      onDestroy = fn;
      return fn;
    },
  } as DestroyRef;
  return { ref, get onDestroy() { return onDestroy; } };
}

describe('CopyFeedbackState', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears the message after a delay', async () => {
    vi.useFakeTimers();
    const { ref } = mockDestroyRef();
    const state = new CopyFeedbackState(ref);
    state.show('test', 'success');
    expect(state.message()).toBe('test');
    vi.advanceTimersByTime(3000);
    expect(state.message()).toBe('');
  });

  it('publishes to LatestCopyFeedback when provided', () => {
    const { ref } = mockDestroyRef();
    const latest = new LatestCopyFeedback(ref);
    const state = new CopyFeedbackState(ref, latest);
    state.show('shared', 'failure');
    expect(latest.message()).toBe('shared');
    expect(latest.kind()).toBe('failure');
  });
});
