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
import { ProjectAiChat } from './project-ai-chat';
import { parseProjectQueryParam } from './project-query';
import { ProjectSession } from './project-session';

type PageView = 'waiting' | 'empty' | 'invalid' | 'chat';

@Component({
  selector: 'app-ai-chat-page',
  imports: [ProjectAiChat],
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

  readonly projectId = computed(() => {
    const parsed = this.queryParse();
    if (parsed.kind === 'ok') return parsed.id;
    if (parsed.kind === 'invalid') return null;
    const id = this.projects.activeId();
    return id != null && id > 0 ? id : null;
  });

  readonly view = computed<PageView>(() => {
    if (!this.projects.bootstrapped() || this.projects.switching()) return 'waiting';
    if (this.queryParse().kind === 'invalid') return 'invalid';
    if (this.projectId() == null) return 'empty';
    return 'chat';
  });

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

  goBack() {
    if (typeof history !== 'undefined' && history.length > 1) {
      this.location.back();
      return;
    }
    void this.router.navigateByUrl('/');
  }
}
