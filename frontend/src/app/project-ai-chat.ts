import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnChanges,
  SimpleChanges,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
  afterNextRender,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { isSameItem, type AiChatFocusItem } from './ai-chat-target';
import {
  Api,
  AICredits,
  ConversationRef,
  ProjectAIChatPostResponse,
  ProjectAIConversation,
  ProjectAIMessage,
  ProjectAIProposal,
} from './api';
import { errorMessage, isNotFound } from './api-error';
import { AuthSession } from './auth-session';
import { blockedReason, isComposeBlocked, isLowRemaining } from './ai-credits-state';
import { AI_LOW_REMAINING_MESSAGE } from './ai-unavailable-copy';
import { Item } from './models';
import {
  PROJECT_AI_CHAT_EMPTY_MESSAGE,
  PROJECT_AI_CHAT_SENDING_MESSAGE,
  PROJECT_AI_CONVERSATIONS_EMPTY_MESSAGE,
  PROJECT_AI_CONVERSATION_DELETE_CONFIRM,
  PROJECT_AI_CONVERSATION_GONE_ON_SEND,
  PROJECT_AI_CONVERSATION_NOT_FOUND,
  PROJECT_AI_EDIT_NEEDS_CONVERSATION,
  PROJECT_AI_NEW_CONVERSATION_LABEL,
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
import { ProjectAiConversationList } from './project-ai-conversation-list';
import { ProjectAiProposalCard } from './project-ai-proposal-card';
import { replaceProposal } from './project-ai-proposal-rules';
import {
  CONVERSATION_LIST_PINNED_QUERY,
  conversationActionsLocked,
  conversationListView,
  conversationRef,
  conversationUpdatedLabel,
  deleteConversationLabel,
  initialConversationTarget,
  isConversationGoneOnSend,
  isConversationSettled,
  removeConversation,
  sameConversation,
  storedInSentConversation,
  upsertConversationFirst,
} from './project-ai-conversations';
import { canScheduleStickScroll, isNearBottom, scrollElementToBottom } from './ai-chat-scroll';

@Component({
  selector: 'app-project-ai-chat',
  imports: [FormsModule, RouterLink, ProjectAiProposalCard],
  templateUrl: './project-ai-chat.html',
  styleUrl: './project-ai-chat.css',
})
export class ProjectAiChat implements OnChanges {
  readonly projectId = input.required<number>();
  /** 開いているアイテム（アイテム詳細だけ）。送信の文脈と、反映の対象になる */
  readonly focusItem = input<AiChatFocusItem | null>(null);
  /** fab=従来の高さ制限、dock/page=一覧を伸ばす */
  readonly layout = input<'fab' | 'dock' | 'page'>('fab');
  /** 最初の読み込みだけで使う、開く会話の指定（ID、'new'=空の新しい会話、null=いちばん新しい会話） */
  readonly initialConversationId = input<ConversationRef | null>(null);
  readonly descriptionApplied = output<Item>();
  readonly commentApplied = output<void>();
  /** 表示中の会話が変わるたび（最初の読み込みが終わってから） */
  readonly conversationChange = output<ConversationRef>();
  readonly sendingChange = output<boolean>();
  /** 提案の適用でアイテムが変わった */
  readonly itemsChanged = output<void>();

  private readonly api = inject(Api);
  private readonly injector = inject(Injector);
  private readonly auth = inject(AuthSession);
  private readonly inputRef = viewChild<ElementRef<HTMLTextAreaElement>>('messageInput');
  private readonly messageList = viewChild<ElementRef<HTMLElement>>('messageList');
  /** 最下部付近にいるときだけ自動スクロールする */
  private stickToBottom = true;
  private generation = 0;
  /** 会話の一覧（読み込みと、送信・削除の後の書き換え） */
  private readonly conversationList = new ProjectAiConversationList(this.api);
  private userId = this.currentUserId();
  /** 最初の読み込みで開く会話。読めたとき、projectId・ユーザーが変わったときに外す */
  private initialTarget: ConversationRef | null = null;
  /** conversationChange で最後に伝えた会話。まだ伝えていなければ null */
  private announced: ConversationRef | null = null;
  private shownRequest?: Subscription;
  private creditsRequest?: Subscription;
  private sendRequest?: Subscription;
  private switchRequest?: Subscription;
  private deleteRequest?: Subscription;
  private applyRequest?: Subscription;

  readonly messages = signal<ProjectAIMessage[]>([]);
  /** 表示中の会話。null は、まだ保存されていない新しい会話 */
  readonly conversationId = signal<number | null>(null);
  readonly conversations = this.conversationList.conversations.asReadonly();
  readonly listState = this.conversationList.state.asReadonly();
  readonly listError = this.conversationList.error.asReadonly();
  readonly historyOpen = signal(false);
  readonly draft = signal('');
  /** 編集中の直前 user メッセージ id。null は通常送信 */
  readonly editingFromMessageId = signal<number | null>(null);
  /** 最初の読み込み（表示する会話を決める）の途中 */
  readonly loading = signal(false);
  readonly switching = signal(false);
  readonly deleting = signal(false);
  readonly credits = signal<AICredits | null>(null);
  readonly creditsLoading = signal(false);
  readonly sending = signal(false);
  readonly applying = signal(false);
  readonly error = signal('');
  /** 最初の読み込みの失敗だけ（入力欄ごと隠す） */
  readonly loadError = signal('');
  private readonly wide = signal(false);

  readonly canApply = computed(
    () => this.layout() !== 'page' && this.focusItem()?.canEdit === true,
  );
  readonly composeBlocked = computed(() => isComposeBlocked(this.credits()));
  readonly lowRemaining = computed(() => isLowRemaining(this.credits()));
  readonly blockReason = computed(() => blockedReason(this.credits()));
  /** 表示中の会話が決まっているか（決まるまでは送れない） */
  readonly settled = computed(() =>
    isConversationSettled({
      loading: this.loading(),
      loadFailed: this.loadError() !== '',
      switching: this.switching(),
    }),
  );
  readonly composeInactive = computed(
    () =>
      !this.settled() ||
      this.sending() ||
      this.deleting() ||
      this.applying() ||
      this.creditsLoading() ||
      this.composeBlocked(),
  );
  readonly actionsLocked = computed(() =>
    conversationActionsLocked({
      settled: this.settled(),
      sending: this.sending(),
      deleting: this.deleting(),
    }),
  );
  readonly listView = computed(() =>
    conversationListView({
      layout: this.layout(),
      wide: this.wide(),
      historyOpen: this.historyOpen(),
    }),
  );
  readonly blockedMessage = computed(() => blockedReasonMessage(this.blockReason()));
  /** 編集できる直前の user メッセージ（表示条件を満たすときだけ） */
  readonly lastEditableUserMessage = computed(() => {
    if (!this.settled() || this.composeInactive()) return null;
    const msgs = this.messages();
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') return msgs[i];
    }
    return null;
  });
  readonly editing = computed(() => this.editingFromMessageId() != null);

  readonly lowRemainingMessage = AI_LOW_REMAINING_MESSAGE;
  readonly emptyMessage = PROJECT_AI_CHAT_EMPTY_MESSAGE;
  readonly sendingMessage = PROJECT_AI_CHAT_SENDING_MESSAGE;
  readonly conversationsEmptyMessage = PROJECT_AI_CONVERSATIONS_EMPTY_MESSAGE;
  readonly newConversationLabel = PROJECT_AI_NEW_CONVERSATION_LABEL;
  readonly conversationUpdatedLabel = conversationUpdatedLabel;
  readonly deleteConversationLabel = deleteConversationLabel;

  constructor() {
    // 履歴はユーザーごと。ユーザーが変わったら、前のユーザーの履歴と応答を出さない
    effect(() => {
      const userId = this.currentUserId();
      if (userId === this.userId) return;
      this.userId = userId;
      this.initialTarget = null;
      untracked(() => this.resetScope());
    });
    // 件数・末尾 id・loading 解除のあと、stick 中なら最下部へ（sending はトリガーにしない）
    effect(() => {
      const msgs = this.messages();
      void msgs.length;
      void msgs[msgs.length - 1]?.id;
      void this.loading();
      void this.loadError();
      untracked(() => this.scheduleScrollToBottomIfStuck());
    });
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => {
      this.cancelScopedRequests();
      this.applyRequest?.unsubscribe();
    });
    this.bindWideMedia(destroyRef);
  }

  ngOnChanges(changes: SimpleChanges) {
    const project = changes['projectId'];
    if (project) {
      this.initialTarget = project.firstChange
        ? initialConversationTarget(this.initialConversationId())
        : null;
      this.resetScope();
    }
    const focus = changes['focusItem'];
    if (focus && !focus.firstChange && !isSameItem(focus.previousValue, focus.currentValue)) {
      // 反映の応答は別のアイテムのものになったので捨てる（履歴はプロジェクトのものなので残す）
      this.applying.set(false);
    }
  }

  reload() {
    const scope = this.scope(++this.generation);
    this.loadShownConversation(scope);
    this.loadConversations();
    this.loadCredits(scope);
  }

  /** projectId かユーザーが変わった: 進行中の応答を捨て、空にして読み直す */
  private resetScope() {
    this.cancelScopedRequests();
    this.messages.set([]);
    this.conversationId.set(null);
    this.announced = null;
    this.conversationList.reset();
    this.historyOpen.set(false);
    this.clearEditing();
    this.draft.set('');
    this.error.set('');
    this.loadError.set('');
    this.loading.set(false);
    this.switching.set(false);
    this.deleting.set(false);
    this.setSending(false);
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
    this.shownRequest?.unsubscribe();
    this.conversationList.cancel();
    this.creditsRequest?.unsubscribe();
    this.sendRequest?.unsubscribe();
    this.switchRequest?.unsubscribe();
    this.deleteRequest?.unsubscribe();
  }

  /** 最初に表示する会話を決める: 指定の会話、空の新しい会話、いちばん新しい会話のどれか */
  private loadShownConversation(scope: ChatScope) {
    this.shownRequest?.unsubscribe();
    this.loading.set(true);
    this.loadError.set('');
    const target = this.initialTarget;
    if (target === 'new') {
      this.showLoaded(null, []);
      return;
    }
    if (target == null) {
      this.loadLatestConversation(scope);
      return;
    }
    this.shownRequest = this.api.getProjectAIConversation(scope.projectId, target).subscribe({
      next: (view) => {
        if (!this.stillCurrent(scope)) return;
        this.showLoaded(view.conversation.id, view.messages);
      },
      error: (err) => {
        if (!this.stillCurrent(scope)) return;
        if (!isNotFound(err)) {
          this.failLoad(err);
          return;
        }
        // 指定の会話はもう無い。いちばん新しい会話に落ちる
        this.initialTarget = null;
        this.loadLatestConversation(scope);
      },
    });
  }

  private loadLatestConversation(scope: ChatScope) {
    this.shownRequest = this.api.getLatestProjectAIChat(scope.projectId).subscribe({
      next: (view) => {
        if (!this.stillCurrent(scope)) return;
        this.showLoaded(view.conversation?.id ?? null, view.messages);
      },
      error: (err) => {
        if (!this.stillCurrent(scope)) return;
        this.failLoad(err);
      },
    });
  }

  private showLoaded(conversationId: number | null, messages: ProjectAIMessage[]) {
    this.initialTarget = null;
    this.enableStickToBottom();
    this.messages.set(messages);
    this.loading.set(false);
    this.showConversation(conversationId);
  }

  private failLoad(err: unknown) {
    this.loadError.set(errorMessage(err));
    this.loading.set(false);
  }

  /** 表示中の会話を切り替え、変わっていれば外へ伝える（stick/scroll は触らない） */
  private showConversation(conversationId: number | null) {
    this.conversationId.set(conversationId);
    const ref = conversationRef(conversationId);
    if (ref === this.announced) return;
    this.announced = ref;
    this.conversationChange.emit(ref);
  }

  loadConversations() {
    const scope = this.scope();
    this.conversationList.load(scope.projectId, () => this.stillCurrent(scope));
  }

  /** 送信・削除の結果を一覧に反映する。一覧をまだ読めていなければ、読み直す */
  private patchConversations(update: (list: ProjectAIConversation[]) => ProjectAIConversation[]) {
    if (!this.conversationList.patch(update)) this.loadConversations();
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

  /**
   * 押した行が一覧ごと消えた・削除で消えたとき、フォーカスを body に落とさずに入力欄へ移す。
   * ほかの場所へ移っていたら、奪わない。
   */
  private focusInputIfLost() {
    afterNextRender(
      () => {
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected) return;
        this.inputRef()?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  onMessageListScroll(event: Event) {
    const el = event.currentTarget;
    if (!(el instanceof HTMLElement)) return;
    this.stickToBottom = isNearBottom(el);
  }

  /** 追従を有効にする（スクロール予約は messages/loading の effect、または明示 schedule） */
  private enableStickToBottom() {
    this.stickToBottom = true;
  }

  /** 送信直後など、messages がまだ変わらないときに stick on して即予約する */
  private stickAndScrollToBottom() {
    this.enableStickToBottom();
    this.scheduleScrollToBottomIfStuck();
  }

  /**
   * stick 中なら描画後に list を最下部へ。
   * list ref の有無は afterNextRender 内で見る（成功直後の未 CD でも描画後に拾う）。
   */
  private scheduleScrollToBottomIfStuck() {
    if (
      !canScheduleStickScroll({
        loading: this.loading(),
        loadFailed: this.loadError() !== '',
        stickToBottom: this.stickToBottom,
      })
    ) {
      return;
    }
    afterNextRender(
      () => {
        if (!this.stickToBottom) return;
        const el = this.messageList()?.nativeElement;
        if (!el) return;
        scrollElementToBottom(el);
      },
      { injector: this.injector },
    );
  }

  toggleHistory() {
    this.historyOpen.update((open) => !open);
  }

  /** 空の新しい会話にする。サーバーには、最初に送ったときに作られる */
  startNew() {
    if (this.actionsLocked()) return;
    this.clearEditing();
    this.enableStickToBottom();
    this.messages.set([]);
    this.error.set('');
    this.historyOpen.set(false);
    this.showConversation(null);
    this.inputRef()?.nativeElement.focus();
  }

  startEdit(msg: ProjectAIMessage, event?: MouseEvent) {
    if (event && event.detail > 1) return;
    if (this.lastEditableUserMessage()?.id !== msg.id) return;
    this.draft.set(msg.body);
    this.editingFromMessageId.set(msg.id);
    this.error.set('');
    this.inputRef()?.nativeElement.focus();
  }

  cancelEdit() {
    this.clearEditing();
    this.draft.set('');
  }

  private clearEditing() {
    this.editingFromMessageId.set(null);
  }

  selectConversation(conversationId: number) {
    if (this.actionsLocked()) return;
    if (sameConversation(conversationId, this.conversationId())) {
      this.historyOpen.set(false);
      this.focusInputIfLost();
      return;
    }
    this.switchRequest?.unsubscribe();
    const scope = this.scope();
    this.switching.set(true);
    this.error.set('');
    this.switchRequest = this.api
      .getProjectAIConversation(scope.projectId, conversationId)
      .subscribe({
        next: (view) => {
          if (!this.stillCurrent(scope)) return;
          this.clearEditing();
          this.enableStickToBottom();
          this.messages.set(view.messages);
          this.switching.set(false);
          this.historyOpen.set(false);
          this.showConversation(view.conversation.id);
          this.focusInputIfLost();
        },
        error: (err) => {
          if (!this.stillCurrent(scope)) return;
          // 前の会話を表示したままにする
          this.switching.set(false);
          if (isNotFound(err)) {
            this.loadConversations();
            this.error.set(PROJECT_AI_CONVERSATION_NOT_FOUND);
            return;
          }
          this.error.set(errorMessage(err));
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
    const target = this.resolveSendTarget();
    if (!target.ok) {
      this.error.set(target.error);
      return;
    }
    this.stickAndScrollToBottom();
    this.sendRequest?.unsubscribe();
    const scope = this.scope();
    this.setSending(true);
    this.error.set('');
    // 送信中に別のアイテムへ移っても、同じプロジェクトなら回答は表示する（focusItem は比べない）
    const focusNumber = this.focusItem()?.number;
    const req =
      target.replaceFrom != null
        ? this.api.postProjectAIChat(
            scope.projectId,
            draft.text,
            target.conversation,
            focusNumber,
            target.replaceFrom,
          )
        : this.api.postProjectAIChat(scope.projectId, draft.text, target.conversation, focusNumber);
    this.sendRequest = req.subscribe({
      next: (res) => {
        if (this.stillCurrent(scope)) this.onSent(target.sentTo, res);
      },
      error: (err) => {
        if (this.stillCurrent(scope)) this.onSendFailed(target.sentTo, err);
      },
    });
  }

  /** 通常送信と編集再送信の会話／replace 引数を決める */
  private resolveSendTarget():
    | { ok: true; conversation: ConversationRef; sentTo: number | null; replaceFrom: number | null }
    | { ok: false; error: string } {
    const replaceFrom = this.editingFromMessageId();
    const sentTo = this.conversationId();
    if (replaceFrom != null) {
      if (sentTo == null) {
        return { ok: false, error: PROJECT_AI_EDIT_NEEDS_CONVERSATION };
      }
      return { ok: true, conversation: sentTo, sentTo, replaceFrom };
    }
    return { ok: true, conversation: conversationRef(sentTo), sentTo, replaceFrom: null };
  }

  /** 回答が保存された。一覧に反映し、送った先がまだ表示中なら、やりとりも出す */
  private onSent(sentTo: number | null, res: ProjectAIChatPostResponse) {
    this.setSending(false);
    if (storedInSentConversation(sentTo, res.conversation.id)) {
      this.patchConversations((list) => upsertConversationFirst(list, res.conversation));
    } else {
      // サーバーが会話を作った。刈り込まれた会話や、消された送り先を手元に残さない
      this.loadConversations();
    }
    // 表示中の会話が送ったときと違えば、回答は別の会話のものなので表示しない
    if (!sameConversation(sentTo, this.conversationId())) return;
    this.messages.set(res.messages);
    this.draft.set('');
    this.clearEditing();
    this.showConversation(res.conversation.id);
  }

  /** 送信が失敗した。送った先がまだ表示中なら、理由を出す */
  private onSendFailed(sentTo: number | null, err: unknown) {
    this.setSending(false);
    if (!sameConversation(sentTo, this.conversationId())) return;
    if (isConversationGoneOnSend(sentTo, err)) {
      // 表示中の会話が外で消えていた。下書きを残して、新しい会話として送り直せるようにする
      this.loadConversations();
      this.clearEditing();
      this.messages.set([]);
      this.showConversation(null);
      this.error.set(PROJECT_AI_CONVERSATION_GONE_ON_SEND);
      return;
    }
    this.error.set(errorMessage(err));
  }

  deleteConversation(conversationId: number, event?: MouseEvent) {
    if (event && event.detail > 1) return;
    if (this.actionsLocked()) return;
    if (!window.confirm(PROJECT_AI_CONVERSATION_DELETE_CONFIRM)) return;
    this.deleteRequest?.unsubscribe();
    const scope = this.scope();
    this.deleting.set(true);
    this.error.set('');
    const deleted = () => {
      this.deleting.set(false);
      this.patchConversations((list) => removeConversation(list, conversationId));
      this.focusInputIfLost();
      if (!sameConversation(conversationId, this.conversationId())) return;
      this.clearEditing();
      this.enableStickToBottom();
      this.messages.set([]);
      this.showConversation(null);
    };
    this.deleteRequest = this.api
      .deleteProjectAIConversation(scope.projectId, conversationId)
      .subscribe({
        next: () => {
          if (!this.stillCurrent(scope)) return;
          deleted();
        },
        error: (err) => {
          if (!this.stillCurrent(scope)) return;
          // 404 は、別のタブなどで既に消えていた。消えたことに変わりはない
          if (isNotFound(err)) {
            deleted();
            return;
          }
          this.deleting.set(false);
          this.error.set(errorMessage(err));
        },
      });
  }

  /** 提案の状態が変わった（カードがサーバーから受け取った提案）。表示中のメッセージを置き換える */
  onProposalChanged(proposal: ProjectAIProposal) {
    this.messages.update((list) => replaceProposal(list, proposal));
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

  private setSending(sending: boolean) {
    if (this.sending() === sending) return;
    this.sending.set(sending);
    this.sendingChange.emit(sending);
  }

  private bindWideMedia(destroyRef: DestroyRef) {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(CONVERSATION_LIST_PINNED_QUERY);
    const sync = () => this.wide.set(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    destroyRef.onDestroy(() => mq.removeEventListener('change', sync));
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
