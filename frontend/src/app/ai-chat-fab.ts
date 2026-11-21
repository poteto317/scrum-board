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
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { AiChatContext } from './ai-chat-context';
import {
  isAiChatRoute,
  optionKey,
  resolveTarget,
  selectableCandidates,
  type AiChatTarget,
} from './ai-chat-target';
import { AuthSession } from './auth-session';
import { ItemAiChat } from './item-ai-chat';
import { Item } from './models';
import { ProjectSession } from './project-session';

const OPEN_GUARD_MS = 300;
const CLOSE_GUARD_MS = 300;

@Component({
  selector: 'app-ai-chat-fab',
  imports: [ItemAiChat],
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
  readonly selected = signal<AiChatTarget | null>(null);
  private readonly routeUrl = signal(this.router.url);
  private openedAt = 0;
  private closedAt = 0;
  private lastActiveProjectId: number | null = null;

  readonly pageKind = this.ctx.pageKind;
  readonly candidates = this.ctx.candidates;

  readonly showEntry = computed(() => {
    if (!isAiChatRoute(this.routeUrl())) return false;
    if (this.auth.status() !== 'authenticated' || !this.auth.user() || this.auth.user()?.disabled) {
      return false;
    }
    const kind = this.pageKind();
    if (kind === 'detail') return this.ctx.routeTarget() != null;
    if (kind === 'board' || kind === 'backlog') {
      return selectableCandidates(this.candidates()).length >= 1;
    }
    return false;
  });

  readonly activeTarget = computed(() =>
    resolveTarget({
      pageKind: this.pageKind(),
      routeTarget: this.ctx.routeTarget(),
      selected: this.selected(),
      candidates: this.candidates(),
    }),
  );

  readonly optionKey = optionKey;

  constructor() {
    this.lastActiveProjectId = this.projects.activeId();
    effect(() => {
      const activeId = this.projects.activeId();
      if (activeId === this.lastActiveProjectId) return;
      this.lastActiveProjectId = activeId;
      this.closePanel({ restoreFocus: false });
      this.selected.set(null);
    });
    effect(() => {
      this.candidates();
      this.ctx.routeTarget();
      this.pageKind();
      this.syncSelectionFromCandidates();
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

  syncSelectionFromCandidates() {
    this.selected.set(
      resolveTarget({
        pageKind: this.pageKind(),
        routeTarget: this.ctx.routeTarget(),
        selected: this.selected(),
        candidates: this.candidates(),
      }),
    );
  }

  onNavigation() {
    if (!isAiChatRoute(this.routeUrl())) {
      this.closePanel({ restoreFocus: false });
      this.selected.set(null);
      return;
    }
    this.syncSelectionFromCandidates();
  }

  toggle() {
    if (this.open()) this.closePanel({ restoreFocus: true });
    else this.openPanel();
  }

  openPanel() {
    if (!this.showEntry()) return;
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
    event.preventDefault();
    this.closePanel({ restoreFocus: true });
  };

  onSelectChange(key: string) {
    const hit = this.candidates().find((c) => optionKey(c) === key && c.canEdit);
    this.selected.set(
      hit ? { number: hit.number, projectId: hit.projectId, itemId: hit.itemId } : null,
    );
  }

  selectedKey(): string {
    const t = this.activeTarget();
    return t ? optionKey(t) : '';
  }

  onDescriptionApplied(item: Item) {
    this.ctx.onDescriptionApplied()?.(item);
  }

  onCommentApplied() {
    this.ctx.onCommentApplied()?.();
  }
}
