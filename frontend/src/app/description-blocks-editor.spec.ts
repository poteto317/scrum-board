import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DescriptionBlocksEditor } from './description-blocks-editor';
import { DESCRIPTION_MAX_LEN } from './description-blocks';

@Component({
  imports: [DescriptionBlocksEditor],
  template: `
    <app-description-blocks-editor
      [value]="value"
      (textChange)="onText($event)"
      (compositionChange)="onComp($event)"
    />
  `,
})
class Host {
  value = 'hello';
  texts: string[] = [];
  comps: boolean[] = [];
  onText(t: string) {
    this.texts.push(t);
    this.value = t;
  }
  onComp(v: boolean) {
    this.comps.push(v);
  }
}

describe('DescriptionBlocksEditor', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [Host] });
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
});
