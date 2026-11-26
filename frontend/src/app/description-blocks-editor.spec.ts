import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Api } from './api';
import { DescriptionBlocksEditor } from './description-blocks-editor';
import { DESCRIPTION_MAX_LEN } from './description-blocks';

const apiStub = {
  uploadAttachment: vi.fn(() =>
    of({
      id: 9,
      itemId: 1,
      field: 'description',
      contentType: 'image/png',
      byteSize: 10,
      originalName: 'shot.png',
      createdAt: '',
    }),
  ),
  deleteAttachment: vi.fn(() => of(undefined)),
  listAttachments: vi.fn(() => of([])),
};

@Component({
  imports: [DescriptionBlocksEditor],
  template: `
    <app-description-blocks-editor
      [value]="value"
      [disabled]="disabled"
      (textChange)="onText($event)"
      (compositionChange)="onComp($event)"
      (linkRequest)="onLink($event)"
    />
  `,
})
class Host {
  value = 'hello';
  disabled = false;
  texts: string[] = [];
  comps: boolean[] = [];
  links: { blockIndex: number; start: number; end: number; selectedText: string }[] = [];
  onText(t: string) {
    this.texts.push(t);
    this.value = t;
  }
  onComp(v: boolean) {
    this.comps.push(v);
  }
  onLink(v: { blockIndex: number; start: number; end: number; selectedText: string }) {
    this.links.push(v);
  }
}

describe('DescriptionBlocksEditor', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [{ provide: Api, useValue: apiStub }],
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  const mount = (value = 'hello') => {
    const f = TestBed.createComponent(Host);
    f.componentInstance.value = value;
    f.detectChanges();
    const editor = f.debugElement.children[0].componentInstance as DescriptionBlocksEditor;
    return { f, host: f.componentInstance, editor };
  };

  const areas = (f: ReturnType<typeof mount>['f']) =>
    f.nativeElement.querySelectorAll('textarea.block-input') as NodeListOf<HTMLTextAreaElement>;

  const gaps = (f: ReturnType<typeof mount>['f']) =>
    f.nativeElement.querySelectorAll('.block-gap') as NodeListOf<HTMLElement>;

  it('does not set placeholder on empty description blocks', () => {
    const { f } = mount('');
    const list = [...areas(f)];
    expect(list.length).toBe(1);
    expect(list[0]!.getAttribute('placeholder')).toBeNull();
    expect(list[0]!.getAttribute('aria-label')).toBe('説明ブロック 1');
  });

  it('does not set placeholder on empty trailing blocks', () => {
    const { f } = mount('a\n');
    const list = [...areas(f)];
    expect(list.length).toBe(2);
    for (const [i, el] of list.entries()) {
      expect(el.getAttribute('placeholder')).toBeNull();
      expect(el.getAttribute('aria-label')).toBe(`説明ブロック ${i + 1}`);
    }
  });

  it('splits on Enter and emits text before focus moves', () => {
    const { f, host, editor } = mount('hello');
    const area = areas(f)[0]!;
    area.setSelectionRange(2, 2);
    const before = host.texts.length;
    area.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    f.detectChanges();
    expect(host.texts.length).toBeGreaterThan(before);
    expect(host.texts.at(-1)).toBe('he\nllo');
    expect(editor.blocks()).toEqual(['he', 'llo']);
    expect(areas(f).length).toBe(2);
  });

  it('does not split while isComposing', () => {
    const { f, host } = mount('hello');
    const area = areas(f)[0]!;
    area.setSelectionRange(2, 2);
    area.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        isComposing: true,
      } as KeyboardEventInit),
    );
    f.detectChanges();
    expect(host.texts).toEqual([]);
    expect(areas(f).length).toBe(1);
  });

  it('does not split when keyCode is 229', () => {
    const { f, host } = mount('hello');
    const area = areas(f)[0]!;
    area.setSelectionRange(2, 2);
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'keyCode', { get: () => 229 });
    area.dispatchEvent(ev);
    f.detectChanges();
    expect(host.texts).toEqual([]);
    expect(areas(f).length).toBe(1);
  });

  it('does not split on Enter while the editor is composing', () => {
    const { f, host, editor } = mount('a\nb');
    const second = areas(f)[1]!;
    second.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    second.setSelectionRange(0, 0);
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    second.dispatchEvent(event);
    f.detectChanges();
    expect(event.defaultPrevented).toBe(false);
    expect(editor.blocks()).toEqual(['a', 'b']);
    expect(host.texts).toEqual([]);
  });

  it('keeps IME deletion intact until compositionend, then deletes the trailing block', () => {
    const { f, host, editor } = mount('a\nb');
    const second = areas(f)[1]!;
    second.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    second.value = '';
    second.dispatchEvent(new Event('input', { bubbles: true }));
    second.setSelectionRange(0, 0);

    const composingBackspace = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    second.dispatchEvent(composingBackspace);
    f.detectChanges();
    expect(composingBackspace.defaultPrevented).toBe(false);
    expect(editor.blocks()).toEqual(['a', 'b']);
    expect(host.texts).toEqual([]);

    second.dispatchEvent(new Event('compositionend', { bubbles: true }));
    f.detectChanges();
    expect(editor.blocks()).toEqual(['a', '']);
    expect(host.texts.at(-1)).toBe('a\n');

    const committed = areas(f)[1]!;
    committed.dispatchEvent(new Event('input', { bubbles: true }));
    f.detectChanges();
    expect(host.texts.at(-1)).toBe('a\n');

    committed.setSelectionRange(0, 0);
    committed.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
    );
    f.detectChanges();
    expect(editor.blocks()).toEqual(['a']);
    expect(host.texts.at(-1)).toBe('a');

    const reloaded = mount(host.texts.at(-1));
    expect(reloaded.editor.blocks()).toEqual(['a']);
    expect([...areas(reloaded.f)].map((area) => area.value)).toEqual(['a']);
  });

  it.each([
    ['isComposing', { isComposing: true }],
    ['keyCode 229', {}],
  ])('does not merge on Backspace during IME %s', (_label, init) => {
    const { f, host, editor } = mount('a\n');
    const trailing = areas(f)[1]!;
    trailing.setSelectionRange(0, 0);
    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
      ...init,
    } as KeyboardEventInit);
    if (_label === 'keyCode 229') {
      Object.defineProperty(event, 'keyCode', { get: () => 229 });
    }
    trailing.dispatchEvent(event);
    f.detectChanges();
    expect(event.defaultPrevented).toBe(false);
    expect(editor.blocks()).toEqual(['a', '']);
    expect(host.texts).toEqual([]);
  });

  it('deletes consecutive trailing empty blocks one at a time', () => {
    const { f, host, editor } = mount('a\n\n');
    let trailing = areas(f)[2]!;
    trailing.setSelectionRange(0, 0);
    trailing.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
    );
    f.detectChanges();
    expect(editor.blocks()).toEqual(['a', '']);
    expect(host.texts.at(-1)).toBe('a\n');

    trailing = areas(f)[1]!;
    trailing.setSelectionRange(0, 0);
    trailing.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
    );
    f.detectChanges();
    expect(editor.blocks()).toEqual(['a']);
    expect(host.texts.at(-1)).toBe('a');
  });

  it('merges with previous on Backspace at start', () => {
    const { f, host } = mount('ab\ncd');
    f.detectChanges();
    const second = areas(f)[1]!;
    second.focus();
    second.setSelectionRange(0, 0);
    second.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
    );
    f.detectChanges();
    expect(host.texts.at(-1)).toBe('abcd');
    expect(areas(f).length).toBe(1);
  });

  it('emits textChange on Enter without relying on blur', () => {
    const { f, host } = mount('xy');
    const blur = vi.fn();
    const area = areas(f)[0]!;
    area.addEventListener('blur', blur);
    area.setSelectionRange(1, 1);
    area.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(host.texts.at(-1)).toBe('x\ny');
    // blur may or may not fire; assertion is that text already changed
    expect(host.texts.length).toBe(1);
  });

  it('normalizes pasted newlines into multiple blocks', () => {
    const { f, host } = mount('a');
    const area = areas(f)[0]!;
    area.value = 'a\nb';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    f.detectChanges();
    expect(host.texts.at(-1)).toBe('a\nb');
    expect(areas(f).length).toBe(2);
  });

  it('rejects input that would exceed max length and keeps blocks', () => {
    const { f, host, editor } = mount('ok');
    const area = areas(f)[0]!;
    area.value = 'x'.repeat(DESCRIPTION_MAX_LEN + 1);
    area.dispatchEvent(new Event('input', { bubbles: true }));
    f.detectChanges();
    expect(editor.lengthError()).toContain('10000');
    expect(editor.blocks()).toEqual(['ok']);
    expect(host.texts).toEqual([]);
  });

  it('re-parses when value input switches to another card text', () => {
    const f = TestBed.createComponent(DescriptionBlocksEditor);
    f.componentRef.setInput('value', 'one');
    f.detectChanges();
    f.componentRef.setInput('value', 'two\nthree');
    f.detectChanges();
    expect(f.componentInstance.blocks()).toEqual(['two', 'three']);
  });

  it('still re-parses after a no-op compositionend emit', () => {
    const f = TestBed.createComponent(DescriptionBlocksEditor);
    f.componentRef.setInput('value', 'one');
    f.detectChanges();
    f.componentInstance.onComposition(true);
    f.componentInstance.onComposition(false);
    f.componentRef.setInput('value', 'two');
    f.detectChanges();
    expect(f.componentInstance.blocks()).toEqual(['two']);
  });

  it('does not skip a different external value after syncFromSerialized', () => {
    const f = TestBed.createComponent(DescriptionBlocksEditor);
    f.componentRef.setInput('value', 'one');
    f.detectChanges();
    f.componentInstance.syncFromSerialized('one');
    f.componentRef.setInput('value', 'other');
    f.detectChanges();
    expect(f.componentInstance.blocks()).toEqual(['other']);
  });

  it('schedules resize after loading blocks so overflow:hidden does not leave height unset', async () => {
    const f = TestBed.createComponent(DescriptionBlocksEditor);
    f.componentRef.setInput('value', 'hello world');
    f.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    f.detectChanges();
    const area = f.nativeElement.querySelector('textarea.block-input') as HTMLTextAreaElement;
    expect(area.style.height).toMatch(/px$/);
  });

  it('opens insert menu from leading and trailing gaps', () => {
    const { f, editor } = mount('a\nb');
    expect(gaps(f).length).toBe(3);
    gaps(f)[0]!.click();
    f.detectChanges();
    expect(editor.insertMenuIndex()).toBe(0);
    expect(f.nativeElement.querySelector('[role="menu"]')).toBeTruthy();
    expect(f.nativeElement.querySelectorAll('[role="menuitem"]').length).toBe(2);
    gaps(f)[2]!.click();
    f.detectChanges();
    expect(editor.insertMenuIndex()).toBe(2);
  });

  it('inserts empty text block from menu and focuses it', async () => {
    const { f, host, editor } = mount('a\nb');
    gaps(f)[1]!.click();
    f.detectChanges();
    const textBtn = [...f.nativeElement.querySelectorAll('[role="menuitem"]')].find(
      (el: Element) => el.textContent?.trim() === 'テキスト',
    ) as HTMLButtonElement;
    textBtn.click();
    f.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    f.detectChanges();
    expect(host.texts.at(-1)).toBe('a\n\nb');
    expect(editor.blocks()).toEqual(['a', '', 'b']);
    expect(editor.insertMenuIndex()).toBeNull();
    const focused = areas(f)[1]!;
    expect(document.activeElement).toBe(focused);
    expect(focused.selectionStart).toBe(0);
  });

  it('closes insert menu when Enter splits while menu is open', () => {
    const { f, editor } = mount('hello');
    gaps(f)[0]!.click();
    f.detectChanges();
    expect(editor.insertMenuIndex()).toBe(0);
    const area = areas(f)[0]!;
    area.focus();
    area.setSelectionRange(2, 2);
    area.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    f.detectChanges();
    expect(editor.insertMenuIndex()).toBeNull();
    expect(editor.blocks()).toEqual(['he', 'llo']);
  });

  it('allows inserting empty blocks twice in a row', () => {
    const { f, host } = mount('a');
    gaps(f)[1]!.click();
    f.detectChanges();
    (f.nativeElement.querySelector('[role="menuitem"]') as HTMLButtonElement).click();
    f.detectChanges();
    gaps(f)[gaps(f).length - 1]!.click();
    f.detectChanges();
    (f.nativeElement.querySelector('[role="menuitem"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(host.texts.at(-1)).toBe('a\n\n');
  });

  it('emits linkRequest after inserting empty block from menu', () => {
    const { f, host } = mount('hello');
    gaps(f)[0]!.click();
    f.detectChanges();
    const linkBtn = [...f.nativeElement.querySelectorAll('[role="menuitem"]')].find(
      (el: Element) => el.textContent?.trim() === 'リンク',
    ) as HTMLButtonElement;
    linkBtn.click();
    f.detectChanges();
    expect(host.texts.at(-1)).toBe('\nhello');
    expect(host.links.at(-1)).toEqual({
      blockIndex: 0,
      start: 0,
      end: 0,
      selectedText: '',
    });
  });

  it('shows length error and skips linkRequest when insert would exceed max', () => {
    const { f, host, editor } = mount('x'.repeat(DESCRIPTION_MAX_LEN));
    gaps(f)[1]!.click();
    f.detectChanges();
    const linkBtn = [...f.nativeElement.querySelectorAll('[role="menuitem"]')].find(
      (el: Element) => el.textContent?.trim() === 'リンク',
    ) as HTMLButtonElement;
    linkBtn.click();
    f.detectChanges();
    expect(editor.lengthError()).toContain('10000');
    expect(host.links).toEqual([]);
    expect(host.texts).toEqual([]);
  });

  it('does not open insert menu when disabled', () => {
    const f = TestBed.createComponent(DescriptionBlocksEditor);
    f.componentRef.setInput('value', 'hello');
    f.componentRef.setInput('disabled', true);
    f.detectChanges();
    f.nativeElement.querySelector('.block-gap')!.click();
    f.detectChanges();
    expect(f.componentInstance.insertMenuIndex()).toBeNull();
  });

  it('closes insert menu on Escape and outside click', () => {
    const { f, editor } = mount('hello');
    gaps(f)[0]!.click();
    f.detectChanges();
    expect(editor.insertMenuIndex()).toBe(0);
    f.nativeElement
      .querySelector('.blocks-editor')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.detectChanges();
    expect(editor.insertMenuIndex()).toBeNull();
    gaps(f)[0]!.click();
    f.detectChanges();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    f.detectChanges();
    expect(editor.insertMenuIndex()).toBeNull();
  });

  it('closes insert menu when value is replaced externally', () => {
    const f = TestBed.createComponent(DescriptionBlocksEditor);
    f.componentRef.setInput('value', 'one');
    f.detectChanges();
    f.componentInstance.openInsertMenu(0);
    f.detectChanges();
    expect(f.componentInstance.insertMenuIndex()).toBe(0);
    f.componentRef.setInput('value', 'two');
    f.detectChanges();
    expect(f.componentInstance.insertMenuIndex()).toBeNull();
  });

  it('inserts markup only after successful upload', () => {
    apiStub.uploadAttachment.mockReturnValueOnce(
      of({
        id: 9,
        itemId: 1,
        field: 'description',
        contentType: 'image/png',
        byteSize: 10,
        originalName: 'shot.png',
        createdAt: '',
      }),
    );
    const f = TestBed.createComponent(DescriptionBlocksEditor);
    f.componentRef.setInput('value', 'hello');
    f.componentRef.setInput('itemNumber', 3);
    f.componentRef.setInput('attachmentField', 'description');
    f.detectChanges();
    const before = f.componentInstance.blocks()[0];
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'shot.png', {
      type: 'image/png',
    });
    Object.defineProperty(file, 'size', { value: 4 });
    f.componentInstance.uploadImages([file]);
    f.detectChanges();
    expect(apiStub.uploadAttachment).toHaveBeenCalled();
    expect(f.componentInstance.blocks()[0]).toContain('/attachments/9/content');
    expect(f.componentInstance.blocks()[0]).not.toBe(before);
  });

  it('does not change body when upload fails', () => {
    apiStub.uploadAttachment.mockReturnValueOnce(throwError(() => new Error('fail')));
    const f = TestBed.createComponent(DescriptionBlocksEditor);
    f.componentRef.setInput('value', 'hello');
    f.componentRef.setInput('itemNumber', 3);
    f.componentRef.setInput('attachmentField', 'description');
    f.detectChanges();
    const before = f.componentInstance.blocks()[0];
    const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 3 });
    f.componentInstance.uploadImages([file]);
    f.detectChanges();
    expect(f.componentInstance.blocks()[0]).toBe(before);
    expect(f.componentInstance.imageError()).toContain('アップロード');
  });

  it('opens delete confirm and calls API only after confirm', () => {
    const f = TestBed.createComponent(DescriptionBlocksEditor);
    f.componentRef.setInput('value', 'hello');
    f.componentRef.setInput('itemNumber', 3);
    f.componentRef.setInput('attachmentField', 'description');
    f.detectChanges();
    f.componentInstance.requestDeleteImage(4);
    f.detectChanges();
    expect(f.componentInstance.confirmDeleteId()).toBe(4);
    expect(f.nativeElement.querySelector('.form-actions')).not.toBeNull();
    expect(f.nativeElement.querySelector('.danger-button')).not.toBeNull();
    expect(apiStub.deleteAttachment).not.toHaveBeenCalled();
    f.componentInstance.confirmDeleteImage();
    f.detectChanges();
    expect(apiStub.deleteAttachment).toHaveBeenCalledWith(3, 4, undefined);
  });

  it('hides rich preview for plain text so it does not look like a second block', () => {
    const f = TestBed.createComponent(DescriptionBlocksEditor);
    f.componentRef.setInput('value', 'サーバー側で保持をして、動作できるようにする。');
    f.componentRef.setInput('itemNumber', 140);
    f.componentRef.setInput('attachmentField', 'description');
    f.detectChanges();
    expect(f.componentInstance.showRichPreview()).toBe(false);
    expect(f.nativeElement.querySelector('.blocks-preview')).toBeNull();
    expect(f.nativeElement.querySelectorAll('textarea.block-input').length).toBe(1);
  });

  it('shows rich preview when text has a link', () => {
    const f = TestBed.createComponent(DescriptionBlocksEditor);
    f.componentRef.setInput('value', 'see [docs](https://example.com)');
    f.componentRef.setInput('itemNumber', 140);
    f.componentRef.setInput('attachmentField', 'description');
    f.detectChanges();
    expect(f.componentInstance.showRichPreview()).toBe(true);
    expect(f.nativeElement.querySelector('.blocks-preview')).not.toBeNull();
  });

  it('shows rich preview when text has a same-item attachment image', () => {
    const f = TestBed.createComponent(DescriptionBlocksEditor);
    f.componentRef.setInput(
      'value',
      '![shot](/api/items/by-number/140/attachments/9/content)',
    );
    f.componentRef.setInput('itemNumber', 140);
    f.componentRef.setInput('attachmentField', 'description');
    f.detectChanges();
    expect(f.componentInstance.showRichPreview()).toBe(true);
    expect(f.nativeElement.querySelector('.blocks-preview')).not.toBeNull();
  });

  function mountPreview(value: string, itemNumber: number, field: 'description' | 'solution') {
    const f = TestBed.createComponent(DescriptionBlocksEditor);
    f.componentRef.setInput('value', value);
    f.componentRef.setInput('itemNumber', itemNumber);
    f.componentRef.setInput('attachmentField', field);
    f.detectChanges();
    return f;
  }

  it('shows rich preview with block syntax for description-only markup', () => {
    const f = mountPreview('# 見出し\n- [x] 済み', 140, 'description');
    const preview = f.nativeElement.querySelector('.blocks-preview') as HTMLElement;
    expect(preview).not.toBeNull();
    expect(preview.querySelector('h2')!.textContent!.trim()).toBe('見出し');
    expect(preview.querySelector('input[type="checkbox"]')).not.toBeNull();
  });

  it('keeps block markup as plain text for solutions', () => {
    const f = mountPreview('# 見出し', 140, 'solution');
    expect(f.nativeElement.querySelector('.blocks-preview')).toBeNull();
    const linked = mountPreview('# 見出し [l](https://example.com)', 140, 'solution');
    const preview = linked.nativeElement.querySelector('.blocks-preview') as HTMLElement;
    expect(preview.querySelector('h2')).toBeNull();
    expect(preview.textContent).toContain('# 見出し');
  });

  it('hides rich preview for block markup without an item number', () => {
    const f = mountPreview('# 見出し', 0, 'description');
    expect(f.nativeElement.querySelector('.blocks-preview')).toBeNull();
  });

  describe('paste and multiple images', () => {
    const png = (name: string, type = 'image/png') => {
      const file = new File([new Uint8Array([1, 2, 3])], name, { type });
      Object.defineProperty(file, 'size', { value: 3 });
      return file;
    };
    const clipboard = (opts: { text?: string; html?: boolean; files?: File[] }) =>
      ({
        getData: (t: string) => (t === 'text/plain' ? (opts.text ?? '') : ''),
        files: opts.files ?? [],
        items: [],
        types: [...(opts.text ? ['text/plain'] : []), ...(opts.html ? ['text/html'] : [])],
      }) as unknown as DataTransfer;
    const paste = (area: HTMLTextAreaElement, data: DataTransfer) => {
      const ev = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'clipboardData', { value: data });
      area.dispatchEvent(ev);
      return ev;
    };
    const attachment = (id: number, originalName: string) => ({
      id,
      itemId: 1,
      field: 'description',
      contentType: 'image/png',
      byteSize: 3,
      originalName,
      createdAt: '',
    });
    const mountWithImages = (value = 'hello') => {
      const f = TestBed.createComponent(DescriptionBlocksEditor);
      f.componentRef.setInput('value', value);
      f.componentRef.setInput('itemNumber', 3);
      f.componentRef.setInput('attachmentField', 'description');
      f.detectChanges();
      const area = f.nativeElement.querySelector('textarea.block-input') as HTMLTextAreaElement;
      return { f, editor: f.componentInstance, area };
    };

    beforeEach(() => {
      apiStub.uploadAttachment.mockClear();
    });

    it('uploads a pasted image and inserts it at the caret', () => {
      apiStub.uploadAttachment.mockReturnValueOnce(of(attachment(9, 'image.png')));
      const { editor, area } = mountWithImages('hello');
      area.focus();
      area.setSelectionRange(2, 2);
      const ev = paste(area, clipboard({ files: [png('image.png')] }));
      expect(ev.defaultPrevented).toBe(true);
      expect(apiStub.uploadAttachment).toHaveBeenCalledTimes(1);
      expect(editor.blocks()[0]).toBe(
        'he![image.png](/api/items/by-number/3/attachments/9/content)llo',
      );
      expect(editor.imageBusy()).toBe(false);
      expect(editor.imageError()).toBe('');
    });

    it('uploads several pasted images one by one, in order', () => {
      const first = new Subject<ReturnType<typeof attachment>>();
      const second = new Subject<ReturnType<typeof attachment>>();
      apiStub.uploadAttachment.mockReturnValueOnce(first).mockReturnValueOnce(second);
      const { editor, area } = mountWithImages('ab');
      area.focus();
      area.setSelectionRange(1, 1);
      paste(area, clipboard({ files: [png('a.png'), png('b.png')] }));
      expect(apiStub.uploadAttachment).toHaveBeenCalledTimes(1);
      expect(editor.imageBusy()).toBe(true);
      first.next(attachment(1, 'a.png'));
      first.complete();
      expect(apiStub.uploadAttachment).toHaveBeenCalledTimes(2);
      second.next(attachment(2, 'b.png'));
      second.complete();
      expect(editor.blocks()[0]).toBe(
        'a![a.png](/api/items/by-number/3/attachments/1/content)' +
          '![b.png](/api/items/by-number/3/attachments/2/content)b',
      );
      expect(editor.imageBusy()).toBe(false);
    });

    it('keeps the images added before a failure and reports how many were added', () => {
      apiStub.uploadAttachment
        .mockReturnValueOnce(of(attachment(1, 'a.png')))
        .mockReturnValueOnce(throwError(() => new Error('fail')));
      const { editor } = mountWithImages('');
      editor.uploadImages([png('a.png'), png('b.png'), png('c.png')]);
      expect(apiStub.uploadAttachment).toHaveBeenCalledTimes(2);
      expect(editor.blocks()[0]).toBe('![a.png](/api/items/by-number/3/attachments/1/content)');
      expect(editor.imageError()).toContain('3件中1件');
      expect(editor.imageBusy()).toBe(false);
    });

    it('skips files that are not allowed images and says so', () => {
      apiStub.uploadAttachment.mockReturnValueOnce(of(attachment(1, 'a.png')));
      const { editor } = mountWithImages('');
      editor.uploadImages([png('a.pdf', 'application/pdf'), png('a.png')]);
      expect(apiStub.uploadAttachment).toHaveBeenCalledTimes(1);
      expect(editor.blocks()[0]).toContain('/attachments/1/content');
      expect(editor.imageError()).toContain('JPEG');
    });

    it('uploads nothing when no pasted file is an allowed image', () => {
      const { editor, area } = mountWithImages('hello');
      const ev = paste(area, clipboard({ files: [png('a.pdf', 'application/pdf')] }));
      expect(ev.defaultPrevented).toBe(true);
      expect(apiStub.uploadAttachment).not.toHaveBeenCalled();
      expect(editor.imageError()).toContain('JPEG');
      expect(editor.blocks()).toEqual(['hello']);
    });

    it('does not insert into another item when the item changes during the upload', () => {
      const pending = new Subject<ReturnType<typeof attachment>>();
      apiStub.uploadAttachment.mockReturnValueOnce(pending);
      const { f, editor } = mountWithImages('one');
      editor.uploadImages([png('a.png'), png('b.png')]);
      f.componentRef.setInput('itemNumber', 4);
      f.componentRef.setInput('value', 'other');
      f.detectChanges();
      pending.next(attachment(1, 'a.png'));
      pending.complete();
      expect(editor.blocks()).toEqual(['other']);
      expect(apiStub.uploadAttachment).toHaveBeenCalledTimes(1);
      expect(editor.imageBusy()).toBe(false);
    });

    it('leaves a pasted image to the browser when images are not enabled', () => {
      const { f } = mount('hello');
      const ev = paste(areas(f)[0]!, clipboard({ files: [png('image.png')] }));
      expect(ev.defaultPrevented).toBe(false);
      expect(apiStub.uploadAttachment).not.toHaveBeenCalled();
    });

    it('pastes text as usual when the clipboard has text, HTML and an image', () => {
      const { area } = mountWithImages('hello');
      const ev = paste(area, clipboard({ text: 'A1', html: true, files: [png('image.png')] }));
      expect(ev.defaultPrevented).toBe(false);
      expect(apiStub.uploadAttachment).not.toHaveBeenCalled();
    });

    it('turns the selection into a link when an https URL is pasted over it', async () => {
      const { f, host, editor } = mount('see docs here');
      const area = areas(f)[0]!;
      area.focus();
      area.setSelectionRange(4, 8);
      const ev = paste(area, clipboard({ text: ' https://example.com/a\n' }));
      expect(ev.defaultPrevented).toBe(true);
      expect(editor.blocks()).toEqual(['see [docs](https://example.com/a) here']);
      expect(host.texts.at(-1)).toBe('see [docs](https://example.com/a) here');
      f.detectChanges();
      await new Promise((r) => setTimeout(r, 0));
      expect(areas(f)[0]!.selectionStart).toBe('see [docs](https://example.com/a)'.length);
    });

    it('pastes a URL as usual without a selection, and plain text over a selection', () => {
      const { f, host } = mount('see docs');
      const area = areas(f)[0]!;
      area.focus();
      area.setSelectionRange(3, 3);
      expect(paste(area, clipboard({ text: 'https://example.com' })).defaultPrevented).toBe(false);
      area.setSelectionRange(4, 8);
      expect(paste(area, clipboard({ text: 'plain' })).defaultPrevented).toBe(false);
      expect(host.texts).toEqual([]);
    });

    it('refuses a pasted link that would exceed the description limit', () => {
      const body = 'a' + 'x'.repeat(DESCRIPTION_MAX_LEN - 1);
      const { f, host, editor } = mount(body);
      const area = areas(f)[0]!;
      area.focus();
      area.setSelectionRange(0, 1);
      const ev = paste(area, clipboard({ text: 'https://example.com' }));
      expect(ev.defaultPrevented).toBe(true);
      expect(editor.lengthError()).not.toBe('');
      expect(editor.blocks()).toEqual([body]);
      expect(host.texts).toEqual([]);
    });

    it('locks the blocks while images upload, so the insert position cannot move', () => {
      const pending = new Subject<ReturnType<typeof attachment>>();
      apiStub.uploadAttachment.mockReturnValueOnce(pending);
      const { f, editor, area } = mountWithImages('ab');
      area.focus();
      area.setSelectionRange(2, 2);
      paste(area, clipboard({ files: [png('a.png')] }));
      f.detectChanges();
      expect(area.readOnly).toBe(true);
      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      area.dispatchEvent(enter);
      expect(enter.defaultPrevented).toBe(true);
      area.setSelectionRange(0, 1);
      const link = paste(area, clipboard({ text: 'https://example.com' }));
      expect(link.defaultPrevented).toBe(false);
      editor.openInsertMenu(0);
      editor.requestLink();
      expect(editor.insertMenuIndex()).toBeNull();
      expect(editor.blocks()).toEqual(['ab']);
      pending.next(attachment(1, 'a.png'));
      pending.complete();
      f.detectChanges();
      expect(editor.blocks()).toEqual(['ab![a.png](/api/items/by-number/3/attachments/1/content)']);
      expect(area.readOnly).toBe(false);
    });

    it('says so when more images arrive during an upload', () => {
      const pending = new Subject<ReturnType<typeof attachment>>();
      apiStub.uploadAttachment.mockReturnValueOnce(pending);
      const { editor, area } = mountWithImages('ab');
      editor.uploadImages([png('a.png')]);
      const ev = paste(area, clipboard({ files: [png('b.png')] }));
      expect(ev.defaultPrevented).toBe(true);
      expect(apiStub.uploadAttachment).toHaveBeenCalledTimes(1);
      expect(editor.imageError()).toContain('画像の処理中');
      pending.next(attachment(1, 'a.png'));
      pending.complete();
      expect(editor.imageError()).toBe('');
    });

    it('stops quietly when the editor is destroyed during an upload', () => {
      const pending = new Subject<ReturnType<typeof attachment>>();
      apiStub.uploadAttachment.mockReturnValueOnce(pending);
      const { f, editor } = mountWithImages('ab');
      editor.uploadImages([png('a.png'), png('b.png')]);
      f.destroy();
      expect(() => {
        pending.next(attachment(1, 'a.png'));
        pending.complete();
      }).not.toThrow();
      expect(apiStub.uploadAttachment).toHaveBeenCalledTimes(1);
      expect(editor.blocks()).toEqual(['ab']);
    });

    it('does not insert when the project changes during an upload', () => {
      const pending = new Subject<ReturnType<typeof attachment>>();
      apiStub.uploadAttachment.mockReturnValueOnce(pending);
      const { f, editor } = mountWithImages('ab');
      f.componentRef.setInput('projectId', 1);
      f.detectChanges();
      editor.uploadImages([png('a.png')]);
      f.componentRef.setInput('projectId', 2);
      f.detectChanges();
      pending.next(attachment(1, 'a.png'));
      expect(editor.blocks()).toEqual(['ab']);
      expect(editor.imageBusy()).toBe(false);
    });

    it('does not show a failure on another item when the upload fails after a switch', () => {
      const pending = new Subject<ReturnType<typeof attachment>>();
      apiStub.uploadAttachment.mockReturnValueOnce(pending);
      const { f, editor } = mountWithImages('one');
      editor.uploadImages([png('a.png')]);
      f.componentRef.setInput('itemNumber', 4);
      f.componentRef.setInput('value', 'other');
      f.detectChanges();
      pending.error({ error: { message: '添付はアイテムあたり20枚までです。' } });
      expect(editor.imageError()).toBe('');
      expect(editor.imageBusy()).toBe(false);
    });

    it('stops at the description limit and keeps what fit', () => {
      apiStub.uploadAttachment
        .mockReturnValueOnce(of(attachment(1, 'a.png')))
        .mockReturnValueOnce(of(attachment(2, 'b.png')));
      const first = '![a.png](/api/items/by-number/3/attachments/1/content)';
      const { editor } = mountWithImages('x'.repeat(DESCRIPTION_MAX_LEN - first.length));
      editor.uploadImages([png('a.png'), png('b.png'), png('c.png')]);
      expect(apiStub.uploadAttachment).toHaveBeenCalledTimes(2);
      expect(editor.blocks()[0]).toContain('/attachments/1/content');
      expect(editor.blocks()[0]).not.toContain('/attachments/2/content');
      expect(editor.imageError()).not.toBe('');
      expect(editor.imageBusy()).toBe(false);
    });

    it('shows the reason from the server when an upload is refused', () => {
      apiStub.uploadAttachment.mockReturnValueOnce(
        throwError(() => ({ error: { message: '添付はアイテムあたり20枚までです。' } })),
      );
      const { editor } = mountWithImages('');
      editor.uploadImages([png('a.png')]);
      expect(editor.imageError()).toBe('添付はアイテムあたり20枚までです。');
    });

    it('leaves a URL paste to the browser while composing', () => {
      const { f, host } = mount('see docs');
      const area = areas(f)[0]!;
      area.focus();
      area.dispatchEvent(new Event('compositionstart', { bubbles: true }));
      area.setSelectionRange(4, 8);
      const ev = paste(area, clipboard({ text: 'https://example.com' }));
      expect(ev.defaultPrevented).toBe(false);
      expect(host.texts).toEqual([]);
    });

    it('does nothing on paste while disabled', () => {
      const f = TestBed.createComponent(DescriptionBlocksEditor);
      f.componentRef.setInput('value', 'hello');
      f.componentRef.setInput('itemNumber', 3);
      f.componentRef.setInput('attachmentField', 'description');
      f.componentRef.setInput('disabled', true);
      f.detectChanges();
      const ev = new Event('paste', { cancelable: true }) as ClipboardEvent;
      Object.defineProperty(ev, 'clipboardData', { value: clipboard({ files: [png('a.png')] }) });
      f.componentInstance.onPaste(0, ev);
      expect(ev.defaultPrevented).toBe(false);
      expect(apiStub.uploadAttachment).not.toHaveBeenCalled();
    });

    it('uploads every dropped image', () => {
      apiStub.uploadAttachment
        .mockReturnValueOnce(of(attachment(1, 'a.png')))
        .mockReturnValueOnce(of(attachment(2, 'b.png')));
      const { editor } = mountWithImages('');
      const ev = new Event('drop', { cancelable: true }) as DragEvent;
      Object.defineProperty(ev, 'dataTransfer', {
        value: clipboard({ files: [png('a.png'), png('b.png')] }),
      });
      editor.onDrop(ev);
      expect(apiStub.uploadAttachment).toHaveBeenCalledTimes(2);
      expect(editor.blocks()[0]).toContain('/attachments/1/content');
      expect(editor.blocks()[0]).toContain('/attachments/2/content');
    });
  });
});
