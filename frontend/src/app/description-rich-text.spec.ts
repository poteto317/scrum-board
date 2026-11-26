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
    blockSyntax?: boolean;
  }) {
    TestBed.configureTestingModule({ imports: [DescriptionRichText] });
    const f = TestBed.createComponent(DescriptionRichText);
    f.componentRef.setInput('text', opts.text);
    f.componentRef.setInput('itemNumber', opts.itemNumber);
    f.componentRef.setInput('draggableImages', opts.draggableImages ?? false);
    f.componentRef.setInput('canDelete', opts.canDelete ?? false);
    f.componentRef.setInput('blockSyntax', opts.blockSyntax ?? false);
    f.detectChanges();
    return f;
  }

  it('reuses parsed segments across change detection and unrelated input changes', () => {
    const f = mount({ text: '[see](https://example.com)', itemNumber: 7 });
    const blocks = f.componentInstance.blocks();
    f.detectChanges();
    f.componentRef.setInput('canDelete', true);
    f.componentRef.setInput('draggableImages', true);
    f.detectChanges();
    expect(f.componentInstance.blocks()).toBe(blocks);
    expect(f.nativeElement.querySelector('a').href).toBe('https://example.com/');
  });

  it('reparses and updates the display when text or item number changes', () => {
    const f = mount({ text: 'before', itemNumber: 7 });
    const before = f.componentInstance.blocks();
    f.componentRef.setInput('text', buildAttachmentMarkup(7, 3, 'pic'));
    f.detectChanges();
    const image = f.componentInstance.blocks();
    expect(image).not.toBe(before);
    expect(f.nativeElement.querySelector('img')).toBeTruthy();
    f.componentRef.setInput('itemNumber', 8);
    f.detectChanges();
    expect(f.componentInstance.blocks()).not.toBe(image);
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

  describe('block syntax', () => {
    const all = [
      '# A',
      '## B',
      '### C',
      '- x',
      '2. y',
      '- [x] done',
      '- [ ] todo',
      '> q',
      '---',
      '```',
      '<b>z</b>',
      '```',
    ].join('\n');

    it('renders headings, lists, tasks, quotes, rules and code as elements', () => {
      const f = mount({ text: all, itemNumber: 7, blockSyntax: true });
      const el = f.nativeElement as HTMLElement;
      expect(el.querySelector('h2')!.textContent).toBe('A');
      expect(el.querySelector('h3')!.textContent).toBe('B');
      expect(el.querySelector('h4')!.textContent).toBe('C');
      expect(el.querySelector('ul:not(.rich-task-list) li')!.textContent).toBe('x');
      const ol = el.querySelector('ol')!;
      expect(ol.getAttribute('start')).toBe('2');
      expect(ol.querySelector('li')!.textContent).toBe('y');
      const checks = el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      expect(checks.length).toBe(2);
      expect([...checks].map((c) => c.disabled)).toEqual([true, true]);
      expect([...checks].map((c) => c.checked)).toEqual([true, false]);
      expect([...checks].map((c) => c.getAttribute('aria-label'))).toEqual(['done', 'todo']);
      expect(el.querySelector('blockquote')!.textContent).toBe('q');
      expect([...el.querySelectorAll('.rich-task-text')].map((t) => t.textContent)).toEqual(['done', 'todo']);
      expect(el.querySelector('hr')).toBeTruthy();
      expect(el.querySelector('pre > code')!.textContent).toBe('<b>z</b>');
      expect(el.querySelector('b')).toBeNull();
    });

    it('does not interpret HTML in paragraphs', () => {
      const f = mount({ text: 'a <b>x</b> <img src=x>', itemNumber: 7, blockSyntax: true });
      const el = f.nativeElement as HTMLElement;
      expect(el.querySelector('b')).toBeNull();
      expect(el.querySelector('img')).toBeNull();
      expect(el.querySelector('.rich-paragraph')!.textContent).toBe('a <b>x</b> <img src=x>');
    });

    it('keeps markup as plain text when block syntax is off (comments, solutions)', () => {
      const f = mount({ text: '# A\n- x\n---', itemNumber: 7 });
      const el = f.nativeElement as HTMLElement;
      expect(el.querySelector('h2, ul, hr')).toBeNull();
      expect(el.querySelector('.rich-paragraph')!.textContent).toBe('# A\n- x\n---');
    });

    it('does not render images inside code but does inside list items', () => {
      const img = buildAttachmentMarkup(7, 3, 'pic');
      const code = mount({ text: '```\n' + img + '\n```', itemNumber: 7, blockSyntax: true });
      expect(code.nativeElement.querySelector('img')).toBeNull();
      expect(code.nativeElement.querySelector('pre code').textContent).toBe(img);
      TestBed.resetTestingModule();
      const list = mount({ text: '- ' + img, itemNumber: 7, blockSyntax: true, canDelete: true });
      expect(list.nativeElement.querySelector('li img')).toBeTruthy();
      expect(list.nativeElement.querySelector('li .rich-image-delete')).toBeTruthy();
    });
  });
});
