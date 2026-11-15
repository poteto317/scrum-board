import { DestroyRef, signal } from '@angular/core';
import { LatestCopyFeedback } from './latest-copy-feedback';

/** Timed copy-status message with destroy-safe clearing; shared by link and command copy actions. */
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

  show(message: string): void {
    if (this.destroyed) return;
    this._message.set(message);
    this.latest?.publish(message);
    if (this.clearTimer) clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => {
      if (this.destroyed) return;
      this._message.set('');
    }, 2000);
  }
}