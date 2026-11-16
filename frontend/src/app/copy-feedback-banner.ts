import { Component, Input } from '@angular/core';
import { CopyFeedbackKind } from './latest-copy-feedback';

@Component({
  selector: 'app-copy-feedback-banner',
  templateUrl: './copy-feedback-banner.html',
  styleUrl: './copy-feedback-banner.css',
})
export class CopyFeedbackBanner {
  @Input() message = '';
  @Input() kind: CopyFeedbackKind | '' = '';
}
