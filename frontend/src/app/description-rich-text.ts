import { Component, input, output } from '@angular/core';
import { parseDescriptionLinks } from './description-link';

@Component({
  selector: 'app-description-rich-text',
  template: `
    <div class="rich-text">
      @for (seg of segments(); track $index) {
        @if (seg.kind === 'text') {
          <span class="rich-text-plain">{{ seg.text }}</span>
        } @else if (seg.kind === 'link') {
          <a [href]="seg.url" target="_blank" rel="noopener noreferrer">{{ seg.label }}</a>
        } @else if (seg.kind === 'image') {
          <span class="rich-image">
            <img [src]="seg.src" [alt]="seg.alt" />
            @if (canDelete()) {
              <button
                type="button"
                class="secondary rich-image-delete"
                [attr.aria-label]="'画像を削除: ' + seg.alt"
                (click)="onDelete(seg.attachmentId, $event)"
              >
                削除
              </button>
            }
          </span>
        }
      }
    </div>
  `,
  styles: `
    .rich-text {
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.5;
    }
    .rich-image {
      display: inline-block;
      vertical-align: top;
      margin: 0.35rem 0;
      max-width: 100%;
    }
    .rich-image img {
      display: block;
      max-width: min(100%, 28rem);
      height: auto;
      border-radius: 0.25rem;
    }
    .rich-image-delete {
      margin-top: 0.25rem;
      font-size: 0.85rem;
    }
  `,
})
export class DescriptionRichText {
  readonly text = input.required<string>();
  readonly itemNumber = input.required<number>();
  readonly canDelete = input(false);
  readonly deleteImage = output<number>();

  segments() {
    return parseDescriptionLinks(this.text(), this.itemNumber());
  }

  onDelete(attachmentId: number, event: MouseEvent): void {
    if (event.detail > 1) return;
    this.deleteImage.emit(attachmentId);
  }
}
