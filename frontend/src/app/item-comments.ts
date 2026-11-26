import {
  Component,
  DestroyRef,
  ElementRef,
  Input,
  OnChanges,
  SimpleChanges,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { Api } from './api';
import { AuthSession } from './auth-session';
import {
  SCRUM_ATTACHMENT_MIME,
  attachmentDragBelongsToItem,
  dataTransferHasAttachmentMime,
  decodeAttachmentDragPayload,
} from './attachment-dnd';
import { buildAttachmentMarkup, insertMarkupAt } from './description-link';
import { DescriptionRichText } from './description-rich-text';
import { ItemComment } from './models';
import {
  ATTACHMENT_IMAGE_ACCEPT,
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

export const COMMENT_BODY_MAX = 4000;
const COMMENT_BODY_LENGTH_ERROR = `本文は${COMMENT_BODY_MAX}文字以内にしてください。`;

/** Pure list helpers — kept free of Http / component state (SRP). */
export function appendComment(list: ItemComment[], created: ItemComment): ItemComment[] {
  return [...list, created];
}

export function replaceComment(list: ItemComment[], updated: ItemComment): ItemComment[] {
  return list.map((row) => (row.id === updated.id ? updated : row));
}

export function removeComment(list: ItemComment[], id: number): ItemComment[] {
  return list.filter((row) => row.id !== id);
}

export function displayCommentAuthor(author: string): string {
  return author.trim() ? author : '（無名）';
}

/** Mirrors backend canModifyComment for UI affordances (authoritative check is server-side). */
export function canModifyCommentForUser(
  c: ItemComment,
  user: { id: number; role: string } | null,
  readOnly: boolean,
): boolean {
  if (readOnly || !user) return false;
  if (user.role === 'admin') return true;
  if (c.createdByUserId == null || c.createdByUserId <= 0) return false;
  return c.createdByUserId === user.id;
}

/** DnD 参照挿入の純粋結果（I/O・signal 更新は呼び出し側）。 */
export type AttachmentRefInsertResult =
  | { kind: 'noop' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; text: string };

/**
 * MIME 有無〜decode〜所属検証〜markup 挿入までを副作用なしで計算する。
 * DataTransfer / DOM selection / signal は呼び出し側が渡す・適用する。
 */
export function resolveAttachmentRefInsert(input: {
  hasMime: boolean;
  rawPayload: string;
  itemNumber: number;
  body: string;
  start: number;
  end: number;
  maxLen?: number;
}): AttachmentRefInsertResult {
  if (!input.hasMime) return { kind: 'noop' };
  const payload = decodeAttachmentDragPayload(input.rawPayload);
  if (!payload || !attachmentDragBelongsToItem(payload, input.itemNumber)) {
    return { kind: 'error', message: '画像の参照を挿入できませんでした。' };
  }
  const markup = buildAttachmentMarkup(input.itemNumber, payload.attachmentId, payload.alt);
  const maxLen = input.maxLen ?? COMMENT_BODY_MAX;
  const inserted = insertMarkupAt(input.body, input.start, input.end, markup, maxLen);
  if (!inserted) {
    return { kind: 'error', message: `本文は${maxLen}文字以内にしてください。` };
  }
  return { kind: 'ok', text: inserted.text };
}

@Component({
  selector: 'app-item-comments',
  imports: [DatePipe, FormsModule, DescriptionRichText],
  templateUrl: './item-comments.html',
  styleUrl: './item-comments.css',
})
export class ItemComments implements OnChanges {
  @Input({ required: true }) number = 0;
  @Input() projectId?: number;
  /** 編集権限が無いとき投稿・編集・削除を止める。 */
  @Input() readOnly = false;
  private readonly api = inject(Api);
  private readonly authSession = inject(AuthSession);
  private readonly destroyRef = inject(DestroyRef);
  private readonly draftImage = viewChild<ElementRef<HTMLInputElement>>('draftImage');
  private readonly editBodyArea = viewChild<ElementRef<HTMLTextAreaElement>>('editBodyArea');
  private listRequest?: Subscription;
  private mutationRequest?: Subscription;
  private generation = 0;
  private uploadGuard = false;
  private deleteGuard = false;
  private insertGuard = false;
  readonly comments = signal<ItemComment[]>([]);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly posting = signal(false);
  readonly savingId = signal<number | null>(null);
  readonly deletingId = signal<number | null>(null);
  readonly editingId = signal<number | null>(null);
  readonly draftBody = signal('');
  readonly editBody = signal('');
  readonly actionError = signal('');
  readonly imageAccept = ATTACHMENT_IMAGE_ACCEPT;
  readonly imageBusy = signal(false);
  readonly confirmAttachmentId = signal<number | null>(null);

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.generation++;
      this.listRequest?.unsubscribe();
      this.mutationRequest?.unsubscribe();
      this.clearMutationBusy();
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['number'] || changes['projectId']) {
      this.listRequest?.unsubscribe();
      this.mutationRequest?.unsubscribe();
      this.clearMutationBusy();
      this.editingId.set(null);
      this.actionError.set('');
      this.comments.set([]);
      this.load();
    }
  }

  displayName(author: string) {
    return displayCommentAuthor(author);
  }

  canModifyComment(c: ItemComment): boolean {
    return canModifyCommentForUser(c, this.authSession.user(), this.readOnly);
  }

  submit() {
    if (this.posting() || this.savingId() != null || this.deletingId() != null || this.number <= 0) {
      return;
    }
    const body = this.draftBody().trim();
    if (!body) {
      this.actionError.set('本文を入力してください。');
      return;
    }
    const generation = this.generation;
    const number = this.number;
    const projectId = this.scopedProjectId();
    this.posting.set(true);
    this.actionError.set('');
    this.mutationRequest?.unsubscribe();
    this.mutationRequest = this.api.createComment(number, { body }, projectId).subscribe({
      next: (created) => {
        if (!this.stillCurrent(generation, number, projectId)) return;
        this.comments.update((list) => appendComment(list, created));
        this.draftBody.set('');
      },
      error: () => {
        if (!this.stillCurrent(generation, number, projectId)) return;
        this.actionError.set('コメントを投稿できませんでした。');
        this.posting.set(false);
      },
      complete: () => {
        if (this.stillCurrent(generation, number, projectId)) this.posting.set(false);
      },
    });
  }

  startEdit(c: ItemComment) {
    if (this.savingId() != null || this.deletingId() != null) return;
    this.editingId.set(c.id);
    this.editBody.set(c.body);
    this.actionError.set('');
  }

  cancelEdit() {
    this.editingId.set(null);
    this.actionError.set('');
  }

  saveEdit(c: ItemComment) {
    if (this.savingId() != null || this.number <= 0) return;
    const body = this.editBody().trim();
    if (!body) {
      this.actionError.set('本文を入力してください。');
      return;
    }
    const generation = this.generation;
    const number = this.number;
    const projectId = this.scopedProjectId();
    const previous = c;
    this.savingId.set(c.id);
    this.actionError.set('');
    this.mutationRequest?.unsubscribe();
    this.mutationRequest = this.api
      .updateComment(number, c.id, { body }, projectId)
      .subscribe({
        next: (updated) => {
          if (!this.stillCurrent(generation, number, projectId)) return;
          this.comments.update((list) => replaceComment(list, updated));
          this.editingId.set(null);
        },
        error: () => {
          if (!this.stillCurrent(generation, number, projectId)) return;
          this.comments.update((list) => replaceComment(list, previous));
          this.actionError.set('コメントを保存できませんでした。');
          this.savingId.set(null);
        },
        complete: () => {
          if (this.stillCurrent(generation, number, projectId)) this.savingId.set(null);
        },
      });
  }

  remove(c: ItemComment) {
    if (this.deletingId() != null || this.number <= 0) return;
    if (!window.confirm('このコメントを削除しますか？')) return;
    const generation = this.generation;
    const number = this.number;
    const projectId = this.scopedProjectId();
    this.deletingId.set(c.id);
    this.actionError.set('');
    this.mutationRequest?.unsubscribe();
    this.mutationRequest = this.api.deleteComment(number, c.id, projectId).subscribe({
      next: () => {
        if (!this.stillCurrent(generation, number, projectId)) return;
        this.comments.update((list) => removeComment(list, c.id));
      },
      error: () => {
        if (!this.stillCurrent(generation, number, projectId)) return;
        this.actionError.set('コメントを削除できませんでした。');
        this.deletingId.set(null);
      },
      complete: () => {
        if (this.stillCurrent(generation, number, projectId)) this.deletingId.set(null);
      },
    });
  }

  retry() {
    if (!this.loading()) this.load();
  }

  pickDraftImage(): void {
    if (this.readOnly || this.imageBusy() || this.uploadGuard || this.posting()) return;
    this.draftImage()?.nativeElement.click();
  }

  onDraftImageChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) this.uploadDraftImages(files);
  }

  onCommentDragOver(event: DragEvent): void {
    if (this.readOnly) return;
    event.preventDefault();
  }

  onDraftDrop(event: DragEvent): void {
    if (this.readOnly) return;
    event.preventDefault();
    const dt = event.dataTransfer;
    if (!dt) return;
    // MIME あり → 参照挿入のみ。無し → 従来どおりファイル upload（責務を分ける）。
    if (dataTransferHasAttachmentMime(dt.types)) {
      this.tryInsertAttachmentRefFromDataTransfer(dt, 'draft');
      return;
    }
    const files = filesFromDataTransfer(dt);
    if (files.length) this.uploadDraftImages(files);
  }

  onEditDrop(event: DragEvent): void {
    if (this.readOnly) return;
    event.preventDefault();
    const dt = event.dataTransfer;
    if (!dt) return;
    this.tryInsertAttachmentRefFromDataTransfer(dt, 'edit');
  }

  /** 下書きへの貼り付け: 画像はアップロードしてキャレットの位置へ、選択への URL はリンクにする。 */
  onDraftPaste(event: ClipboardEvent): void {
    if (this.readOnly) return;
    const dt = event.clipboardData;
    if (!dt) return;
    const el = event.target as HTMLTextAreaElement;
    const start = el.selectionStart ?? this.draftBody().length;
    const end = el.selectionEnd ?? start;
    const files = clipboardFilesToAttach(dt);
    if (files.length) {
      event.preventDefault();
      this.uploadDraftImages(files, { start, end });
      return;
    }
    this.pasteLink(event, el, 'draft');
  }

  /** 編集中のコメントへの貼り付け: 選択への URL をリンクにする（画像のアップロードはしない）。 */
  onEditPaste(event: ClipboardEvent): void {
    if (this.readOnly) return;
    this.pasteLink(event, event.target as HTMLTextAreaElement, 'edit');
  }

  private pasteLink(event: ClipboardEvent, el: HTMLTextAreaElement, target: 'draft' | 'edit'): void {
    const dt = event.clipboardData;
    if (!dt) return;
    const body = target === 'draft' ? this.draftBody() : this.editBody();
    // ngModel が反映する前の入力とずれていたら、位置が合わないので通常の貼り付けに任せる。
    if (el.value !== body) return;
    const result = pasteLinkOverSelection(
      body,
      el.selectionStart ?? 0,
      el.selectionEnd ?? 0,
      dt.getData('text/plain').trim(),
      COMMENT_BODY_MAX,
    );
    if (result.kind === 'default') return;
    event.preventDefault();
    if (result.kind === 'error') {
      this.actionError.set(COMMENT_BODY_LENGTH_ERROR);
      return;
    }
    this.actionError.set('');
    if (target === 'draft') {
      this.draftBody.set(result.text);
    } else {
      this.editBody.set(result.text);
    }
    // ngModel の反映（マイクロタスク）の後でキャレットをリンクの直後へ戻す。
    setTimeout(() => {
      if (el.isConnected && el.value === result.text) {
        el.setSelectionRange(result.caret, result.caret);
      }
    });
  }

  /**
   * 画像を 1 件ずつ順にアップロードし、成功するたびに下書きへ入れる。
   * `at` が無ければ末尾へ（ボタン・ドロップ）、あればその位置へ（貼り付け）。
   */
  uploadDraftImages(files: readonly File[], at?: { start: number; end: number }): void {
    // 投稿の応答を待つ間に入れると、投稿の成功で空になった下書きへ画像だけが入る。
    if (this.readOnly || this.posting() || this.number <= 0) return;
    if (this.imageBusy() || this.uploadGuard) {
      // 黙って捨てない（アップロード・削除のどちらの間でも伝える）。
      this.actionError.set(ATTACHMENT_IMAGE_BUSY_HINT);
      return;
    }
    const plan = planImageUpload(files);
    if (!plan.accepted.length) {
      this.actionError.set(imageUploadPlanNotice(plan));
      return;
    }
    this.uploadGuard = true;
    this.imageBusy.set(true);
    this.actionError.set('');
    const number = this.number;
    const projectId = this.scopedProjectId();
    const generation = this.generation;
    let caret = at;
    let stopError = '';
    uploadImagesInOrder({
      files: plan.accepted,
      upload: (file) => this.api.uploadAttachment(number, file, 'comment', projectId),
      onUploaded: (att, file) => {
        // 待っている間にアイテムが切り替わった・再読み込みされたら、下書きには入れない。
        if (!this.stillCurrent(generation, number, projectId)) return 'stop';
        const body = this.draftBody();
        const markup = buildAttachmentMarkup(number, att.id, att.originalName || file.name);
        const inserted = insertMarkupAt(
          body,
          caret?.start ?? body.length,
          caret?.end ?? body.length,
          markup,
          COMMENT_BODY_MAX,
        );
        if (!inserted) {
          stopError = COMMENT_BODY_LENGTH_ERROR;
          return 'stop';
        }
        this.draftBody.set(inserted.text);
        if (caret) caret = { start: inserted.caret, end: inserted.caret };
        return 'continue';
      },
      onDone: (outcome) => {
        // 忙しい状態は、切り替えの後でも必ず解く。文言は今のアイテムのものだけ出す。
        this.uploadGuard = false;
        this.imageBusy.set(false);
        if (!this.stillCurrent(generation, number, projectId)) return;
        this.actionError.set(imageUploadDoneMessage(outcome, plan, stopError));
      },
    });
  }

  deleteAttachment(attachmentId: number): void {
    if (this.readOnly || this.deleteGuard || this.imageBusy() || this.confirmAttachmentId() != null) {
      return;
    }
    this.confirmAttachmentId.set(attachmentId);
  }

  cancelAttachmentDelete(): void {
    this.confirmAttachmentId.set(null);
  }

  confirmAttachmentDelete(event?: MouseEvent | KeyboardEvent): void {
    if (event instanceof MouseEvent && event.detail > 1) return;
    if (event instanceof KeyboardEvent && event.repeat) return;
    const id = this.confirmAttachmentId();
    if (id == null || this.deleteGuard || this.imageBusy() || this.number <= 0) return;
    this.deleteGuard = true;
    this.imageBusy.set(true);
    const generation = this.generation;
    const number = this.number;
    const projectId = this.scopedProjectId();
    this.api.deleteAttachment(number, id, projectId).subscribe({
      next: () => {
        if (!this.stillCurrent(generation, number, projectId)) return;
        this.deleteGuard = false;
        this.imageBusy.set(false);
        this.confirmAttachmentId.set(null);
        this.load();
      },
      error: () => {
        if (!this.stillCurrent(generation, number, projectId)) return;
        this.deleteGuard = false;
        this.imageBusy.set(false);
        this.confirmAttachmentId.set(null);
        this.actionError.set('画像の削除に失敗しました。');
      },
    });
  }

  /** draft/edit 共通: DataTransfer／selection を集め、純粋結果を signal へ適用（upload はしない）。 */
  tryInsertAttachmentRefFromDataTransfer(
    dt: DataTransfer,
    target: 'draft' | 'edit',
    range?: { start: number; end: number },
  ): void {
    if (this.readOnly || this.imageBusy() || this.number <= 0) return;
    if (this.insertGuard) return;

    const body = target === 'draft' ? this.draftBody() : this.editBody();
    let start = body.length;
    let end = body.length;
    if (target === 'edit') {
      if (range) {
        start = range.start;
        end = range.end;
      } else {
        const el = this.editBodyArea()?.nativeElement;
        // 未フォーカス時 selectionStart は 0 になりがちなので、キャレット無し＝末尾（設計どおり）
        if (el && document.activeElement === el) {
          start = el.selectionStart ?? body.length;
          end = el.selectionEnd ?? start;
        }
      }
    }

    const result = resolveAttachmentRefInsert({
      hasMime: dataTransferHasAttachmentMime(dt.types),
      rawPayload: dt.getData(SCRUM_ATTACHMENT_MIME),
      itemNumber: this.number,
      body,
      start,
      end,
    });
    if (result.kind === 'noop') return;
    if (result.kind === 'error') {
      this.actionError.set(result.message);
      return;
    }

    this.insertGuard = true;
    this.actionError.set('');
    if (target === 'draft') {
      this.draftBody.set(result.text);
    } else {
      this.editBody.set(result.text);
    }
    queueMicrotask(() => {
      this.insertGuard = false;
    });
  }

  reload() {
    this.load();
  }

  private load() {
    if (this.number <= 0) return;
    this.listRequest?.unsubscribe();
    const generation = ++this.generation;
    const number = this.number;
    const projectId = this.scopedProjectId();
    this.loading.set(true);
    this.error.set(false);
    this.listRequest = this.api.listComments(number, projectId).subscribe({
      next: (list) => {
        if (!this.stillCurrent(generation, number, projectId)) return;
        this.comments.set(list);
      },
      error: () => {
        if (!this.stillCurrent(generation, number, projectId)) return;
        this.error.set(true);
        this.loading.set(false);
      },
      complete: () => {
        if (this.stillCurrent(generation, number, projectId)) this.loading.set(false);
      },
    });
  }

  private scopedProjectId() {
    return this.projectId && this.projectId > 0 ? this.projectId : undefined;
  }

  private stillCurrent(generation: number, number: number, projectId: number | undefined) {
    if (generation !== this.generation) return false;
    if (this.number !== number) return false;
    const current = this.scopedProjectId();
    return current === projectId;
  }

  private clearMutationBusy() {
    this.posting.set(false);
    this.savingId.set(null);
    this.deletingId.set(null);
  }
}
