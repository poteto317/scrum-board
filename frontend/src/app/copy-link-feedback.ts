import { DestroyRef } from '@angular/core';
import { cardDetailUrl, copyText } from './card-link';
import { CopyFeedbackState } from './copy-feedback-state';
import { LatestCopyFeedback } from './latest-copy-feedback';

export const COPY_LINK_SUCCESS = 'リンクをコピーしました';
export const COPY_LINK_FAILURE = 'リンクをコピーできませんでした';

/**
 * Copies a card detail URL and holds a short-lived status message.
 * Owns clipboard I/O for the copy action plus feedback timing (destroy-safe).
 */
export class CopyLinkFeedback {
  private readonly state: CopyFeedbackState;
  readonly message;

  constructor(
    destroyRef: DestroyRef,
    latest?: LatestCopyFeedback,
  ) {
    this.state = new CopyFeedbackState(destroyRef, latest);
    this.message = this.state.message;
  }

  async copyCardNumber(number: number, origin = window.location.origin): Promise<void> {
    const ok = await copyText(cardDetailUrl(origin, number));
    if (this.state.isDestroyed) return;
    this.state.show(ok ? COPY_LINK_SUCCESS : COPY_LINK_FAILURE);
  }

  /** When the public origin cannot be loaded (distinct from empty config). */
  failOrigin(): void {
    this.state.show(COPY_LINK_FAILURE);
  }
}