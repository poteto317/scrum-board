import {
  Component,
  DestroyRef,
  OnChanges,
  SimpleChanges,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { isSameItem, type AiChatFocusItem } from './ai-chat-target';
import { Api, AICredits, ProjectAIMessage } from './api';
import { errorMessage } from './api-error';
import { AuthSession } from './auth-session';
import { blockedReason, isComposeBlocked, isLowRemaining } from './ai-credits-state';
import { AI_LOW_REMAINING_MESSAGE } from './ai-unavailable-copy';
import { Item } from './models';
import {
  PROJECT_AI_CHAT_CLEAR_CONFIRM,
  PROJECT_AI_CHAT_EMPTY_MESSAGE,
  PROJECT_AI_CHAT_SENDING_MESSAGE,
  applyCommentConfirm,
  applyDescriptionConfirm,
} from './project-ai-chat-copy';
import {
  blockedReasonMessage,
  checkDraft,
  commentApplyError,
  isSendKey,
  sameChatScope,
  type ChatScope,
} from './project-ai-chat-rules';

@Component({
  selector: 'app-project-ai-chat',
  imports: [FormsModule, RouterLink],
  templateUrl: './project-ai-chat.html',
  styleUrl: './project-ai-chat.css',
})
export class ProjectAiChat implements OnChanges {
  readonly projectId = input.required<number>();
  /** 開いているアイテム（アイテム詳細だけ）。送信の文脈と、反映の対象になる */
  readonly focusItem = input<AiChatFocusItem | null>(null);
  /** fab=従来の高さ制限、dock/page=一覧を伸ばす */
  readonly layout = input<'fab' | 'dock' | 'page'>('fab');
  readonly descriptionApplied = output<Item>();
  readonly commentApplied = output<void>();

  private readonly api = inject(Api);
  private readonly auth = inject(AuthSession);
  private generation = 0;
  private userId = this.currentUserId();
  private listRequest?: Subscription;
  private creditsRequest?: Subscription;
  private sendRequest?: Subscription;
  private clearRequest?: Subscription;
  private applyRequest?: Subscription;

  readonly messages = signal<ProjectAIMessage[]>([]);
  readonly draft = signal('');
  readonly loading = signal(false);
  readonly credits = signal<AICredits | null>(null);
  readonly creditsLoading = signal(false);
  readonly sending = signal(false);
  readonly clearing = signal(false);
  readonly applying = signal(false);
  readonly error = signal('');
  readonly loadError = signal('');

  readonly canApply = computed(
    () => this.layout() !== 'page' && this.focusItem()?.canEdit === true,
  );
  readonly composeBlocked = computed(() => isComposeBlocked(this.credits()));
  readonly lowRemaining = computed(() => isLowRemaining(this.credits()));
  readonly blockReason = computed(() => blockedReason(this.credits()));
  readonly composeInactive = computed(
    () => this.sending() || this.applying() || this.creditsLoading() || this.composeBlocked(),
  );
  readonly blockedMessage = computed(() => blockedReasonMessage(this.blockReason()));

  readonly lowRemainingMessage = AI_LOW_REMAINING_MESSAGE;
  readonly emptyMessage = PROJECT_AI_CHAT_EMPTY_MESSAGE;
  readonly sendingMessage = PROJECT_AI_CHAT_SENDING_MESSAGE;

  constructor() {
    // 履歴はユーザーごと。ユーザーが変わったら、前のユーザーの履歴と応答を出さない
    effect(() => {
      const userId = this.currentUserId();
      if (userId === this.userId) return;
      this.userId = userId;
      untracked(() => this.resetScope());
    });
    inject(DestroyRef).onDestroy(() => {
      this.cancelScopedRequests();
      this.applyRequest?.unsubscribe();
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['projectId']) this.resetScope();
    const focus = changes['focusItem'];
    if (focus && !focus.firstChange && !isSameItem(focus.previousValue, focus.currentValue)) {
      // 反映の応答は別のアイテムのものになったので捨てる（履歴はプロジェクトのものなので残す）
      this.applying.set(false);
    }
  }

  reload() {
    const scope = this.scope(++this.generation);
    this.loadHistory(scope);
    this.loadCredits(scope);
  }

  /** projectId かユーザーが変わった: 進行中の応答を捨て、空にして読み直す */
  private resetScope() {
    this.cancelScopedRequests();
    this.messages.set([]);
    this.draft.set('');
    this.error.set('');
    this.loadError.set('');
    this.loading.set(false);
    this.sending.set(false);
    this.clearing.set(false);
    this.credits.set(null);
    this.creditsLoading.set(false);
    if (this.currentUserId() == null) {
      // ログアウト後は誰の履歴でもないので読まない
      this.generation++;
      return;
    }
    this.reload();
  }

  private cancelScopedRequests() {
    this.listRequest?.unsubscribe();
    this.creditsRequest?.unsubscribe();
    this.sendRequest?.unsubscribe();
    this.clearRequest?.unsubscribe();
  }

  private loadHistory(scope: ChatScope) {
    this.listRequest?.unsubscribe();
    this.loading.set(true);
    this.loadError.set('');
    this.listRequest = this.api.listProjectAIChat(scope.projectId).subscribe({
      next: (messages) => {
        if (!this.stillCurrent(scope)) return;
        this.messages.set(messages);
        this.loading.set(false);
      },
      error: (err) => {
        if (!this.stillCurrent(scope)) return;
        this.loadError.set(errorMessage(err));
        this.loading.set(false);
      },
    });
  }

  /** Workspace credits（プロジェクト非依存）。読み直しのたびに取り直す */
  private loadCredits(scope: ChatScope) {
    this.creditsRequest?.unsubscribe();
    this.creditsLoading.set(true);
    this.credits.set(null);
    this.creditsRequest = this.api.getAICredits().subscribe({
      next: (view) => {
        if (!this.stillCurrent(scope)) return;
        this.credits.set(view);
        this.creditsLoading.set(false);
      },
      error: () => {
        if (!this.stillCurrent(scope)) return;
        this.credits.set(null);
        this.creditsLoading.set(false);
      },
    });
  }

  onComposeKeydown(event: Event) {
    const e = event as KeyboardEvent;
    if (!isSendKey(e)) return;
    e.preventDefault();
    this.send(e);
  }

  send(event?: Event) {
    if (event instanceof KeyboardEvent && event.repeat) return;
    if (this.composeInactive()) return;
    const draft = checkDraft(this.draft());
    if (!draft.ok) {
      this.error.set(draft.error);
      return;
    }
    const text = draft.text;
    this.sendRequest?.unsubscribe();
    const scope = this.scope();
    this.sending.set(true);
    this.error.set('');
    // 送信中に別のアイテムへ移っても、同じプロジェクトなら回答は表示する（focusItem は比べない）
    this.sendRequest = this.api
      .postProjectAIChat(scope.projectId, text, this.focusItem()?.number)
      .subscribe({
        next: (res) => {
          if (!this.stillCurrent(scope)) return;
          this.messages.set(res.messages);
          this.draft.set('');
          this.sending.set(false);
        },
        error: (err) => {
          if (!this.stillCurrent(scope)) return;
          this.error.set(errorMessage(err));
          this.sending.set(false);
        },
      });
  }

  clear() {
    if (this.clearing() || this.sending()) return;
    if (!window.confirm(PROJECT_AI_CHAT_CLEAR_CONFIRM)) return;
    this.clearRequest?.unsubscribe();
    const scope = this.scope();
    this.clearing.set(true);
    this.error.set('');
    this.clearRequest = this.api.clearProjectAIChat(scope.projectId).subscribe({
      next: () => {
        if (!this.stillCurrent(scope)) return;
        this.messages.set([]);
        this.clearing.set(false);
      },
      error: (err) => {
        if (!this.stillCurrent(scope)) return;
        this.error.set(errorMessage(err));
        this.clearing.set(false);
      },
    });
  }

  applyToDescription(body: string) {
    const focus = this.applyTarget();
    if (!focus) return;
    if (!window.confirm(applyDescriptionConfirm(focus))) return;
    this.startApply();
    this.applyRequest = this.api.updateItem(focus.itemId, { description: body }).subscribe({
      next: (item) => {
        if (!this.stillFocused(focus)) return;
        this.descriptionApplied.emit(item);
        this.applying.set(false);
      },
      error: (err) => this.failApply(focus, err),
    });
  }

  applyAsComment(body: string) {
    const focus = this.applyTarget();
    if (!focus) return;
    const tooLong = commentApplyError(body);
    if (tooLong) {
      this.error.set(tooLong);
      return;
    }
    if (!window.confirm(applyCommentConfirm(focus))) return;
    this.startApply();
    this.applyRequest = this.api
      .createComment(focus.number, { body }, this.projectId())
      .subscribe({
        next: () => {
          if (!this.stillFocused(focus)) return;
          this.commentApplied.emit();
          this.applying.set(false);
        },
        error: (err) => this.failApply(focus, err),
      });
  }

  /** 反映できる対象（開いていて編集できるアイテム）。無ければ null */
  private applyTarget(): AiChatFocusItem | null {
    if (this.applying() || this.sending()) return null;
    const focus = this.focusItem();
    return focus?.canEdit ? focus : null;
  }

  private startApply() {
    this.applyRequest?.unsubscribe();
    this.applying.set(true);
    this.error.set('');
  }

  private failApply(focus: AiChatFocusItem, err: unknown) {
    if (!this.stillFocused(focus)) return;
    this.error.set(errorMessage(err));
    this.applying.set(false);
  }

  /** 押したときのアイテムがまだ開いているか */
  private stillFocused(focus: AiChatFocusItem) {
    return isSameItem(this.focusItem(), focus);
  }

  private currentUserId(): number | null {
    return this.auth.user()?.id ?? null;
  }

  private scope(generation = this.generation): ChatScope {
    return { generation, projectId: this.projectId(), userId: this.currentUserId() };
  }

  private stillCurrent(scope: ChatScope) {
    return sameChatScope(scope, this.scope());
  }
}
