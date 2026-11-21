import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Api } from './api';
import { errorMessage } from './api-error';
import {
  HeaderMenuItemId,
  PageKind,
  WorkspaceHeaderMenu,
  cloneHeaderMenuPagePrefs,
  cloneWorkspaceHeaderMenu,
  emptyWorkspaceHeaderMenu,
  isCatalogItemId,
  pagePrefsEqual,
} from './header-menu';

export const HEADER_MENU_LOAD_FAILURE = 'メニュー設定を読み込めませんでした。再試行してください。';
export const HEADER_MENU_SAVE_FAILURE = 'メニュー設定の保存に失敗しました。';

const SAVE_DEBOUNCE_MS = 300;

@Injectable({ providedIn: 'root' })
export class HeaderMenuSession {
  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);
  readonly prefs = signal<WorkspaceHeaderMenu>(emptyWorkspaceHeaderMenu());
  readonly loadError = signal('');
  readonly saveError = signal('');
  private confirmed: WorkspaceHeaderMenu = emptyWorkspaceHeaderMenu();
  private loadGeneration = 0;
  private saveGeneration = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private saveInFlight = false;
  private saveQueued = false;
  private hydrated = false;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.clearTimer();
      this.saveGeneration++;
      this.loadGeneration++;
      this.saveInFlight = false;
    });
  }

  pagePrefs(pageKind: PageKind) {
    return this.prefs()[pageKind];
  }

  load(options?: { force?: boolean }) {
    const force = options?.force === true;
    const hadQueuedSave = this.saveQueued || this.timer !== undefined;
    this.saveGeneration++;
    this.saveInFlight = false;
    if (force) {
      this.clearTimer();
      this.saveQueued = false;
    }
    const generation = ++this.loadGeneration;
    this.api.headerMenu().subscribe({
      next: (res) => {
        if (generation !== this.loadGeneration) return;
        const incoming = cloneWorkspaceHeaderMenu(res);
        const boardDirty = !force && this.isDirty('board');
        const backlogDirty = !force && this.isDirty('backlog');
        const itemDirty = !force && this.isDirty('itemDetail');
        const next = cloneWorkspaceHeaderMenu(incoming);
        if (boardDirty) next.board = cloneHeaderMenuPagePrefs(this.prefs().board);
        if (backlogDirty) next.backlog = cloneHeaderMenuPagePrefs(this.prefs().backlog);
        if (itemDirty) next.itemDetail = cloneHeaderMenuPagePrefs(this.prefs().itemDetail);
        this.confirmed = {
          board: boardDirty ? cloneHeaderMenuPagePrefs(this.confirmed.board) : cloneHeaderMenuPagePrefs(incoming.board),
          backlog: backlogDirty
            ? cloneHeaderMenuPagePrefs(this.confirmed.backlog)
            : cloneHeaderMenuPagePrefs(incoming.backlog),
          itemDetail: itemDirty
            ? cloneHeaderMenuPagePrefs(this.confirmed.itemDetail)
            : cloneHeaderMenuPagePrefs(incoming.itemDetail),
        };
        this.prefs.set(next);
        this.hydrated = true;
        this.loadError.set('');
        this.saveError.set('');
        if (boardDirty || backlogDirty || itemDirty || hadQueuedSave || this.saveQueued) {
          this.scheduleSave();
        }
      },
      error: () => {
        if (generation !== this.loadGeneration) return;
        this.loadError.set(HEADER_MENU_LOAD_FAILURE);
      },
    });
  }

  retryLoad() {
    this.load({ force: true });
  }

  setHidden(pageKind: PageKind, itemId: HeaderMenuItemId, hidden: boolean) {
    if (!isCatalogItemId(itemId)) return;
    this.prefs.update((p) => {
      const cur = p[pageKind];
      const has = cur.hiddenIds.includes(itemId);
      let hiddenIds = cur.hiddenIds;
      if (hidden && !has) {
        hiddenIds = [...cur.hiddenIds, itemId];
      } else if (!hidden && has) {
        hiddenIds = cur.hiddenIds.filter((id) => id !== itemId);
      }
      return { ...p, [pageKind]: { hiddenIds } };
    });
    this.afterLocalEdit(pageKind);
  }

  private afterLocalEdit(_pageKind: PageKind) {
    if (this.hydrated) {
      this.bumpLoadGeneration();
    }
    this.scheduleSave();
  }

  private isDirty(pageKind: PageKind): boolean {
    return !pagePrefsEqual(this.prefs()[pageKind], this.confirmed[pageKind]);
  }

  private bumpLoadGeneration() {
    this.loadGeneration++;
    this.saveGeneration++;
    this.saveInFlight = false;
  }

  private scheduleSave() {
    this.clearTimer();
    this.saveQueued = true;
    this.timer = setTimeout(() => this.flushSave(), SAVE_DEBOUNCE_MS);
  }

  private flushSave() {
    this.timer = undefined;
    if (!this.hydrated) return;
    const generation = ++this.saveGeneration;
    this.saveInFlight = true;
    const payload = cloneWorkspaceHeaderMenu(this.prefs());
    this.api.putHeaderMenu(payload).subscribe({
      next: (res) => {
        if (generation !== this.saveGeneration) return;
        this.saveInFlight = false;
        this.saveQueued = false;
        const next = cloneWorkspaceHeaderMenu(res);
        this.confirmed = next;
        this.prefs.set(cloneWorkspaceHeaderMenu(next));
        this.saveError.set('');
      },
      error: (error: unknown) => {
        if (generation !== this.saveGeneration) return;
        this.saveInFlight = false;
        this.saveQueued = false;
        this.prefs.set(cloneWorkspaceHeaderMenu(this.confirmed));
        this.saveError.set(errorMessage(error) || HEADER_MENU_SAVE_FAILURE);
      },
    });
  }

  private clearTimer() {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}