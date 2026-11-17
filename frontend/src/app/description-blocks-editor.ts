import {
  afterNextRender,
  Component,
  effect,
  ElementRef,
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
  mergeDescriptionBlockWithPrevious,
  normalizeDescriptionBlocks,
  parseDescriptionBlocks,
  serializeDescriptionBlocks,
  splitDescriptionBlock,
} from './description-blocks';

const LENGTH_ERROR = `説明は${DESCRIPTION_MAX_LEN}文字以内で入力してください。`;

@Component({
  selector: 'app-description-blocks-editor',
  templateUrl: './description-blocks-editor.html',
  styleUrl: './description-blocks-editor.css',
})
export class DescriptionBlocksEditor {
  private readonly injector = inject(Injector);
  private readonly areas = viewChildren<ElementRef<HTMLTextAreaElement>>('blockArea');

  readonly value = input.required<string>();
  readonly disabled = input(false);
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
    });
  }

  /** Apply serialized text from outside (e.g. link insert) without waiting on value echo. */
  syncFromSerialized(text: string): void {
    this.pendingEcho = text;
    this.blocks.set(parseDescriptionBlocks(text));
    this.lengthError.set('');
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
      this.lengthError.set(LENGTH_ERROR);
      el.value = this.blocks()[index] ?? '';
      this.resize(el);
      return;
    }
    this.lengthError.set('');
    this.blocks.set(normalized);
    this.emitText();
    if (normalized.length !== next.length || normalized.some((b, i) => b !== next[i])) {
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
        this.lengthError.set(LENGTH_ERROR);
        return;
      }
      this.lengthError.set('');
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
      this.lengthError.set(LENGTH_ERROR);
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

  trackBlock(index: number): number {
    return index;
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
}
