import { ActiveProjectName } from './active-project-name';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { Location } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import {
  CONVERSATION_QUERY_PARAM,
  conversationQueryParams,
  parseConversationQueryParam,
} from './ai-chat-target';
import type { ConversationRef } from './api';
import { ProjectAiChat } from './project-ai-chat';
import { parseProjectQueryParam } from './project-query';
import { ProjectSession } from './project-session';

type PageView = 'waiting' | 'empty' | 'invalid' | 'chat';

@Component({
  selector: 'app-ai-chat-page',
  imports: [ProjectAiChat, ActiveProjectName],
  templateUrl: './ai-chat-page.html',
  styleUrl: './ai-chat-page.css',
})
export class AiChatPage {
  private readonly projects = inject(ProjectSession);
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  private readonly backRef = viewChild<ElementRef<HTMLButtonElement>>('backBtn');
  private readonly headingRef = viewChild<ElementRef<HTMLElement>>('heading');
  private readonly focusedOnce = signal(false);

  private readonly queryParse = toSignal(
    this.route.queryParamMap.pipe(map((q) => parseProjectQueryParam(q.get('project')))),
    { initialValue: parseProjectQueryParam(this.route.snapshot.queryParamMap.get('project')) },
  );

  /** クエリ `conversation`（ID、'new'）。無い・不正なら null（いちばん新しい会話を開く） */
  readonly conversation = toSignal(
    this.route.queryParamMap.pipe(
      map((q) => parseConversationQueryParam(q.getAll(CONVERSATION_QUERY_PARAM))),
    ),
    {
      initialValue: parseConversationQueryParam(
        this.route.snapshot.queryParamMap.getAll(CONVERSATION_QUERY_PARAM),
      ),
    },
  );

  readonly projectId = computed(() => {
    const parsed = this.queryParse();
    if (parsed.kind === 'ok') {
      return this.knownProjectId(parsed.id);
    }
    if (parsed.kind === 'invalid') return null;
    const id = this.projects.activeId();
    return id != null && id > 0 ? id : null;
  });

  readonly view = computed<PageView>(() => {
    if (!this.projects.bootstrapped() || this.projects.switching()) return 'waiting';
    const parsed = this.queryParse();
    if (parsed.kind === 'invalid') return 'invalid';
    if (parsed.kind === 'ok' && this.knownProjectId(parsed.id) == null) return 'invalid';
    if (this.projectId() == null) return 'empty';
    return 'chat';
  });

  private knownProjectId(id: number): number | null {
    const list = this.projects.projects();
    if (!list.some((p) => p.id === id)) return null;
    return id;
  }

  constructor() {
    effect(() => {
      const v = this.view();
      if (v !== 'chat') {
        this.focusedOnce.set(false);
        return;
      }
      if (this.focusedOnce() || this.destroyRef.destroyed) return;
      afterNextRender(
        () => {
          if (this.destroyRef.destroyed || this.focusedOnce() || this.view() !== 'chat') return;
          this.focusedOnce.set(true);
          const target = this.backRef()?.nativeElement ?? this.headingRef()?.nativeElement;
          target?.focus();
        },
        { injector: this.injector },
      );
    });
  }

  /** 表示中の会話を URL に残す（再読み込みしても同じ会話が開く）。履歴は増やさない */
  onConversationChange(conversation: ConversationRef) {
    if (conversation === this.conversation()) return;
    // 別の画面へ移っている途中なら書き換えない（書き換えると、その移動が取り消される）
    if (this.router.currentNavigation()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: conversationQueryParams(conversation),
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  goBack() {
    if (typeof history !== 'undefined' && history.length > 1) {
      this.location.back();
      return;
    }
    void this.router.navigateByUrl('/');
  }
}
