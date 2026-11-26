import {
  afterNextRender,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { AiChatContext } from './ai-chat-context';
import { isEditableFocusTarget } from './ai-chat-focus-target';
import {
  aiChatPageQueryParams,
  isAiChatRoute,
  resolveChatProjectId,
  toFocusItem,
} from './ai-chat-target';
import { AuthSession } from './auth-session';
import { Item } from './models';
import { ProjectAiChat } from './project-ai-chat';
import type { ConversationRef } from './api';
import { ProjectSession } from './project-session';

const OPEN_GUARD_MS = 300;
const CLOSE_GUARD_MS = 300;

@Component({
  selector: 'app-ai-chat-fab',
  imports: [ProjectAiChat],
  templateUrl: './ai-chat-fab.html',
  styleUrl: './ai-chat-fab.css',
})
export class AiChatFab implements OnInit {
  private readonly ctx = inject(AiChatContext);
  private readonly auth = inject(AuthSession);
  private readonly router = inject(Router);
  private readonly projects = inject(ProjectSession);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  private readonly entryRef = viewChild<ElementRef<HTMLButtonElement>>('entryBtn');
  private readonly panelRef = viewChild<ElementRef<HTMLElement>>('panel');

  readonly open = signal(false);
  readonly expanding = signal(false);
  /** ドックのチャットが送信中か。送信中に専用画面へ移ると、応答が捨てられる */
  readonly chatSending = signal(false);
  /** ドックのチャットが表示中の会話。最初の読み込みが終わるまでは null */
  private readonly chatConversation = signal<ConversationRef | null>(null);
  private readonly routeUrl = signal(this.router.url);
  private openedAt = 0;
  private closedAt = 0;
  private lastActiveProjectId: number | null = null;

  /** アイテム詳細ではそのアイテムのプロジェクト、ボード・バックログでは選択中のプロジェクト */
  readonly projectId = computed(() =>
    resolveChatProjectId({
      pageKind: this.ctx.pageKind(),
      detailProjectId: this.ctx.detailProjectId(),
      activeProjectId: this.projects.activeId(),
    }),
  );

  readonly focusItem = computed(() => toFocusItem(this.ctx.pageKind(), this.ctx.focusItem()));

  readonly showEntry = computed(() => {
    if (!isAiChatRoute(this.routeUrl())) return false;
    if (this.auth.status() !== 'authenticated' || !this.auth.user() || this.auth.user()?.disabled) {
      return false;
    }
    return this.projectId() != null;
  });

  constructor() {
    this.lastActiveProjectId = this.projects.activeId();
    effect(() => {
      const activeId = this.projects.activeId();
      if (activeId === this.lastActiveProjectId) return;
      this.lastActiveProjectId = activeId;
      this.closePanel({ restoreFocus: false });
    });

    // チャットの部品は、入口が出ていてプロジェクトがある間だけある。無くなったとき（パネルは
    // 開いたままでも）と、プロジェクトが変わって読み直すときは、前のチャットの状態を捨てる。
    // 破棄された部品は sendingChange(false) を出さず、作り直された部品は最初から false なので
    // 出さない。この effect は、この部品のテンプレート（チャットの生成と入力の更新）より前に
    // 走るので、新しいチャットが伝える値は消さない。
    effect(() => {
      this.showEntry();
      this.projectId();
      untracked(() => this.resetChatState());
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', this.onDocumentKeydown);
      this.destroyRef.onDestroy(() =>
        document.removeEventListener('keydown', this.onDocumentKeydown),
      );
    }
  }

  ngOnInit() {
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((e) => {
        this.routeUrl.set(e.urlAfterRedirects);
        this.onNavigation();
      });
  }

  onNavigation() {
    if (!isAiChatRoute(this.routeUrl())) this.closePanel({ restoreFocus: false });
  }

  toggle() {
    if (this.open()) this.closePanel({ restoreFocus: true });
    else this.openPanel();
  }

  openPanel() {
    if (!this.showEntry()) return;
    this.resetChatState();
    this.open.set(true);
    this.openedAt = Date.now();
    afterNextRender(
      () => {
        if (this.destroyRef.destroyed) return;
        if (document.querySelector('dialog[open]')) return;
        const root = this.panelRef()?.nativeElement;
        const focusable = root?.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        focusable?.focus();
      },
      { injector: this.injector },
    );
  }

  closePanel(opts: { restoreFocus: boolean }) {
    if (!this.open()) {
      if (opts.restoreFocus) {
        afterNextRender(
          () => {
            if (this.destroyRef.destroyed) return;
            if (document.querySelector('dialog[open]')) return;
            this.entryRef()?.nativeElement.focus();
          },
          { injector: this.injector },
        );
      }
      return;
    }
    const panel = this.panelRef()?.nativeElement;
    const active = document.activeElement;
    if (panel && active instanceof HTMLElement && panel.contains(active)) {
      active.blur();
    }
    this.open.set(false);
    this.closedAt = Date.now();
    if (!opts.restoreFocus) return;
    afterNextRender(
      () => {
        if (this.destroyRef.destroyed) return;
        if (document.querySelector('dialog[open]')) return;
        this.entryRef()?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }

  onDocumentKeydown = (event: KeyboardEvent) => {
    if (!this.open()) {
      if ((event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') && event.repeat) {
        if (Date.now() - this.closedAt < CLOSE_GUARD_MS) event.preventDefault();
      }
      return;
    }
    if (event.key !== 'Escape') return;
    if (event.isComposing || event.keyCode === 229 || event.repeat) return;
    if (Date.now() - this.openedAt < OPEN_GUARD_MS) return;
    if (document.querySelector('dialog[open]')) return;
    const active = document.activeElement;
    const panel = this.panelRef()?.nativeElement;
    if (panel && active instanceof Node && panel.contains(active) && isEditableFocusTarget(active)) {
      return;
    }
    event.preventDefault();
    this.closePanel({ restoreFocus: true });
  };

  async expandToPage() {
    if (!this.open() || this.expanding() || this.chatSending()) return;
    this.expanding.set(true);
    try {
      const ok = await this.router.navigate(['/ai-chat'], {
        queryParams: aiChatPageQueryParams(this.projectId(), this.chatConversation()),
      });
      if (ok) {
        this.closePanel({ restoreFocus: false });
      }
    } catch {
      // navigate 失敗時はドックを開いたまま（L-001）
    } finally {
      this.expanding.set(false);
    }
  }

  onConversationChange(conversation: ConversationRef) {
    this.chatConversation.set(conversation);
  }

  /** チャットは、閉じるか入口が消えると破棄される。開くたび・破棄のたびに、前のチャットの状態を捨てる */
  private resetChatState() {
    this.chatSending.set(false);
    this.chatConversation.set(null);
  }

  onDescriptionApplied(item: Item) {
    this.ctx.onDescriptionApplied()?.(item);
  }

  onCommentApplied() {
    this.ctx.onCommentApplied()?.();
  }
}
