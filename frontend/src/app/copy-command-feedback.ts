import { DestroyRef } from '@angular/core';
import { itemDetailUrl, copyText } from './item-link';
import { CopyFeedbackState } from './copy-feedback-state';
import { COPY_COMMAND_FAILURE, COPY_COMMAND_SUCCESS, resolveCommand } from './command-template';
import { LatestCopyFeedback } from './latest-copy-feedback';

/**
 * Copies a resolved command and holds a short-lived status message.
 * Owns clipboard I/O for the copy action plus feedback timing (destroy-safe).
 */
export class CopyCommandFeedback {
  private readonly state: CopyFeedbackState;
  readonly message;

  constructor(
    destroyRef: DestroyRef,
    latest?: LatestCopyFeedback,
  ) {
    this.state = new CopyFeedbackState(destroyRef, latest);
    this.message = this.state.message;
  }

  async copyResolved(
    template: string,
    number: number,
    origin = window.location.origin,
  ): Promise<void> {
    const ok = await copyText(resolveCommand(template, itemDetailUrl(origin, number)));
    if (this.state.isDestroyed) return;
    this.announce(ok);
  }

  /** Feedback only (clipboard already written, e.g. ClipboardItem path). */
  announce(ok: boolean): void {
    if (this.state.isDestroyed) return;
    this.state.show(ok ? COPY_COMMAND_SUCCESS : COPY_COMMAND_FAILURE, ok ? 'success' : 'failure');
  }

  /** When the public origin cannot be loaded (distinct from empty config). */
  failOrigin(): void {
    this.state.show(COPY_COMMAND_FAILURE, 'failure');
  }
}