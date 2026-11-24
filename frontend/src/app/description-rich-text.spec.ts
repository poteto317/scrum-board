import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SCRUM_ATTACHMENT_MIME,
  encodeAttachmentDragPayload,
} from './attachment-dnd';
import { buildAttachmentMarkup } from './description-link';
import { DescriptionRichText } from './description-rich-text';

describe('DescriptionRichText', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  function mount(opts: {
    text: string;
    itemNumber: number;
    draggableImages?: boolean;
    canDelete?: boolean;
  }) {
    TestBed.configureTestingModule({ imports: [DescriptionRichText] });
    const f = TestBed.createComponent(DescriptionRichText);
    f.componentRef.setInput('text', opts.text);
    f.componentRef.setInput('itemNumber', opts.itemNumber);
    f.componentRef.setInput('draggableImages', opts.draggableImages ?? false);
    f.componentRef.setInput('canDelete', opts.canDelete ?? false);
    f.detectChanges();
    return f;
  }

  it('reuses parsed segments across change detection and unrelated input changes', () => {
    const f = mount({ text: '[see](https://example.com)', itemNumber: 7 });
    const segments = f.componentInstance.segments();
    f.detectChanges();
    f.componentRef.setInput('canDelete', true);
    f.componentRef.setInput('draggableImages', true);
    f.detectChanges();
    expect(f.componentInstance.segments()).toBe(segments);
    expect(f.nativeElement.querySelector('a').href).toBe('https://example.com/');
  });

  it('reparses and updates the display when text or item number changes', () => {
    const f = mount({ text: 'before', itemNumber: 7 });
    const before = f.componentInstance.segments();
    f.componentRef.setInput('text', buildAttachmentMarkup(7, 3, 'pic'));
    f.detectChanges();
    const image = f.componentInstance.segments();
    expect(image).not.toBe(before);
    expect(f.nativeElement.querySelector('img')).toBeTruthy();
    f.componentRef.setInput('itemNumber', 8);
    f.detectChanges();
    expect(f.componentInstance.segments()).not.toBe(image);
    expect(f.nativeElement.querySelector('img')).toBeNull();
  });

  it('loads attachment images lazily and decodes them asynchronously', () => {
    const f = mount({ text: buildAttachmentMarkup(7, 3, 'pic'), itemNumber: 7 });
    const img = f.nativeElement.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
  });

  it('sets custom MIME on image dragstart when draggableImages', () => {
    const markup = buildAttachmentMarkup(7, 3, 'pic');
    const f = mount({ text: `before ${markup} after`, itemNumber: 7, draggableImages: true });
    const img = f.nativeElement.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('draggable')).toBe('true');
    const setData = vi.fn();
    const dt = { setData, effectAllowed: 'uninitialized' };
    const ev = new Event('dragstart', { bubbles: true }) as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    img.dispatchEvent(ev);
    expect(setData).toHaveBeenCalledWith(
      SCRUM_ATTACHMENT_MIME,
      encodeAttachmentDragPayload({ itemNumber: 7, attachmentId: 3, alt: 'pic' }),
    );
    expect(dt.effectAllowed).toBe('copy');
  });

  it('does not set MIME when draggableImages is false', () => {
    const markup = buildAttachmentMarkup(7, 3, 'pic');
    const f = mount({ text: markup, itemNumber: 7, draggableImages: false });
    const img = f.nativeElement.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('draggable')).toBe('false');
    const setData = vi.fn();
    const ev = new Event('dragstart', { bubbles: true }) as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', {
      value: { setData, effectAllowed: 'uninitialized' },
    });
    img.dispatchEvent(ev);
    expect(setData).not.toHaveBeenCalled();
  });

  it('delete button is not draggable', () => {
    const markup = buildAttachmentMarkup(7, 3, 'pic');
    const f = mount({
      text: markup,
      itemNumber: 7,
      draggableImages: true,
      canDelete: true,
    });
    const btn = f.nativeElement.querySelector('.rich-image-delete') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('draggable')).toBeNull();
  });
});
