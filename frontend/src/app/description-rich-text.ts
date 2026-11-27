import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  SCRUM_ATTACHMENT_MIME,
  encodeAttachmentDragPayload,
} from './attachment-dnd';
import {
  ImageDisplaySize,
  hostnameFallback,
  normalizeImageDisplaySize,
} from './description-link';
import { buildDescriptionView } from './description-view';

@Component({
  selector: 'app-description-rich-text',
  imports: [NgTemplateOutlet],
  template: `
    <ng-template #inline let-segments>
      @for (seg of segments; track $index) {
        @if (seg.kind === 'text') {
          <span class="rich-text-plain">{{ seg.text }}</span>
        } @else if (seg.kind === 'link') {
          <a [href]="seg.url" target="_blank" rel="noopener noreferrer">{{ seg.label }}</a>
        } @else if (seg.kind === 'bookmark') {
          <a
            class="rich-bookmark"
            [href]="seg.url"
            target="_blank"
            rel="noopener noreferrer"
          >
            <span class="rich-bookmark-title">{{ bookmarkTitle(seg.url) }}</span>
            <span class="rich-bookmark-url">{{ bookmarkURLLabel(seg.url) }}</span>
          </a>
        } @else if (seg.kind === 'image') {
          <span
            class="rich-image"
            [class.rich-image--sm]="seg.displaySize === 'sm'"
            [class.rich-image--md]="seg.displaySize === 'md'"
            [class.rich-image--lg]="seg.displaySize === 'lg'"
          >
            <img
              [src]="seg.src"
              [alt]="seg.alt"
              loading="lazy"
              decoding="async"
              [attr.draggable]="draggableImages() ? 'true' : 'false'"
              (dragstart)="onDragStart(seg.attachmentId, seg.alt, $event)"
              (click)="openLightbox(seg.src, seg.alt, $event)"
            />
            @if (canChangeImageSize() || canDelete()) {
              <span class="rich-image-actions">
                @if (canChangeImageSize()) {
                  <span
                    class="rich-image-size"
                    role="group"
                    aria-label="画像の表示サイズ"
                    (click)="$event.stopPropagation()"
                  >
                    @for (size of sizeOptions; track size) {
                      <button
                        type="button"
                        class="secondary rich-image-size-btn"
                        [class.is-active]="seg.displaySize === size"
                        [attr.aria-pressed]="seg.displaySize === size"
                        [attr.aria-label]="sizeLabel(size)"
                        (click)="onSize(seg.attachmentId, size, $event)"
                      >
                        {{ sizeLabel(size) }}
                      </button>
                    }
                  </span>
                }
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
          </span>
        } @else if (seg.kind === 'file') {
          <span class="rich-file">
            <a [href]="seg.src">{{ seg.label }}</a>
            @if (canDelete()) {
              <button
                type="button"
                class="secondary rich-attachment-delete"
                [attr.aria-label]="'ファイルを削除: ' + seg.label"
                (click)="onDelete(seg.attachmentId, $event)"
              >
                削除
              </button>
            }
          </span>
        }
      }
    </ng-template>
    <div class="rich-text">
      @for (block of blocks(); track $index) {
        @switch (block.kind) {
          @case ('paragraph') {
            <div class="rich-paragraph">
              <ng-container *ngTemplateOutlet="inline; context: { $implicit: block.segments }" />
            </div>
          }
          @case ('heading') {
            @switch (block.level) {
              @case (1) {
                <h2 class="rich-heading">
                  <ng-container *ngTemplateOutlet="inline; context: { $implicit: block.segments }" />
                </h2>
              }
              @case (2) {
                <h3 class="rich-heading">
                  <ng-container *ngTemplateOutlet="inline; context: { $implicit: block.segments }" />
                </h3>
              }
              @default {
                <h4 class="rich-heading">
                  <ng-container *ngTemplateOutlet="inline; context: { $implicit: block.segments }" />
                </h4>
              }
            }
          }
          @case ('bullet-list') {
            <ul class="rich-list">
              @for (item of block.items; track $index) {
                <li><ng-container *ngTemplateOutlet="inline; context: { $implicit: item }" /></li>
              }
            </ul>
          }
          @case ('ordered-list') {
            <ol class="rich-list" [attr.start]="block.start">
              @for (item of block.items; track $index) {
                <li><ng-container *ngTemplateOutlet="inline; context: { $implicit: item }" /></li>
              }
            </ol>
          }
          @case ('task-list') {
            <ul class="rich-list rich-task-list">
              @for (item of block.items; track $index) {
                <li>
                  <input
                    type="checkbox"
                    class="rich-task-check"
                    disabled
                    [checked]="item.checked"
                    [attr.aria-label]="item.label"
                  />
                  <span class="rich-task-text">
                    <ng-container *ngTemplateOutlet="inline; context: { $implicit: item.segments }" />
                  </span>
                </li>
              }
            </ul>
          }
          @case ('quote') {
            <blockquote class="rich-quote">
              <ng-container *ngTemplateOutlet="inline; context: { $implicit: block.segments }" />
            </blockquote>
          }
          @case ('code') {
            <pre class="rich-code"><code>{{ block.text }}</code></pre>
          }
          @case ('rule') {
            <hr class="rich-rule" />
          }
        }
      }
    </div>
    <dialog
      #imageLightbox
      class="modal-backdrop rich-image-lightbox"
      (click)="onLightboxBackdrop($event)"
      (close)="onLightboxClosed()"
    >
      <form method="dialog" class="modal rich-image-lightbox-panel" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <h2>{{ lightboxAlt() }}</h2>
          <button
            #lightboxClose
            type="button"
            class="secondary"
            aria-label="閉じる"
            (click)="closeLightbox()"
          >
            ×
          </button>
        </div>
        <div class="rich-image-lightbox-body">
          @if (lightboxSrc(); as src) {
            <img [src]="src" [alt]="lightboxAlt()" />
          }
        </div>
      </form>
    </dialog>
  `,
  styles: `
    .rich-text {
      word-break: break-word;
      line-height: 1.5;
    }
    .rich-paragraph,
    .rich-heading,
    .rich-list li,
    .rich-quote {
      white-space: pre-wrap;
    }
    .rich-heading {
      margin: 0.75rem 0 0.35rem;
      line-height: 1.3;
    }
    h2.rich-heading {
      font-size: 1.3rem;
    }
    h3.rich-heading {
      font-size: 1.15rem;
    }
    h4.rich-heading {
      font-size: 1rem;
    }
    .rich-list {
      margin: 0.35rem 0;
      padding-left: 1.5rem;
    }
    .rich-task-list {
      list-style: none;
      padding-left: 0.25rem;
    }
    .rich-task-check {
      margin: 0 0.4rem 0 0;
      vertical-align: middle;
    }
    .rich-quote {
      margin: 0.35rem 0;
      padding: 0.15rem 0 0.15rem 0.75rem;
      border-left: 3px solid var(--line, #d0d5dd);
      color: var(--muted, #475467);
    }
    .rich-code {
      margin: 0.35rem 0;
      padding: 0.5rem 0.75rem;
      max-height: 24rem;
      overflow: auto;
      white-space: pre;
      word-break: normal;
      background: color-mix(in srgb, var(--line, #d0d5dd) 35%, transparent);
      border-radius: 0.25rem;
      font-size: 0.9rem;
    }
    .rich-rule {
      border: none;
      border-top: 1px solid var(--line, #d0d5dd);
      margin: 0.75rem 0;
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
      cursor: zoom-in;
    }
    .rich-image--sm img {
      max-width: min(100%, 12rem);
    }
    .rich-image--md img {
      max-width: min(100%, 28rem);
    }
    .rich-image--lg img {
      max-width: min(100%, 48rem);
    }
    .rich-image-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem;
      margin-top: 0.25rem;
    }
    .rich-image-size {
      display: inline-flex;
      gap: 0.2rem;
    }
    .rich-image-size-btn {
      font-size: 0.75rem;
      padding: 0.15rem 0.4rem;
    }
    .rich-image-size-btn.is-active {
      font-weight: 650;
    }
    .rich-image-delete {
      font-size: 0.85rem;
    }
    .rich-image-lightbox-panel {
      max-width: min(96vw, 56rem);
      max-height: 90vh;
      display: flex;
      flex-direction: column;
    }
    .rich-image-lightbox-body {
      overflow: auto;
      text-align: center;
    }
    .rich-image-lightbox-body img {
      max-width: 100%;
      max-height: min(80vh, 48rem);
      height: auto;
    }
    .rich-bookmark {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      margin: 0.35rem 0;
      padding: 0.65rem 0.75rem;
      border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
      border-radius: 6px;
      text-decoration: none;
      color: inherit;
      max-width: 36rem;
    }
    .rich-bookmark:hover {
      border-color: color-mix(in srgb, currentColor 35%, transparent);
    }
    .rich-bookmark-title {
      font-weight: 600;
      line-height: 1.3;
      word-break: break-word;
    }
    .rich-bookmark-url {
      font-size: 0.85rem;
      opacity: 0.75;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class DescriptionRichText {
  readonly text = input.required<string>();
  readonly itemNumber = input.required<number>();
  /** Render headings/lists/tasks/quotes/code/rules (description only). */
  readonly blockSyntax = input(false);
  /** Promote sole `[url](url)` paragraphs to bookmark cards (description/solution). */
  readonly promoteBookmarks = input(false);
  /** Normalized URL → title from POST /api/link-previews. */
  readonly linkTitles = input<Record<string, string>>({});
  readonly canDelete = input(false);
  /** When true, show sm/md/lg controls (same gate as delete for description/solution). */
  readonly canChangeImageSize = input(false);
  readonly draggableImages = input(false);
  readonly deleteImage = output<number>();
  readonly imageDisplaySize = output<{ attachmentId: number; size: ImageDisplaySize }>();

  readonly sizeOptions: ImageDisplaySize[] = ['sm', 'md', 'lg'];

  private readonly imageLightbox = viewChild<ElementRef<HTMLDialogElement>>('imageLightbox');
  private readonly lightboxCloseBtn = viewChild<ElementRef<HTMLButtonElement>>('lightboxClose');
  readonly lightboxSrc = signal<string | null>(null);
  readonly lightboxAlt = signal('');
  private lightboxReturnFocus: HTMLElement | null = null;

  readonly blocks = computed(() =>
    buildDescriptionView(this.text(), this.itemNumber(), this.blockSyntax(), {
      promoteBookmarks: this.promoteBookmarks(),
    }),
  );

  sizeLabel(size: ImageDisplaySize): string {
    return size === 'sm' ? '小' : size === 'lg' ? '大' : '中';
  }

  bookmarkTitle(url: string): string {
    const titles = this.linkTitles();
    if (Object.prototype.hasOwnProperty.call(titles, url)) {
      return titles[url] || hostnameFallback(url);
    }
    return '読み込み中';
  }

  /** Shortened URL for the secondary line (not just hostname). */
  bookmarkURLLabel(url: string): string {
    const trimmed = url.replace(/^https:\/\//, '');
    return [...trimmed].length > 64 ? [...trimmed].slice(0, 64).join('') + '…' : trimmed;
  }

  onDragStart(attachmentId: number, alt: string, event: DragEvent): void {
    if (!this.draggableImages()) return;
    const dt = event.dataTransfer;
    if (!dt) return;
    dt.setData(
      SCRUM_ATTACHMENT_MIME,
      encodeAttachmentDragPayload({
        itemNumber: this.itemNumber(),
        attachmentId,
        alt,
      }),
    );
    dt.effectAllowed = 'copy';
  }

  onDelete(attachmentId: number, event: MouseEvent): void {
    event.stopPropagation();
    if (event.detail > 1) return;
    this.deleteImage.emit(attachmentId);
  }

  onSize(attachmentId: number, size: ImageDisplaySize, event: MouseEvent): void {
    event.stopPropagation();
    if (event.detail > 1) return;
    this.imageDisplaySize.emit({
      attachmentId,
      size: normalizeImageDisplaySize(size),
    });
  }

  openLightbox(src: string, alt: string, event: MouseEvent): void {
    if (event.detail > 1) return;
    const dialog = this.imageLightbox()?.nativeElement;
    if (!dialog) return;
    this.lightboxReturnFocus = event.currentTarget as HTMLElement;
    this.lightboxSrc.set(src);
    this.lightboxAlt.set(alt || 'image');
    if (!dialog.open) dialog.showModal();
    queueMicrotask(() => this.lightboxCloseBtn()?.nativeElement.focus());
  }

  closeLightbox(): void {
    const dialog = this.imageLightbox()?.nativeElement;
    if (dialog?.open) dialog.close();
  }

  onLightboxBackdrop(event: MouseEvent): void {
    // Backdrop clicks hit the dialog element; do not close (spec).
    if (event.target === event.currentTarget) event.preventDefault();
  }

  onLightboxClosed(): void {
    this.lightboxSrc.set(null);
    this.lightboxAlt.set('');
    const el = this.lightboxReturnFocus;
    this.lightboxReturnFocus = null;
    queueMicrotask(() => el?.focus?.());
  }
}
