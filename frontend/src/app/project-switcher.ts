import {
  Component,
  computed,
  effect,
  ElementRef,
  HostListener,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Api } from './api';
import { Project } from './models';
import { ProjectBoardCache } from './project-board-cache';
import { shouldSyncProjectQuery, urlPathOf, withProjectQueryParam } from './project-query';
import { projectsForSelectDisplay } from './project-select-display';
import {
  canOpenProjectMenu,
  moveProjectHighlight,
  resolveHighlightedProjectId,
} from './project-select-menu';
import { ProjectSession } from './project-session';
import { projectStatusAriaLabel, projectStatusDots, StatusKind } from './project-status-dots';

/**
 * 選択中のプロジェクトを切り替える listbox（ボード・バックログの右上に置く）。
 * 開閉の状態はこの部品のローカルに持ち、ページを離れると破棄される。
 */
@Component({
  selector: 'app-project-switcher',
  templateUrl: './project-switcher.html',
  styleUrl: './project-switcher.css',
})
export class ProjectSwitcher {
  readonly projectSession = inject(ProjectSession);
  private readonly api = inject(Api);
  private readonly projectBoardCache = inject(ProjectBoardCache);
  private readonly router = inject(Router);
  private readonly projectSwitcherRef = viewChild<ElementRef<HTMLElement>>('projectSwitcher');
  private readonly projectSelectTriggerRef =
    viewChild<ElementRef<HTMLElement>>('projectSelectTrigger');
  private readonly projectSelectListRef = viewChild<ElementRef<HTMLElement>>('projectSelectList');

  readonly projectMenuOpen = signal(false);
  readonly highlightedProjectId = signal<number | null>(null);

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

  /** Trigger text: active project name, or '…' until it resolves. */
  readonly triggerLabel = computed(() => {
    const id = this.projectSession.activeId();
    return this.projectSession.projects().find((p) => p.id === id)?.name ?? '…';
  });

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
  }

  optionAriaLabel(project: Project): string {
    return projectStatusAriaLabel(project.name, this.optionStatusDots(project));
  }

  optionStatusDots(project: Project): StatusKind[] {
    return this.projectStatusById().get(project.id) ?? [];
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
    if (id === this.projectSession.activeId() && !this.projectSession.ephemeralActiveView()) {
      return;
    }
    // This component is destroyed with its page; skip the URL sync if the user left before the switch finished.
    const startUrl = this.router.url;
    this.projectSession.switchTo(id).subscribe({
      next: (resolved) => {
        if (!shouldSyncProjectQuery(startUrl, this.router.url)) return;
        this.syncProjectQueryToUrl(resolved);
      },
      error: () => {
        /* activeId restored inside switchTo; trigger text follows triggerLabel */
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
    this.projectBoardCache.refreshOthers(
      this.api,
      activeId,
      this.projectSession.projects().map((p) => p.id),
    );
    this.softPrefetchOtherBacklogs(activeId);
  }

  private softPrefetchOtherBacklogs(activeId: number) {
    if (!urlPathOf(this.router.url).startsWith('/backlog')) return;
    for (const id of this.projectSession.projects().map((p) => p.id)) {
      if (id === activeId) continue;
      this.projectBoardCache.prefetchBacklog(this.api, id);
    }
  }

  private syncProjectQueryToUrl(id: number) {
    if (!Number.isFinite(id) || id <= 0) return;
    const tree = this.router.parseUrl(this.router.url);
    tree.queryParams = withProjectQueryParam(tree.queryParams, id);
    // Merge into a UrlTree (pure) and navigateByUrl; navigate([], merge) does not update the URL from a non-routed host.
    void this.router.navigateByUrl(tree, { replaceUrl: true });
  }
}
