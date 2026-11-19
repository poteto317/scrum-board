import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import {
  DESCRIPTION_MAX_LEN,
  descriptionLength,
  insertEmptyBlockAt,
  mergeDescriptionBlockWithPrevious,
  normalizeDescriptionBlocks,
  parseDescriptionBlocks,
  serializeDescriptionBlocks,
  splitDescriptionBlock,
} from './description-blocks';

const DEFAULT_LENGTH_ERROR = `説明は${DESCRIPTION_MAX_LEN}文字以内で入力してください。`;

@Component({
  selector: 'app-description-blocks-editor',
  templateUrl: './description-blocks-editor.html',
  styleUrl: './description-blocks-editor.css',
})
export class DescriptionBlocksEditor {
  private readonly injector = inject(Injector);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly areas = viewChildren<ElementRef<HTMLTextAreaElement>>('blockArea');

  readonly value = input.required<string>();
  readonly disabled = input(false);
  /** Overridable length error (solution page uses「ソリューションは…」). */
  readonly lengthErrorMessage = input(DEFAULT_LENGTH_ERROR);
  readonly textChange = output<string>();
  readonly compositionChange = output<boolean>();
  readonly linkRequest = output<{
    blockIndex: number;
    start: number;
    end: number;
    selectedText: string;
  }>();
  /** Fired when focus leaves the editor (not to toolbar / another block). */
  readonly blurLeave = output<void>();
  readonly lengthError = signal('');
  readonly blocks = signal<string[]>(['']);
  /** Insertion index for open menu; null when closed. */
  readonly insertMenuIndex = signal<number | null>(null);
  /** Gap slots: 0..blocks.length inclusive. */
  readonly gapIndexes = computed(() => {
    const n = this.blocks().length;
    return Array.from({ length: n + 1 }, (_, i) => i);
  });

  /** When set, skip the next value() update only if it equals this string (echo). */
  private pendingEcho: string | null = null;
  private focusedIndex = 0;
  private composing = false;

  constructor() {
    effect(() => {
      const next = this.value();
      if (this.pendingEcho !== null && next === this.pendingEcho) {
        this.pendingEcho = null;
        return;
      }
      this.pendingEcho = null;
      this.blocks.set(parseDescriptionBlocks(next));
      this.lengthError.set('');
      this.closeInsertMenu();
      this.resizeAllSoon();
    });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.insertMenuIndex() === null) return;
    const t = event.target as Node | null;
    if (t && this.host.nativeElement.contains(t)) return;
    this.closeInsertMenu();
  }

  /** Apply serialized text from outside (e.g. link insert) without waiting on value echo. */
  syncFromSerialized(text: string): void {
    this.pendingEcho = text;
    this.blocks.set(parseDescriptionBlocks(text));
    this.lengthError.set('');
    this.resizeAllSoon();
  }

  focusBlock(blockIndex: number, caret: number): void {
    afterNextRender(
      () => {
        const el = this.areas().at(blockIndex)?.nativeElement;
        if (!el) return;
        el.focus();
        const at = Math.max(0, Math.min(caret, el.value.length));
        el.setSelectionRange(at, at);
        this.resize(el);
      },
      { injector: this.injector },
    );
  }

  onFocus(index: number): void {
    this.focusedIndex = index;
  }

  onInput(index: number, event: Event): void {
    // Match Angular DefaultValueAccessor: do not push to the form mid-IME (composition).
    if (this.composing) return;
    const el = event.target as HTMLTextAreaElement;
    const next = [...this.blocks()];
    next[index] = el.value;
    const normalized = normalizeDescriptionBlocks(next);
    if (descriptionLength(serializeDescriptionBlocks(normalized)) > DESCRIPTION_MAX_LEN) {
      this.lengthError.set(this.lengthErrorMessage());
      el.value = this.blocks()[index] ?? '';
      this.resize(el);
      return;
    }
    this.lengthError.set('');
    const structureChanged =
      normalized.length !== next.length || normalized.some((b, i) => b !== next[i]);
    if (structureChanged) this.closeInsertMenu();
    this.blocks.set(normalized);
    this.emitText();
    if (structureChanged) {
      // Paste introduced newlines — refocus the block that absorbed the caret roughly.
      this.focusBlock(Math.min(index, normalized.length - 1), 0);
    } else {
      this.resize(el);
    }
  }

  onKeydown(index: number, event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      if (event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      const el = event.target as HTMLTextAreaElement;
      const caret = el.selectionStart ?? 0;
      const split = splitDescriptionBlock(this.blocks(), index, caret);
      if (!split) {
        this.lengthError.set(this.lengthErrorMessage());
        return;
      }
      this.lengthError.set('');
      this.closeInsertMenu();
      this.blocks.set(split);
      this.emitText();
      this.focusBlock(index + 1, 0);
      return;
    }
    if (event.key === 'Backspace') {
      const el = event.target as HTMLTextAreaElement;
      if ((el.selectionStart ?? 0) !== 0 || (el.selectionEnd ?? 0) !== 0) return;
      const merged = mergeDescriptionBlockWithPrevious(this.blocks(), index);
      if (!merged) return;
      event.preventDefault();
      this.lengthError.set('');
      this.closeInsertMenu();
      this.blocks.set(merged.blocks);
      this.emitText();
      this.focusBlock(index - 1, merged.caret);
    }
  }

  onComposition(start: boolean): void {
    this.composing = start;
    this.compositionChange.emit(start);
    if (start) return;
    const next = this.areas().map((ref) => ref.nativeElement.value);
    const normalized = normalizeDescriptionBlocks(next.length ? next : this.blocks());
    if (descriptionLength(serializeDescriptionBlocks(normalized)) > DESCRIPTION_MAX_LEN) {
      this.lengthError.set(this.lengthErrorMessage());
      this.areas().forEach((ref, i) => {
        ref.nativeElement.value = this.blocks()[i] ?? '';
        this.resize(ref.nativeElement);
      });
      return;
    }
    this.lengthError.set('');
    this.blocks.set(normalized);
    this.emitText();
  }

  onBlur(event: FocusEvent): void {
    const next = event.relatedTarget as HTMLElement | null;
    if (next?.closest('.blocks-editor, .description-link-dialog')) return;
    this.blurLeave.emit();
  }

  requestLink(): void {
    const index = this.focusedIndex;
    const el = this.areas().at(index)?.nativeElement;
    if (!el || this.disabled()) return;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    this.linkRequest.emit({
      blockIndex: index,
      start,
      end,
      selectedText: el.value.slice(start, end),
    });
  }

  onGapPointerDown(event: MouseEvent): void {
    event.preventDefault();
  }

  openInsertMenu(index: number, event?: MouseEvent): void {
    event?.stopPropagation();
    if (this.disabled()) return;
    if (this.insertMenuIndex() === index) {
      this.closeInsertMenu();
      return;
    }
    this.insertMenuIndex.set(index);
  }

  closeInsertMenu(): void {
    this.insertMenuIndex.set(null);
  }

  gapAriaLabel(index: number): string {
    if (index === 0) return 'ブロックを挿入（先頭）';
    if (index >= this.blocks().length) return 'ブロックを挿入（末尾）';
    return `ブロックを挿入（${index + 1}番目の前）`;
  }

  insertTextAtMenu(): void {
    this.insertEmptyFromMenu(false);
  }

  insertLinkAtMenu(): void {
    this.insertEmptyFromMenu(true);
  }

  private insertEmptyFromMenu(openLink: boolean): void {
    const index = this.insertMenuIndex();
    if (index === null || this.disabled()) return;
    const next = insertEmptyBlockAt(this.blocks(), index);
    this.closeInsertMenu();
    if (!next) {
      this.lengthError.set(this.lengthErrorMessage());
      return;
    }
    this.lengthError.set('');
    this.blocks.set(next);
    this.emitText();
    this.focusedIndex = index;
    if (openLink) {
      this.linkRequest.emit({
        blockIndex: index,
        start: 0,
        end: 0,
        selectedText: '',
      });
    }
    this.focusBlock(index, 0);
  }

  private emitText(): void {
    const text = serializeDescriptionBlocks(this.blocks());
    this.pendingEcho = text;
    this.textChange.emit(text);
  }

  private resize(el: HTMLTextAreaElement): void {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  private resizeAllSoon(): void {
    afterNextRender(
      () => {
        for (const ref of this.areas()) this.resize(ref.nativeElement);
      },
      { injector: this.injector },
    );
  }
}
