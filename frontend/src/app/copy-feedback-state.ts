import { DestroyRef, signal } from '@angular/core';
import {
  COPY_FEEDBACK_CLEAR_MS,
  CopyFeedbackKind,
  LatestCopyFeedback,
} from './latest-copy-feedback';

/**
 * Per-action message mirror with destroy-safe clearing.
 * When `latest` is set, also publishes there (banner owner); local timer only clears this mirror.
 */
export class CopyFeedbackState {
  private readonly _message = signal('');
  readonly message = this._message.asReadonly();
  private clearTimer?: ReturnType<typeof setTimeout>;
  private destroyed = false;

  constructor(
    destroyRef: DestroyRef,
    private readonly latest?: LatestCopyFeedback,
  ) {
    destroyRef.onDestroy(() => {
      this.destroyed = true;
      if (this.clearTimer) clearTimeout(this.clearTimer);
    });
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  show(message: string, kind: CopyFeedbackKind): void {
    if (this.destroyed) return;
    this._message.set(message);
    this.latest?.publish(message, kind);
    if (this.clearTimer) clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => {
      if (this.destroyed) return;
      this._message.set('');
    }, COPY_FEEDBACK_CLEAR_MS);
  }
}
