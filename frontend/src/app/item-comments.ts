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
import { buildAttachmentMarkup, insertMarkupAt } from './description-link';
import { DescriptionRichText } from './description-rich-text';
import { ItemComment } from './models';

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const COMMENT_BODY_MAX = 4000;

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
  private readonly destroyRef = inject(DestroyRef);
  private readonly draftImage = viewChild<ElementRef<HTMLInputElement>>('draftImage');
  private listRequest?: Subscription;
  private mutationRequest?: Subscription;
  private generation = 0;
  private uploadGuard = false;
  private deleteGuard = false;
  readonly comments = signal<ItemComment[]>([]);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly posting = signal(false);
  readonly savingId = signal<number | null>(null);
  readonly deletingId = signal<number | null>(null);
  readonly editingId = signal<number | null>(null);
  readonly draftAuthor = signal('');
  readonly draftBody = signal('');
  readonly editAuthor = signal('');
  readonly editBody = signal('');
  readonly actionError = signal('');
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

  submit() {
    if (this.posting() || this.savingId() != null || this.deletingId() != null || this.number <= 0) {
      return;
    }
    const body = this.draftBody().trim();
    if (!body) {
      this.actionError.set('本文を入力してください。');
      return;
    }
    const author = this.draftAuthor().trim();
    const generation = this.generation;
    const number = this.number;
    const projectId = this.scopedProjectId();
    this.posting.set(true);
    this.actionError.set('');
    this.mutationRequest?.unsubscribe();
    this.mutationRequest = this.api.createComment(number, { author, body }, projectId).subscribe({
      next: (created) => {
        if (!this.stillCurrent(generation, number, projectId)) return;
        this.comments.update((list) => appendComment(list, created));
        this.draftAuthor.set('');
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
    this.editAuthor.set(c.author);
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
    const author = this.editAuthor().trim();
    const generation = this.generation;
    const number = this.number;
    const projectId = this.scopedProjectId();
    const previous = c;
    this.savingId.set(c.id);
    this.actionError.set('');
    this.mutationRequest?.unsubscribe();
    this.mutationRequest = this.api
      .updateComment(number, c.id, { author, body }, projectId)
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
    const file = input.files?.[0];
    input.value = '';
    if (file) this.uploadDraftImage(file);
  }

  onDraftDragOver(event: DragEvent): void {
    if (this.readOnly) return;
    event.preventDefault();
  }

  onDraftDrop(event: DragEvent): void {
    if (this.readOnly) return;
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) this.uploadDraftImage(file);
  }

  uploadDraftImage(file: File): void {
    if (this.readOnly || this.imageBusy() || this.uploadGuard || this.number <= 0) return;
    if (!ALLOWED_IMAGE_TYPES.has(file.type) || file.size <= 0 || file.size > 5 * 1024 * 1024) {
      this.actionError.set('JPEG / PNG / GIF / WebP（5MiB以下）を選んでください。');
      return;
    }
    this.uploadGuard = true;
    this.imageBusy.set(true);
    this.actionError.set('');
    const number = this.number;
    const projectId = this.scopedProjectId();
    const generation = this.generation;
    this.api.uploadAttachment(number, file, 'comment', projectId).subscribe({
      next: (att) => {
        if (!this.stillCurrent(generation, number, projectId)) return;
        this.uploadGuard = false;
        this.imageBusy.set(false);
        const markup = buildAttachmentMarkup(number, att.id, att.originalName || file.name);
        const inserted = insertMarkupAt(this.draftBody(), this.draftBody().length, this.draftBody().length, markup, COMMENT_BODY_MAX);
        if (!inserted) {
          this.actionError.set('本文は4000文字以内にしてください。');
          return;
        }
        this.draftBody.set(inserted.text);
      },
      error: () => {
        if (!this.stillCurrent(generation, number, projectId)) return;
        this.uploadGuard = false;
        this.imageBusy.set(false);
        this.actionError.set('画像のアップロードに失敗しました。');
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
