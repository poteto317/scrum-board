import { DestroyRef, signal } from '@angular/core';

export type CopyFeedbackKind = 'success' | 'failure';

/** Visible banner and local state mirrors share this clear delay. */
export const COPY_FEEDBACK_CLEAR_MS = 3000;

/**
 * The single visible copy-status string.
 * Whichever copy action publishes last replaces the previous message and owns the clear timer,
 * so an older success cannot reappear when the other action's timer fires.
 */
export class LatestCopyFeedback {
  private readonly _message = signal('');
  readonly message = this._message.asReadonly();
  private readonly _kind = signal<CopyFeedbackKind | ''>('');
  readonly kind = this._kind.asReadonly();
  private clearTimer?: ReturnType<typeof setTimeout>;
  private destroyed = false;

  constructor(destroyRef: DestroyRef) {
    destroyRef.onDestroy(() => {
      this.destroyed = true;
      if (this.clearTimer) clearTimeout(this.clearTimer);
    });
  }

  publish(message: string, kind: CopyFeedbackKind) {
    if (this.destroyed) return;
    this._message.set(message);
    this._kind.set(kind);
    if (this.clearTimer) clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => {
      if (this.destroyed) return;
      this._message.set('');
      this._kind.set('');
    }, COPY_FEEDBACK_CLEAR_MS);
  }
}
