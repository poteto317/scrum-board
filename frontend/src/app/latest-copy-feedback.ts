import { DestroyRef, signal } from '@angular/core';

/**
 * The single visible copy-status string.
 * Whichever copy action publishes last replaces the previous message and owns the clear timer,
 * so an older success cannot reappear when the other action's timer fires.
 */
export class LatestCopyFeedback {
  private readonly _message = signal('');
  readonly message = this._message.asReadonly();
  private clearTimer?: ReturnType<typeof setTimeout>;
  private destroyed = false;

  constructor(destroyRef: DestroyRef) {
    destroyRef.onDestroy(() => {
      this.destroyed = true;
      if (this.clearTimer) clearTimeout(this.clearTimer);
    });
  }

  publish(message: string) {
    if (this.destroyed) return;
    this._message.set(message);
    if (this.clearTimer) clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => {
      if (this.destroyed) return;
      this._message.set('');
    }, 2000);
  }
}
