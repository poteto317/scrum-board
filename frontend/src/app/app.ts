import {
  Component,
  computed,
  effect,
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
import { AuthSession } from './auth-session';
import { FavoritesSession, displayFavoriteTitle } from './favorites-session';
import { HeaderMenuSession } from './header-menu-session';
import { HeaderMenu } from './header-menu.component';
import { ProjectSession } from './project-session';
import { isBoardPath, resolveProjectDeepLinkAction } from './project-query';
import { readSidebarCollapsed, writeSidebarCollapsed } from './sidebar-collapse-storage';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, HeaderMenu, AiChatFab],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  readonly projectSession = inject(ProjectSession);
  private readonly headerMenuSession = inject(HeaderMenuSession);
  readonly auth = inject(AuthSession);
  readonly favorites = inject(FavoritesSession);
  readonly displayFavoriteTitle = displayFavoriteTitle;
  private readonly router = inject(Router);
  private readonly loginPath = signal(false);
  private readonly routeUrl = signal(this.router.url);
  readonly showChrome = computed(() => {
    if (this.loginPath()) return false;
    const s = this.auth.status();
    return s === 'authenticated' || s === 'error';
  });

  readonly showAiChatFab = computed(() => isAiChatRoute(this.routeUrl()));
  private readonly aiChatFab = viewChild(AiChatFab);
  readonly dockOpen = computed(() => this.aiChatFab()?.open() === true);

  /** Sidebar rail vs expanded. Read once from localStorage; showChrome changes do not re-read. */
  readonly collapsed = signal(readSidebarCollapsed());
  private projectDeepLinkApplied = false;

  constructor() {
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
}
