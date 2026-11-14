import { DestroyRef, signal } from '@angular/core';
import { cardDetailUrl, copyText } from './card-link';
import { LatestCopyFeedback } from './latest-copy-feedback';

export const COPY_LINK_SUCCESS = 'リンクをコピーしました';
export const COPY_LINK_FAILURE = 'リンクをコピーできませんでした';

/**
 * Copies a card detail URL and holds a short-lived status message.
 * Owns clipboard I/O for the copy action plus feedback timing (destroy-safe).
 */
export class CopyLinkFeedback {
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

  async copyCardNumber(number: number, origin = window.location.origin): Promise<void> {
    const ok = await copyText(cardDetailUrl(origin, number));
    if (this.destroyed) return;
    const message = ok ? COPY_LINK_SUCCESS : COPY_LINK_FAILURE;
    this._message.set(message);
    this.latest?.publish(message);
    if (this.clearTimer) clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => {
      if (this.destroyed) return;
      this._message.set('');
    }, 2000);
  }
}
