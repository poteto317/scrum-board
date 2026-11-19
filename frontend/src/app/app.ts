import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { Api } from './api';
import { errorMessage } from './api-error';
import { AuthSession } from './auth-session';
import { FavoritesSession, displayFavoriteTitle } from './favorites-session';
import { textLimit } from './form-validation';
import { Modal } from './modal';
import { HeaderMenuSession } from './header-menu-session';
import { HeaderMenu } from './header-menu.component';
import { ProjectBoardCache } from './project-board-cache';
import { PROJECT_NAME_REQUIRED, ProjectSession } from './project-session';
import { readSidebarCollapsed, writeSidebarCollapsed } from './sidebar-collapse-storage';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, ReactiveFormsModule, Modal, HeaderMenu],
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
  readonly showChrome = computed(() => {
    if (this.loginPath()) return false;
    const s = this.auth.status();
    return s === 'authenticated' || s === 'error';
  });

  readonly projectModalOpen = signal(false);
  readonly formError = signal('');
  readonly saving = signal(false);
  /** Sidebar rail vs expanded. Read once from localStorage; showChrome changes do not re-read. */
  readonly collapsed = signal(readSidebarCollapsed());
  readonly projectForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [textLimit(80, true)] }),
  });

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
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.loginPath.set(e.urlAfterRedirects.split('?')[0] === '/login');
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

  onProjectChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const id = Number(select.value);
    if (!Number.isFinite(id) || id <= 0) return;
    this.projectSession.switchTo(id).subscribe({
      error: () => {
        const current = this.projectSession.activeId();
        select.value = current == null ? '' : String(current);
      },
    });
  }

  /** Prefetch other projects' board (and backlog on that route) into memory cache. */
  onProjectSelectPrefetch() {
    if (this.projectSession.switching() || this.projectSession.mutating()) return;
    const activeId = this.projectSession.activeId();
    if (activeId == null || activeId <= 0) return;
    const path = this.router.url.split('?')[0];
    const includeBacklog = path.startsWith('/backlog');
    this.projectBoardCache.prefetchOthers(
      this.api,
      activeId,
      this.projectSession.projects().map((p) => p.id),
      includeBacklog,
    );
  }

  addProject() {
    if (
      this.projectModalOpen() ||
      this.projectSession.switching() ||
      this.projectSession.mutating() ||
      this.saving()
    ) {
      return;
    }
    this.projectForm.reset({ name: '' });
    this.formError.set('');
    this.projectSession.error.set('');
    this.projectModalOpen.set(true);
  }

  closeProjectModal() {
    if (this.saving()) return;
    this.projectModalOpen.set(false);
    this.projectForm.reset({ name: '' });
    this.formError.set('');
  }

  submitProject() {
    if (this.saving() || this.projectSession.switching() || this.projectSession.mutating()) {
      return;
    }
    if (this.projectForm.invalid) {
      this.projectForm.markAllAsTouched();
      return;
    }
    const name = this.projectForm.controls.name.value.trim();
    this.saving.set(true);
    this.formError.set('');
    let gotNext = false;
    this.projectSession.create(name).subscribe({
      next: (project) => {
        gotNext = true;
        this.projectModalOpen.set(false);
        this.projectForm.reset({ name: '' });
        this.switchToCreatedProject(project.id);
      },
      error: (e) => {
        this.formError.set(
          e instanceof Error && e.message ? e.message : errorMessage(e),
        );
        this.saving.set(false);
      },
      complete: () => {
        if (!gotNext) {
          this.formError.set('作成できませんでした');
          this.saving.set(false);
        }
      },
    });
  }

  /** After create succeeds: switch active project; clear mutating as soon as switch starts. */
  private switchToCreatedProject(projectId: number) {
    let gotSwitched = false;
    this.projectSession.switchTo(projectId).subscribe({
      next: () => {
        gotSwitched = true;
        this.saving.set(false);
      },
      error: () => this.saving.set(false),
      complete: () => {
        if (!gotSwitched) {
          this.projectSession.error.set('切替できませんでした');
          this.saving.set(false);
        }
      },
    });
    this.projectSession.endMutating();
  }

  renameProject() {
    if (!this.projectSession.canRename()) return;
    const current = this.projectSession.projects().find((p) => p.id === this.projectSession.activeId());
    if (!current) return;
    const name = window.prompt('新しいプロジェクト名', current.name);
    if (name == null) return;
    this.projectSession.rename(current.id, name);
  }

  deleteProject() {
    if (!this.projectSession.canDelete()) return;
    const current = this.projectSession.projects().find((p) => p.id === this.projectSession.activeId());
    if (!current) return;
    const ok = window.confirm(
      `「${current.name}」を削除しますか？アイテムが無いプロジェクトだけ削除できます。`,
    );
    if (!ok) return;
    this.projectSession.delete(current.id);
  }
}
