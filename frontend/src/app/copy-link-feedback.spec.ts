import { DestroyRef } from '@angular/core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  COPY_LINK_FAILURE,
  COPY_LINK_SUCCESS,
  CopyLinkFeedback,
} from './copy-link-feedback';

describe('CopyLinkFeedback', () => {
  let onDestroy: (() => void) | undefined;
  let feedback: CopyLinkFeedback;

  beforeEach(() => {
    onDestroy = undefined;
    const destroyRef = {
      onDestroy: (fn: () => void) => {
        onDestroy = fn;
        return fn;
      },
    } as DestroyRef;
    feedback = new CopyLinkFeedback(destroyRef);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sets success message then clears after 2s', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    await feedback.copyCardNumber(27, 'http://127.0.0.1:4200');
    expect(feedback.message()).toBe(COPY_LINK_SUCCESS);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'http://127.0.0.1:4200/cards/27',
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(feedback.message()).toBe('');
  });

  it('sets failure message when copy fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    vi.spyOn(document, 'execCommand').mockReturnValue(false);
    await feedback.copyCardNumber(1, 'http://example');
    expect(feedback.message()).toBe(COPY_LINK_FAILURE);
  });

  it('does not update after destroy while copy is in flight', async () => {
    let resolveWrite!: () => void;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveWrite = resolve;
            }),
        ),
      },
    });
    const pending = feedback.copyCardNumber(3, 'http://example');
    onDestroy?.();
    resolveWrite();
    await pending;
    expect(feedback.message()).toBe('');
  });
});
