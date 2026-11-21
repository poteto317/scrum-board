import { Component, OnChanges, SimpleChanges, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { Api, AIChatMessage } from './api';
import { errorMessage } from './api-error';
import { COMMENT_BODY_MAX } from './item-comments';
import { Item } from './models';

export const AI_CHAT_MESSAGE_MAX = 4000;

@Component({
  selector: 'app-item-ai-chat',
  imports: [FormsModule],
  templateUrl: './item-ai-chat.html',
  styleUrl: './item-ai-chat.css',
})
export class ItemAiChat implements OnChanges {
  readonly number = input.required<number>();
  readonly projectId = input<number | undefined>(undefined);
  readonly itemId = input.required<number>();
  readonly descriptionApplied = output<Item>();
  readonly commentApplied = output<void>();

  private readonly api = inject(Api);
  private generation = 0;
  private listRequest?: Subscription;
  private sendRequest?: Subscription;
  private clearRequest?: Subscription;
  private applyRequest?: Subscription;

  readonly messages = signal<AIChatMessage[]>([]);
  readonly draft = signal('');
  readonly loading = signal(false);
  readonly sending = signal(false);
  readonly clearing = signal(false);
  readonly applying = signal(false);
  readonly error = signal('');
  readonly loadError = signal('');

  ngOnChanges(changes: SimpleChanges) {
    if (changes['number'] || changes['projectId'] || changes['itemId']) {
      this.draft.set('');
      this.error.set('');
      this.loadError.set('');
      this.reload();
    }
  }

  reload() {
    this.listRequest?.unsubscribe();
    const generation = ++this.generation;
    const number = this.number();
    const projectId = this.scopedProjectId();
    this.loading.set(true);
    this.loadError.set('');
    this.listRequest = this.api.listAIChat(number, projectId).subscribe({
      next: (messages) => {
        if (!this.stillCurrent(generation, number, projectId)) return;
        this.messages.set(messages);
        this.loading.set(false);
      },
      error: (err) => {
        if (!this.stillCurrent(generation, number, projectId)) return;
        this.loadError.set(errorMessage(err));
        this.loading.set(false);
      },
    });
  }

  onComposeKeydown(event: Event) {
    const e = event as KeyboardEvent;
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    this.send(e);
  }

  send(event?: Event) {
    if (event instanceof KeyboardEvent && event.repeat) return;
    if (this.sending() || this.applying()) return;
    const text = this.draft().trim();
    if (!text) {
      this.error.set('メッセージを入力してください。');
      return;
    }
    if ([...text].length > AI_CHAT_MESSAGE_MAX) {
      this.error.set(`メッセージは${AI_CHAT_MESSAGE_MAX}文字以内にしてください。`);
      return;
    }
    this.sendRequest?.unsubscribe();
    const generation = this.generation;
    const number = this.number();
    const projectId = this.scopedProjectId();
    this.sending.set(true);
    this.error.set('');
    this.sendRequest = this.api.postAIChat(number, text, projectId).subscribe({
      next: (res) => {
        if (!this.stillCurrent(generation, number, projectId)) return;
        this.messages.set(res.messages);
        this.draft.set('');
        this.sending.set(false);
      },
      error: (err) => {
        if (!this.stillCurrent(generation, number, projectId)) return;
        this.error.set(errorMessage(err));
        this.sending.set(false);
      },
    });
  }

  clear() {
    if (this.clearing() || this.sending()) return;
    if (!window.confirm('このアイテムの AI チャット履歴を削除しますか？')) return;
    this.clearRequest?.unsubscribe();
    const generation = this.generation;
    const number = this.number();
    const projectId = this.scopedProjectId();
    this.clearing.set(true);
    this.error.set('');
    this.clearRequest = this.api.clearAIChat(number, projectId).subscribe({
      next: () => {
        if (!this.stillCurrent(generation, number, projectId)) return;
        this.messages.set([]);
        this.clearing.set(false);
      },
      error: (err) => {
        if (!this.stillCurrent(generation, number, projectId)) return;
        this.error.set(errorMessage(err));
        this.clearing.set(false);
      },
    });
  }

  applyToDescription(body: string) {
    if (this.applying() || this.sending()) return;
    if (!window.confirm('説明をこの内容で置き換えますか？')) return;
    this.applyRequest?.unsubscribe();
    const generation = this.generation;
    const number = this.number();
    const projectId = this.scopedProjectId();
    const itemId = this.itemId();
    this.applying.set(true);
    this.error.set('');
    this.applyRequest = this.api.updateItem(itemId, { description: body }).subscribe({
      next: (item) => {
        if (!this.stillCurrent(generation, number, projectId) || this.itemId() !== itemId) return;
        this.descriptionApplied.emit(item);
        this.applying.set(false);
      },
      error: (err) => {
        if (!this.stillCurrent(generation, number, projectId) || this.itemId() !== itemId) return;
        this.error.set(errorMessage(err));
        this.applying.set(false);
      },
    });
  }

  applyAsComment(body: string) {
    if (this.applying() || this.sending()) return;
    if ([...body].length > COMMENT_BODY_MAX) {
      this.error.set(`コメントは${COMMENT_BODY_MAX}文字以内にしてください。長い応答は分割して追加してください。`);
      return;
    }
    if (!window.confirm('この内容をコメントとして追加しますか？')) return;
    this.applyRequest?.unsubscribe();
    const generation = this.generation;
    const number = this.number();
    const projectId = this.scopedProjectId();
    this.applying.set(true);
    this.error.set('');
    this.applyRequest = this.api.createComment(number, { body }, projectId).subscribe({
      next: () => {
        if (!this.stillCurrent(generation, number, projectId)) return;
        this.commentApplied.emit();
        this.applying.set(false);
      },
      error: (err) => {
        if (!this.stillCurrent(generation, number, projectId)) return;
        this.error.set(errorMessage(err));
        this.applying.set(false);
      },
    });
  }

  private scopedProjectId() {
    const id = this.projectId();
    return id && id > 0 ? id : undefined;
  }

  private stillCurrent(generation: number, number: number, projectId: number | undefined) {
    if (generation !== this.generation) return false;
    if (this.number() !== number) return false;
    return this.scopedProjectId() === projectId;
  }
}
