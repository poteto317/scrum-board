import { DestroyRef } from '@angular/core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { COPY_COMMAND_FAILURE, COPY_COMMAND_SUCCESS } from './command-template';
import { CopyCommandFeedback } from './copy-command-feedback';

describe('CopyCommandFeedback', () => {
  let onDestroy: (() => void) | undefined;
  let feedback: CopyCommandFeedback;

  beforeEach(() => {
    onDestroy = undefined;
    const destroyRef = {
      onDestroy: (fn: () => void) => {
        onDestroy = fn;
        return fn;
      },
    } as DestroyRef;
    feedback = new CopyCommandFeedback(destroyRef);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    onDestroy?.();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('copies the resolved command, then clears the success message after 3s', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    await feedback.copyResolved('open {{url}} then {{url}}', 27, 'http://127.0.0.1:4200');
    expect(feedback.message()).toBe(COPY_COMMAND_SUCCESS);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'open http://127.0.0.1:4200/items/27 then http://127.0.0.1:4200/items/27',
    );
    await vi.advanceTimersByTimeAsync(3000);
    expect(feedback.message()).toBe('');
  });

  it('sets the failure message when copy fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    vi.spyOn(document, 'execCommand').mockReturnValue(false);
    await feedback.copyResolved('gh pr view {{url}}', 1, 'http://example');
    expect(feedback.message()).toBe(COPY_COMMAND_FAILURE);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('gh pr view http://example/items/1');
  });

  it('sets failure message when public origin cannot be loaded', () => {
    vi.useFakeTimers();
    feedback.failOrigin();
    expect(feedback.message()).toBe(COPY_COMMAND_FAILURE);
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
    const pending = feedback.copyResolved('open {{url}}', 3, 'http://example');
    onDestroy?.();
    resolveWrite();
    await pending;
    expect(feedback.message()).toBe('');
  });

  it('clears the success timer on destroy', async () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    await feedback.copyResolved('open {{url}}', 9, 'http://127.0.0.1:4200');
    expect(feedback.message()).toBe(COPY_COMMAND_SUCCESS);
    clear.mockClear();
    onDestroy?.();
    expect(clear).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(feedback.message()).toBe(COPY_COMMAND_SUCCESS);
  });
});
