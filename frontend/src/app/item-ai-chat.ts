import { Component, OnChanges, SimpleChanges, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, AIChatMessage } from './api';
import { errorMessage } from './api-error';
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

  readonly messages = signal<AIChatMessage[]>([]);
  readonly draft = signal('');
  readonly loading = signal(false);
  readonly sending = signal(false);
  readonly clearing = signal(false);
  readonly applying = signal(false);
  readonly error = signal('');
  readonly loadError = signal('');

  ngOnChanges(changes: SimpleChanges) {
    if (changes['number'] || changes['projectId']) {
      this.reload();
    }
  }

  reload() {
    this.loading.set(true);
    this.loadError.set('');
    this.api.listAIChat(this.number(), this.projectId()).subscribe({
      next: (messages) => {
        this.messages.set(messages);
        this.loading.set(false);
      },
      error: (err) => {
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
    this.sending.set(true);
    this.error.set('');
    this.api.postAIChat(this.number(), text, this.projectId()).subscribe({
      next: (res) => {
        this.messages.set(res.messages);
        this.draft.set('');
        this.sending.set(false);
      },
      error: (err) => {
        this.error.set(errorMessage(err));
        this.sending.set(false);
      },
    });
  }

  clear() {
    if (this.clearing() || this.sending()) return;
    if (!window.confirm('このアイテムの AI チャット履歴を削除しますか？')) return;
    this.clearing.set(true);
    this.error.set('');
    this.api.clearAIChat(this.number(), this.projectId()).subscribe({
      next: () => {
        this.messages.set([]);
        this.clearing.set(false);
      },
      error: (err) => {
        this.error.set(errorMessage(err));
        this.clearing.set(false);
      },
    });
  }

  applyToDescription(body: string) {
    if (this.applying() || this.sending()) return;
    if (!window.confirm('説明をこの内容で置き換えますか？')) return;
    this.applying.set(true);
    this.error.set('');
    this.api.updateItem(this.itemId(), { description: body }).subscribe({
      next: (item) => {
        this.descriptionApplied.emit(item);
        this.applying.set(false);
      },
      error: (err) => {
        this.error.set(errorMessage(err));
        this.applying.set(false);
      },
    });
  }

  applyAsComment(body: string) {
    if (this.applying() || this.sending()) return;
    if (!window.confirm('この内容をコメントとして追加しますか？')) return;
    this.applying.set(true);
    this.error.set('');
    this.api.createComment(this.number(), { body }, this.projectId()).subscribe({
      next: () => {
        this.commentApplied.emit();
        this.applying.set(false);
      },
      error: (err) => {
        this.error.set(errorMessage(err));
        this.applying.set(false);
      },
    });
  }
}
