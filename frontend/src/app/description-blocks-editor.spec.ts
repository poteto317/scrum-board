import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Api } from './api';
import { DescriptionBlocksEditor } from './description-blocks-editor';
import { DESCRIPTION_MAX_LEN } from './description-blocks';

const apiStub = {
  uploadAttachment: vi.fn(() => of({})),
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
});
