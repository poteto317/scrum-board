import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  inject,
  input,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import {
  catalogForPageKind,
  catalogLabel,
  HeaderMenuItemId,
  PageKind,
  projectMenuActionDisabled,
  resolvePageKind,
  visibleMenuItemIds,
} from './header-menu';
import { HeaderMenuSession } from './header-menu-session';
import { ItemMenuActions } from './item-menu-actions';

type MenuView = 'actions' | 'settings';

@Component({
  selector: 'app-header-menu',
  imports: [],
  templateUrl: './header-menu.component.html',
  styleUrl: './header-menu.component.css',
})
export class HeaderMenu implements OnInit {
  readonly projectSwitching = input(false);
  readonly projectMutating = input(false);
  readonly projectCanRename = input(false);
  readonly projectCanDelete = input(false);
  readonly projectSaving = input(false);
  readonly projectModalOpen = input(false);

  readonly addProject = output<void>();
  readonly renameProject = output<void>();
  readonly deleteProject = output<void>();

  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly session = inject(HeaderMenuSession);
  readonly itemActions = inject(ItemMenuActions);

  readonly open = signal(false);
  readonly view = signal<MenuView>('actions');
  readonly pageKind = signal<PageKind | null>(null);
  readonly settingsPageKind = signal<PageKind>('board');

  private readonly popoverRef = viewChild<ElementRef<HTMLElement>>('popover');
  private readonly triggerRef = viewChild<ElementRef<HTMLButtonElement>>('trigger');

  readonly pageKindOptions: PageKind[] = ['board', 'backlog', 'itemDetail'];
  readonly pageKindLabels: Record<PageKind, string> = {
    board: 'ボード',
    backlog: 'バックログ',
    itemDetail: 'アイテム詳細',
  };

  ngOnInit() {
    this.syncPageKind(this.router.url);
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((e) => this.syncPageKind(e.urlAfterRedirects));

    this.destroyRef.onDestroy(() => this.close());
  }

  private syncPageKind(url: string) {
    const kind = resolvePageKind(url);
    this.pageKind.set(kind);
    if (kind) {
      this.settingsPageKind.set(kind);
    }
  }

  toggle() {
    if (this.open()) {
      this.close();
    } else {
      this.openMenu();
    }
  }

  openMenu() {
    this.view.set('actions');
    this.open.set(true);
    requestAnimationFrame(() => this.focusFirstInPopover());
  }

  close() {
    this.open.set(false);
    this.view.set('actions');
    const trigger = this.triggerRef()?.nativeElement;
    trigger?.focus();
  }

  openSettings() {
    const kind = this.pageKind();
    this.settingsPageKind.set(kind ?? 'board');
    this.view.set('settings');
    requestAnimationFrame(() => this.focusFirstInPopover());
  }

  backToActions() {
    this.view.set('actions');
    requestAnimationFrame(() => this.focusFirstInPopover());
  }

  visibleIds(): HeaderMenuItemId[] {
    const kind = this.pageKind();
    if (!kind) return [];
    return visibleMenuItemIds(kind, this.session.pagePrefs(kind));
  }

  settingsCatalog() {
    return catalogForPageKind(this.settingsPageKind());
  }

  itemLabel(id: HeaderMenuItemId): string {
    return catalogLabel(id, this.pageKind(), {
      favoriteDynamic: this.itemActions.favoriteLabel(),
    });
  }

  settingsLabel(id: HeaderMenuItemId): string {
    return catalogLabel(id, this.settingsPageKind());
  }

  isItemVisible(id: HeaderMenuItemId): boolean {
    const kind = this.settingsPageKind();
    return !this.session.pagePrefs(kind).hiddenIds.includes(id);
  }

  onSettingsToggle(id: HeaderMenuItemId, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.session.setHidden(this.settingsPageKind(), id, !checked);
  }

  onSelectSettingsPageKind(event: Event) {
    const value = (event.target as HTMLSelectElement).value as PageKind;
    this.settingsPageKind.set(value);
  }

  projectActionDisabled(id: HeaderMenuItemId): boolean {
    return projectMenuActionDisabled(id, {
      switching: this.projectSwitching(),
      mutating: this.projectMutating(),
      saving: this.projectSaving(),
      modalOpen: this.projectModalOpen(),
      canRename: this.projectCanRename(),
      canDelete: this.projectCanDelete(),
    });
  }

  itemActionDisabled(id: HeaderMenuItemId): boolean {
    if (!this.itemActions.registered()) return true;
    if (id === 'item_favorite') {
      return this.itemActions.favoriteDisabled();
    }
    return false;
  }

  runAction(id: HeaderMenuItemId, run: () => void) {
    if (this.actionDisabled(id)) return;
    run();
    this.close();
  }

  onActionClick(id: HeaderMenuItemId) {
    if (this.actionDisabled(id)) return;
    switch (id) {
      case 'project_add':
        this.runAction(id, () => this.addProject.emit());
        break;
      case 'project_rename':
        this.runAction(id, () => this.renameProject.emit());
        break;
      case 'project_delete':
        this.runAction(id, () => this.deleteProject.emit());
        break;
      case 'open_trash':
        this.runAction(id, () => {
          void this.router.navigate(['/trash']);
        });
        break;
      case 'open_users':
        this.runAction(id, () => {
          void this.router.navigate(['/users']);
        });
        break;
      case 'open_recurring':
        this.runAction(id, () => {
          void this.router.navigate(['/recurring']);
        });
        break;
      case 'open_settings':
        this.runAction(id, () => {
          void this.router.navigate(['/settings']);
        });
        break;
      case 'item_history':
        this.runAction(id, () => this.itemActions.scrollToHistory());
        break;
      case 'item_solution':
        this.runAction(id, () => {
          this.itemActions.goToSolution();
        });
        break;
      case 'item_favorite':
        this.runAction(id, () => this.itemActions.toggleFavorite());
        break;
      default:
        break;
    }
  }

  actionDisabled(id: HeaderMenuItemId): boolean {
    if (
      id === 'open_trash' ||
      id === 'open_users' ||
      id === 'open_recurring' ||
      id === 'open_settings'
    ) {
      return this.projectSwitching();
    }
    if (id.startsWith('project_')) {
      return this.projectActionDisabled(id);
    }
    return this.itemActionDisabled(id);
  }

  @HostListener('document:keydown.escape')
  onEsc() {
    if (this.open()) this.close();
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDown(event: MouseEvent) {
    if (!this.open()) return;
    const root = this.popoverRef()?.nativeElement?.parentElement;
    if (!root?.contains(event.target as Node)) {
      this.close();
    }
  }

  private focusFirstInPopover() {
    const pop = this.popoverRef()?.nativeElement;
    if (!pop) return;
    const focusable = pop.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
  }
}