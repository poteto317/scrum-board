import {
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  OnInit,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AiChatFab } from './ai-chat-fab';
import { isAiChatRoute } from './ai-chat-target';
import { Api } from './api';
import { AuthSession } from './auth-session';
import { FavoritesSession, displayFavoriteTitle } from './favorites-session';
import { HeaderMenuSession } from './header-menu-session';
import { HeaderMenu } from './header-menu.component';
import { ProjectBoardCache } from './project-board-cache';
import { projectsForSelectDisplay } from './project-select-display';
import {
  canOpenProjectMenu,
  moveProjectHighlight,
  resolveHighlightedProjectId,
} from './project-select-menu';
import {
  projectStatusAriaLabel,
  projectStatusDots,
  StatusKind,
} from './project-status-dots';
import { ProjectSession } from './project-session';
import {
  isBoardPath,
  resolveProjectDeepLinkAction,
  withProjectQueryParam,
} from './project-query';
import { readSidebarCollapsed, writeSidebarCollapsed } from './sidebar-collapse-storage';
import { Project } from './models';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, HeaderMenu, AiChatFab],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  readonly projectSession = inject(ProjectSession);
  private readonly headerMenuSession = inject(HeaderMenuSession);
  private readonly api = inject(Api);
  private readonly projectBoardCache = inject(ProjectBoardCache);
  readonly auth = inject(AuthSession);
  readonly favorites = inject(FavoritesSession);
  readonly displayFavoriteTitle = displayFavoriteTitle;
  private readonly router = inject(Router);
  private readonly loginPath = signal(false);
  private readonly routeUrl = signal(this.router.url);
  private readonly projectSwitcherRef = viewChild<ElementRef<HTMLElement>>('projectSwitcher');
  private readonly projectSelectTriggerRef =
    viewChild<ElementRef<HTMLElement>>('projectSelectTrigger');
  private readonly projectSelectListRef = viewChild<ElementRef<HTMLElement>>('projectSelectList');
  readonly showChrome = computed(() => {
    if (this.loginPath()) return false;
    const s = this.auth.status();
    return s === 'authenticated' || s === 'error';
  });

  readonly showAiChatFab = computed(() => isAiChatRoute(this.routeUrl()));

  /** Sidebar rail vs expanded. Read once from localStorage; showChrome changes do not re-read. */
  readonly collapsed = signal(readSidebarCollapsed());
  readonly projectMenuOpen = signal(false);
  readonly highlightedProjectId = signal<number | null>(null);
  private projectDeepLinkApplied = false;

  readonly displayProjects = computed(() =>
    projectsForSelectDisplay(this.projectSession.projects(), this.projectSession.activeId()),
  );

  /** Depends on cache.revision so open listbox refreshes when put/refresh lands. */
  readonly projectStatusById = computed(() => {
    this.projectBoardCache.revision();
    const map = new Map<number, StatusKind[]>();
    for (const p of this.projectSession.projects()) {
      const snap = this.projectBoardCache.peekBoardSnapshot(p.id);
      map.set(p.id, snap ? projectStatusDots(snap.columns, snap.items) : []);
    }
    return map;
  });

  readonly activeProjectName = computed(() => {
    const id = this.projectSession.activeId();
    return this.projectSession.projects().find((p) => p.id === id)?.name ?? '…';
  });

  optionAriaLabel(project: Project): string {
    return projectStatusAriaLabel(project.name, this.optionStatusDots(project));
  }

  optionStatusDots(project: Project): StatusKind[] {
    return this.projectStatusById().get(project.id) ?? [];
  }

  constructor() {
    effect(() => {
      const open = this.projectMenuOpen();
      const activeId = this.projectSession.activeId();
      const list = this.displayProjects();
      if (!open) return;
      const current = untracked(() => this.highlightedProjectId());
      const next = resolveHighlightedProjectId(list, activeId, current);
      if (next == null) {
        this.projectMenuOpen.set(false);
        this.highlightedProjectId.set(null);
        return;
      }
      if (next !== current) {
        this.highlightedProjectId.set(next);
      }
    });
    effect(() => {
      if (!this.projectSession.bootstrapped()) return;
      if (this.projectDeepLinkApplied) return;
      // Wait until board: load may finish on /login before returnUrl navigate (L-044 race).
      const path = this.routeUrl().split('?')[0];
      if (!isBoardPath(path)) return;
      this.projectDeepLinkApplied = true;
      untracked(() => this.applyProjectDeepLink());
    });
  }

  toggleSidebar() {
    const next = !this.collapsed();
    this.collapsed.set(next);
    writeSidebarCollapsed(next);
  }

  onSidebarToggleKeydown(event: KeyboardEvent) {
    if ((event.key === 'Enter' || event.key === ' ') && event.repeat) {
      event.preventDefault();
    }
  }

  ngOnInit() {
    this.loginPath.set(this.router.url.split('?')[0] === '/login');
    this.routeUrl.set(this.router.url);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.loginPath.set(e.urlAfterRedirects.split('?')[0] === '/login');
        this.routeUrl.set(e.urlAfterRedirects);
      });
    this.auth.ensureMe().subscribe({
      next: () => {
        this.projectSession.load();
        this.headerMenuSession.load();
      },
      error: () => {
        /* guest/login or transient error — guard / login handle UX */
      },
    });
  }

  onProjectTriggerClick(event: MouseEvent) {
    event.preventDefault();
    if (this.projectMenuOpen()) {
      this.closeProjectMenu(false);
      return;
    }
    this.openProjectMenu();
  }

  onProjectTriggerKeydown(event: KeyboardEvent) {
    if (this.projectMenuOpen()) {
      this.onProjectListKeydown(event);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      this.openProjectMenu();
    }
  }

  onProjectListKeydown(event: KeyboardEvent) {
    if (!this.projectMenuOpen()) return;
    const list = this.displayProjects();
    if (event.key === ' ') {
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      this.closeProjectMenu(true);
      return;
    }
    if (event.key === 'Enter') {
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      const id = this.highlightedProjectId();
      if (id != null) this.onProjectOptionSelect(id);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = moveProjectHighlight(
        list,
        this.highlightedProjectId(),
        event.key === 'ArrowDown' ? 'down' : 'up',
      );
      if (next != null) {
        this.highlightedProjectId.set(next);
        queueMicrotask(() => this.scrollHighlightedOptionIntoView(next));
      }
    }
  }

  private scrollHighlightedOptionIntoView(id: number) {
    const option = this.projectSelectListRef()?.nativeElement.querySelector(
      `#project-option-${id}`,
    ) as HTMLElement | null;
    option?.scrollIntoView({ block: 'nearest' });
  }

  onProjectOptionSelect(id: number) {
    if (!Number.isFinite(id) || id <= 0) return;
    this.closeProjectMenu(true);
    if (
      id === this.projectSession.activeId() &&
      !this.projectSession.ephemeralActiveView()
    ) {
      return;
    }
    this.projectSession.switchTo(id).subscribe({
      next: (resolved) => this.syncProjectQueryToUrl(resolved),
      error: () => {
        /* activeId restored inside switchTo; trigger text follows activeProjectName */
      },
    });
  }

  openProjectMenu() {
    if (
      !canOpenProjectMenu({
        switching: this.projectSession.switching(),
        modalOpen: false,
        saving: this.projectSession.mutating(),
        activeId: this.projectSession.activeId(),
        projectCount: this.projectSession.projects().length,
      })
    ) {
      return;
    }
    const list = this.displayProjects();
    this.highlightedProjectId.set(this.projectSession.activeId() ?? list[0]?.id ?? null);
    this.projectMenuOpen.set(true);
    this.onProjectSelectWarmup();
    queueMicrotask(() => this.applyProjectListMaxHeight());
  }

  private applyProjectListMaxHeight() {
    const trigger = this.projectSelectTriggerRef()?.nativeElement;
    const panel = this.projectSelectListRef()?.nativeElement;
    if (!trigger || !panel) return;
    const room = Math.max(80, window.innerHeight - trigger.getBoundingClientRect().bottom - 8);
    panel.style.maxHeight = `${Math.min(280, room)}px`;
  }

  closeProjectMenu(restoreFocus: boolean) {
    if (!this.projectMenuOpen()) return;
    this.projectMenuOpen.set(false);
    this.highlightedProjectId.set(null);
    if (restoreFocus) {
      queueMicrotask(() => {
        this.projectSelectTriggerRef()?.nativeElement.focus();
      });
    }
  }

  @HostListener('document:keydown.escape')
  onProjectMenuEscape() {
    if (this.projectMenuOpen()) this.closeProjectMenu(true);
  }

  @HostListener('document:mousedown', ['$event'])
  onProjectMenuDocumentMouseDown(event: MouseEvent) {
    if (!this.projectMenuOpen()) return;
    const root = this.projectSwitcherRef()?.nativeElement;
    if (!root?.contains(event.target as Node)) {
      this.closeProjectMenu(false);
    }
  }

  /** Listbox open path: force-refresh status boards; soft-prefetch backlog on that route. */
  onProjectSelectWarmup() {
    if (this.projectSession.switching() || this.projectSession.mutating()) return;
    const activeId = this.projectSession.activeId();
    if (activeId == null || activeId <= 0) return;
    this.refreshProjectStatusBoards();
    this.softPrefetchOtherBacklogs(activeId);
  }

  private refreshProjectStatusBoards() {
    if (this.projectSession.switching() || this.projectSession.mutating()) return;
    const activeId = this.projectSession.activeId();
    if (activeId == null || activeId <= 0) return;
    this.projectBoardCache.refreshOthers(
      this.api,
      activeId,
      this.projectSession.projects().map((p) => p.id),
    );
  }

  private softPrefetchOtherBacklogs(activeId: number) {
    if (!this.router.url.split('?')[0].startsWith('/backlog')) return;
    for (const id of this.projectSession.projects().map((p) => p.id)) {
      if (id === activeId) continue;
      this.projectBoardCache.prefetchBacklog(this.api, id);
    }
  }

  private applyProjectDeepLink() {
    const url = this.routeUrl();
    const path = url.split('?')[0];
    const values = this.router.parseUrl(url).queryParamMap.getAll('project');
    const action = resolveProjectDeepLinkAction({
      path,
      projectValues: values,
      projectIds: this.projectSession.projects().map((p) => p.id),
      activeId: this.projectSession.activeId(),
    });
    if (action.kind === 'skip') return;
    if (action.kind === 'error') {
      this.projectSession.error.set(action.message);
      return;
    }
    this.projectSession.viewFromDeepLink(action.id);
  }

  private syncProjectQueryToUrl(id: number) {
    if (!Number.isFinite(id) || id <= 0) return;
    const tree = this.router.parseUrl(this.routeUrl());
    tree.queryParams = withProjectQueryParam(tree.queryParams, id);
    // navigateByUrl+UrlTree: App root では navigate([], merge) が URL を更新しないため同等の merge を純関数で行う。
    void this.router.navigateByUrl(tree, { replaceUrl: true });
  }
}
