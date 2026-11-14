import { DestroyRef } from '@angular/core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LatestCopyFeedback } from './latest-copy-feedback';

describe('LatestCopyFeedback', () => {
  let onDestroy: (() => void) | undefined;
  let feedback: LatestCopyFeedback;

  beforeEach(() => {
    onDestroy = undefined;
    const destroyRef = {
      onDestroy: (fn: () => void) => {
        onDestroy = fn;
        return fn;
      },
    } as DestroyRef;
    feedback = new LatestCopyFeedback(destroyRef);
  });

  afterEach(() => {
    onDestroy?.();
    vi.useRealTimers();
  });

  it('keeps only the latest message until 2s after that publish', async () => {
    vi.useFakeTimers();
    feedback.publish('リンクをコピーしました');
    await vi.advanceTimersByTimeAsync(1500);
    feedback.publish('コマンドをコピーしました');
    await vi.advanceTimersByTimeAsync(1500);
    expect(feedback.message()).toBe('コマンドをコピーしました');
    await vi.advanceTimersByTimeAsync(500);
    expect(feedback.message()).toBe('');
  });

  it('does not clear or replace the message after destroy', async () => {
    vi.useFakeTimers();
    feedback.publish('リンクをコピーしました');
    onDestroy?.();
    feedback.publish('コマンドをコピーしました');
    expect(feedback.message()).toBe('リンクをコピーしました');
    await vi.advanceTimersByTimeAsync(2000);
    expect(feedback.message()).toBe('リンクをコピーしました');
  });
});
