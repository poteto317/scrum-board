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

  it('keeps only the latest message until 3s after that publish', async () => {
    vi.useFakeTimers();
    feedback.publish('リンクをコピーしました', 'success');
    expect(feedback.kind()).toBe('success');
    await vi.advanceTimersByTimeAsync(2000);
    feedback.publish('コマンドをコピーしました', 'failure');
    expect(feedback.kind()).toBe('failure');
    await vi.advanceTimersByTimeAsync(2000);
    expect(feedback.message()).toBe('コマンドをコピーしました');
    expect(feedback.kind()).toBe('failure');
    await vi.advanceTimersByTimeAsync(1000);
    expect(feedback.message()).toBe('');
    expect(feedback.kind()).toBe('');
  });

  it('does not clear or replace the message after destroy', async () => {
    vi.useFakeTimers();
    feedback.publish('リンクをコピーしました', 'success');
    onDestroy?.();
    feedback.publish('コマンドをコピーしました', 'failure');
    expect(feedback.message()).toBe('リンクをコピーしました');
    expect(feedback.kind()).toBe('success');
    await vi.advanceTimersByTimeAsync(3000);
    expect(feedback.message()).toBe('リンクをコピーしました');
    expect(feedback.kind()).toBe('success');
  });
});
