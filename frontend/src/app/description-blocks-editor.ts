import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { Api, ItemAttachment } from './api';
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
import {
  buildAttachmentMarkup,
  insertMarkupAt,
  parseDescriptionLinks,
} from './description-link';
import { DescriptionRichText } from './description-rich-text';
import {
  ATTACHMENT_IMAGE_BUSY_HINT,
  imageUploadDoneMessage,
  imageUploadPlanNotice,
  planImageUpload,
} from './attachment-image';
import {
  clipboardFilesToAttach,
  filesFromDataTransfer,
  pasteLinkOverSelection,
} from './paste-content';
import { uploadImagesInOrder } from './upload-images-in-order';

const DEFAULT_LENGTH_ERROR = `説明は${DESCRIPTION_MAX_LEN}文字以内で入力してください。`;

@Component({
  selector: 'app-description-blocks-editor',
  imports: [DescriptionRichText],
  templateUrl: './description-blocks-editor.html',
  styleUrl: './description-blocks-editor.css',
})
export class DescriptionBlocksEditor {
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly api = inject(Api);
  private readonly areas = viewChildren<ElementRef<HTMLTextAreaElement>>('blockArea');
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('imageFile');

  readonly value = input.required<string>();
  readonly disabled = input(false);
  /** Overridable length error (solution page uses「ソリューションは…」). */
  readonly lengthErrorMessage = input(DEFAULT_LENGTH_ERROR);
  /** When set with attachmentField, enables image upload / preview. */
  readonly itemNumber = input(0);
  readonly projectId = input<number | undefined>(undefined);
  readonly attachmentField = input<'description' | 'solution' | null>(null);
  readonly textChange = output<string>();
  readonly compositionChange = output<boolean>();
  readonly linkRequest = output<{
    blockIndex: number;
    start: number;
    end: number;
    selectedText: string;
  }>();
  /** Fired after attachment DELETE so parent can reload item bodies. */
  readonly attachmentDeleted = output<void>();
  /** Fired when focus leaves the editor (not to toolbar / another block). */
  readonly blurLeave = output<void>();
  readonly lengthError = signal('');
  readonly imageError = signal('');
  readonly imageBusy = signal(false);
  readonly confirmDeleteId = signal<number | null>(null);
  readonly attachments = signal<ItemAttachment[]>([]);
  readonly blocks = signal<string[]>(['']);
  /** Insertion index for open menu; null when closed. */
  readonly insertMenuIndex = signal<number | null>(null);
  private uploadGuard = false;
  private deleteGuard = false;
  /** Gap slots: 0..blocks.length inclusive. */
  readonly gapIndexes = computed(() => {
    const n = this.blocks().length;
    return Array.from({ length: n + 1 }, (_, i) => i);
  });

  /**
   * Rich preview under the textareas. Only when links/images need rendering —
   * plain text alone looked like a second, non-editable duplicate block.
   */
  readonly showRichPreview = computed(() => {
    const number = this.itemNumber();
    const text = this.value();
    if (number <= 0 || text === '') return false;
    return parseDescriptionLinks(text, number).some(
      (seg) => seg.kind === 'link' || seg.kind === 'image',
    );
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
    effect(() => {
      const number = this.itemNumber();
      if (number <= 0) {
        this.attachments.set([]);
        return;
      }
      this.reloadAttachments();
    });
  }

  private reloadAttachments(): void {
    const number = this.itemNumber();
    if (number <= 0) return;
    this.api.listAttachments(number, this.projectId()).subscribe({
      next: (list) => this.attachments.set(list),
      error: () => this.attachments.set([]),
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
    if (
      (event.key === 'Enter' || event.key === 'Backspace') &&
      (this.composing || event.isComposing || event.keyCode === 229)
    ) {
      return;
    }
    // 画像のアップロード・削除の間（imageBusy）は、挿入位置がずれないように本文の構造を変えない。
    if (this.imageBusy() && (event.key === 'Enter' || event.key === 'Backspace')) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
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
    if (!el || this.disabled() || this.imageBusy()) return;
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
    if (this.disabled() || this.imageBusy()) return;
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

  imagesEnabled(): boolean {
    return this.itemNumber() > 0 && this.attachmentField() != null && !this.disabled();
  }

  pickImage(): void {
    if (!this.imagesEnabled() || this.imageBusy() || this.uploadGuard) return;
    this.fileInput()?.nativeElement.click();
  }

  onImageFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) this.uploadImages(files);
  }

  onDragOver(event: DragEvent): void {
    if (!this.imagesEnabled()) return;
    event.preventDefault();
  }

  onDrop(event: DragEvent): void {
    if (!this.imagesEnabled()) return;
    event.preventDefault();
    const files = filesFromDataTransfer(event.dataTransfer);
    if (files.length) this.uploadImages(files);
  }

  /**
   * 貼り付け: 画像ならアップロードして本文へ入れ、選択した文字への URL ならリンクにする。
   * どちらでもなければ、ブラウザの通常の貼り付けに任せる。
   */
  onPaste(index: number, event: ClipboardEvent): void {
    if (this.disabled()) return;
    const dt = event.clipboardData;
    if (!dt) return;
    const files = clipboardFilesToAttach(dt);
    if (files.length) {
      if (!this.imagesEnabled()) return;
      event.preventDefault();
      this.focusedIndex = index;
      this.uploadImages(files);
      return;
    }
    const el = event.target as HTMLTextAreaElement;
    const block = this.blocks()[index] ?? '';
    // 変換中などで入力欄と手元の本文がずれていたら、位置が合わないので通常の貼り付けに任せる。
    if (this.composing || el.value !== block) return;
    // 画像のアップロード・削除の間は本文を変えない（入力欄は読み取り専用なので、通常の貼り付けも入らない）。
    if (this.imageBusy()) return;
    const others = descriptionLength(serializeDescriptionBlocks(this.blocks())) - descriptionLength(block);
    const result = pasteLinkOverSelection(
      block,
      el.selectionStart ?? 0,
      el.selectionEnd ?? 0,
      dt.getData('text/plain').trim(),
      DESCRIPTION_MAX_LEN - others,
    );
    if (result.kind === 'default') return;
    event.preventDefault();
    if (result.kind === 'error') {
      this.lengthError.set(this.lengthErrorMessage());
      return;
    }
    this.lengthError.set('');
    const next = [...this.blocks()];
    next[index] = result.text;
    this.blocks.set(next);
    this.emitText();
    this.focusBlock(index, result.caret);
  }

  /** 画像を 1 件ずつ順にアップロードし、成功するたびにキャレットの位置へ入れる。 */
  uploadImages(files: readonly File[]): void {
    if (!this.imagesEnabled()) return;
    if (this.imageBusy() || this.uploadGuard) {
      // 黙って捨てない（貼り付け・ドロップは既定の動作を止めているので、何も起きないように見える）。
      if (this.uploadGuard) this.imageError.set(ATTACHMENT_IMAGE_BUSY_HINT);
      return;
    }
    const plan = planImageUpload(files);
    if (!plan.accepted.length) {
      this.imageError.set(imageUploadPlanNotice(plan));
      return;
    }
    const field = this.attachmentField();
    const number = this.itemNumber();
    if (!field || number <= 0) return;
    const projectId = this.projectId();
    this.uploadGuard = true;
    this.imageBusy.set(true);
    this.imageError.set('');
    const index = this.focusedIndex;
    const el = this.areas().at(index)?.nativeElement;
    const start = el?.selectionStart ?? (this.blocks()[index]?.length ?? 0);
    const end = el?.selectionEnd ?? start;
    let caret = { start, end };
    let stopError = '';
    // 待っている間に別のアイテムへ切り替わった・画面を離れたら、その本文にも文言にも触れない。
    const stillSameItem = () =>
      !this.destroyRef.destroyed &&
      this.itemNumber() === number &&
      this.attachmentField() === field &&
      this.projectId() === projectId;
    uploadImagesInOrder({
      files: plan.accepted,
      upload: (file) => this.api.uploadAttachment(number, file, field, projectId),
      onUploaded: (att, file) => {
        if (!stillSameItem()) return 'stop';
        this.reloadAttachments();
        const markup = buildAttachmentMarkup(number, att.id, att.originalName || file.name);
        const inserted = this.insertIntoBlock(index, caret.start, caret.end, markup);
        if (!inserted) {
          stopError = this.lengthErrorMessage();
          return 'stop';
        }
        caret = { start: inserted.caret, end: inserted.caret };
        return 'continue';
      },
      onDone: (outcome) => {
        // 忙しい状態は、切り替えの後でも必ず解く。文言は、始めたときのアイテムのままのときだけ出す
        // （失敗のときは onUploaded を通らないので、ここで見直す）。
        this.uploadGuard = false;
        this.imageBusy.set(false);
        if (!stillSameItem()) return;
        this.imageError.set(imageUploadDoneMessage(outcome, plan, stopError));
      },
    });
  }

  /**
   * ブロックの `start..end` を `markup` に置き換えて通知し、キャレットを直後へ移す。
   * 説明全体が上限を超えるなら何もせず null。
   */
  private insertIntoBlock(
    index: number,
    start: number,
    end: number,
    markup: string,
  ): { caret: number } | null {
    const blocks = this.blocks();
    const at = Math.min(index, blocks.length - 1);
    const block = blocks[at] ?? '';
    const others = descriptionLength(serializeDescriptionBlocks(blocks)) - descriptionLength(block);
    const inserted = insertMarkupAt(block, start, end, markup, DESCRIPTION_MAX_LEN - others);
    if (!inserted) return null;
    const next = [...blocks];
    next[at] = inserted.text;
    this.blocks.set(normalizeDescriptionBlocks(next));
    this.emitText();
    // 待っている間に別の欄へ移っていたら、フォーカスを奪い返さない。
    const active = document.activeElement;
    if (!active || active === document.body || this.host.nativeElement.contains(active)) {
      this.focusBlock(at, inserted.caret);
    }
    return { caret: inserted.caret };
  }

  requestDeleteImage(attachmentId: number): void {
    if (this.deleteGuard || this.imageBusy() || this.confirmDeleteId() != null) return;
    this.confirmDeleteId.set(attachmentId);
  }

  cancelDeleteImage(): void {
    this.confirmDeleteId.set(null);
  }

  confirmDeleteImage(event?: MouseEvent | KeyboardEvent): void {
    if (event instanceof MouseEvent && event.detail > 1) return;
    if (event instanceof KeyboardEvent && event.repeat) return;
    const id = this.confirmDeleteId();
    if (id == null || this.deleteGuard || this.imageBusy()) return;
    const number = this.itemNumber();
    if (number <= 0) return;
    this.deleteGuard = true;
    this.imageBusy.set(true);
    this.api.deleteAttachment(number, id, this.projectId()).subscribe({
      next: () => {
        this.deleteGuard = false;
        this.imageBusy.set(false);
        this.confirmDeleteId.set(null);
        this.reloadAttachments();
        this.attachmentDeleted.emit();
      },
      error: () => {
        this.deleteGuard = false;
        this.imageBusy.set(false);
        this.imageError.set('画像の削除に失敗しました。');
        this.confirmDeleteId.set(null);
      },
    });
  }

  private insertEmptyFromMenu(openLink: boolean): void {
    const index = this.insertMenuIndex();
    if (index === null || this.disabled() || this.imageBusy()) return;
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
