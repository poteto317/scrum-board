import { Component, OnChanges, SimpleChanges, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { Api, AIChatMessage, AICredits } from './api';
import { errorMessage } from './api-error';
import {
  blockedReason,
  isComposeBlocked,
  isLowRemaining,
} from './ai-credits-state';
import {
  AI_EXHAUSTED_MESSAGE,
  AI_LOW_REMAINING_MESSAGE,
  AI_UNCONFIGURED_MESSAGE,
} from './ai-unavailable-copy';
import { COMMENT_BODY_MAX } from './item-comments';
import { Item } from './models';

export const AI_CHAT_MESSAGE_MAX = 4000;

@Component({
  selector: 'app-item-ai-chat',
  imports: [FormsModule, RouterLink],
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
  private creditsRequest?: Subscription;
  private sendRequest?: Subscription;
  private clearRequest?: Subscription;
  private applyRequest?: Subscription;

  readonly messages = signal<AIChatMessage[]>([]);
  readonly draft = signal('');
  readonly loading = signal(false);
  readonly credits = signal<AICredits | null>(null);
  readonly creditsLoading = signal(false);
  readonly sending = signal(false);
  readonly clearing = signal(false);
  readonly applying = signal(false);
  readonly error = signal('');
  readonly loadError = signal('');

  readonly composeBlocked = computed(() => isComposeBlocked(this.credits()));
  readonly lowRemaining = computed(() => isLowRemaining(this.credits()));
  readonly blockReason = computed(() => blockedReason(this.credits()));
  readonly composeInactive = computed(
    () => this.sending() || this.applying() || this.creditsLoading() || this.composeBlocked(),
  );
  readonly blockedMessage = computed(() => {
    const reason = this.blockReason();
    if (reason === 'unconfigured') return AI_UNCONFIGURED_MESSAGE;
    if (reason === 'exhausted') return AI_EXHAUSTED_MESSAGE;
    return '';
  });

  readonly lowRemainingMessage = AI_LOW_REMAINING_MESSAGE;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['number'] || changes['projectId'] || changes['itemId']) {
      this.draft.set('');
      this.error.set('');
      this.loadError.set('');
      this.reload();
    }
  }

  reload() {
    const generation = ++this.generation;
    this.loadHistory(generation);
    this.loadCredits(generation);
  }

  private loadHistory(generation: number) {
    this.listRequest?.unsubscribe();
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

  /** Workspace credits（アイテム非依存）。generation でアイテム切替の stale を捨てる */
  private loadCredits(generation: number) {
    this.creditsRequest?.unsubscribe();
    const number = this.number();
    const projectId = this.scopedProjectId();
    this.creditsLoading.set(true);
    this.credits.set(null);
    this.creditsRequest = this.api.getAICredits().subscribe({
      next: (view) => {
        if (!this.stillCurrent(generation, number, projectId)) return;
        this.credits.set(view);
        this.creditsLoading.set(false);
      },
      error: () => {
        if (!this.stillCurrent(generation, number, projectId)) return;
        this.credits.set(null);
        this.creditsLoading.set(false);
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
    if (this.composeInactive()) return;
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
