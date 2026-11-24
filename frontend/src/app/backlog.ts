import { Modal } from './modal';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  Injector,
  NgZone,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { Location, NgStyle } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { EMPTY, Observable, Subscription, finalize, firstValueFrom, forkJoin, map, mergeMap, tap } from 'rxjs';
import { mergeBacklogBoardPoll } from './backlog-board-poll';
import {
  ConditionalGetResult,
  resolveBacklogConditional,
  resolveBoardMetaConditional,
} from './conditional-get';
import { AiChatContext } from './ai-chat-context';
import { toAiChatOptions } from './ai-chat-target';
import { Api } from './api';
import { errorMessage } from './api-error';
import { AuthSession } from './auth-session';
import { computeAutoScrollDelta, computeDropSlot, moveItem, targetIndex } from './backlog-order';
import { applyBoardDataWithActiveSync } from './board-active-sync';
import { normalizeBoardMeta } from './board-data';
import { textLimit } from './form-validation';
import { formatItemNumber } from './item-number';
import { viewAccessLabel } from './item-acl';
import { itemAppPath, itemDetailUrl } from './item-link';
import {
  COMMAND_ITEM_MENU_EMPTY,
  CommandTemplate,
  resolveCommand,
} from './command-template';
import { AppOrigin } from './app-origin';
import { CopyCommandFeedback } from './copy-command-feedback';
import { CopyFeedbackBanner } from './copy-feedback-banner';
import { CopyLinkFeedback } from './copy-link-feedback';
import { LatestCopyFeedback } from './latest-copy-feedback';
import {
  scheduleScrollRestore,
} from './list-scroll-restore';
import { isUnmodifiedPrimaryClick } from './primary-click';
import {
  clearBacklogScroll,
  readBacklogScroll,
  saveBacklogScroll,
  saveReturnTo,
} from './list-scroll-session';
import { appliedListFilter, itemMatchesFilter, listFilterActive } from './list-filter';
import { ListFilterBar } from './list-filter-bar';
import { ListFilterSession } from './list-filter-session';
import { BoardMeta, Item, Column } from './models';
import { sameJson, startLiveRefresh, zoneAwareTimers } from './live-refresh';
import { itemsForActiveProject } from './project-items';
import { ProjectBoardCache } from './project-board-cache';
import { ProjectSession } from './project-session';
import { bindProjectSwitchReload } from './project-switch-reload';
import { TODO_COLUMN_MISSING, todoColumnId } from './todo-column';

@Component({
  selector: 'app-backlog',
  imports: [ReactiveFormsModule, RouterLink, Modal, ListFilterBar, CopyFeedbackBanner, NgStyle],
  templateUrl: './backlog.html',
  styleUrl: './backlog.css',
})
export class Backlog implements OnInit {
  readonly formatItemNumber = formatItemNumber;
  readonly viewAccessLabel = viewAccessLabel;
  private readonly api = inject(Api);
  private readonly auth = inject(AuthSession);
  private readonly aiChat = inject(AiChatContext);
  private readonly projectSession = inject(ProjectSession);
  private readonly projectBoardCache = inject(ProjectBoardCache);
  /** Template-safe busy flag while active project reload is in flight. */
  readonly projectSwitching = computed(() => this.projectSession.switching());
  private backlogLoadGeneration = 0;
  /** ETag by resource for fetchKey 0 on this page. */
  private backlogEtag = '';
  private boardMetaEtag = '';
  private projectSwitchSub?: Subscription;
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly appOrigin = inject(AppOrigin);
  private readonly copyStatus = new LatestCopyFeedback(this.destroyRef);
  private readonly linkCopy = new CopyLinkFeedback(this.destroyRef, this.copyStatus);
  private readonly commandCopy = new CopyCommandFeedback(this.destroyRef, this.copyStatus);
  readonly copyLinkAnnouncement = this.linkCopy.message;
  readonly copyCommandAnnouncement = this.commandCopy.message;
  readonly copyFeedback = this.copyStatus.message;
  readonly copyFeedbackKind = this.copyStatus.kind;
  readonly commandMenuEmpty = COMMAND_ITEM_MENU_EMPTY;
  readonly openCommandItemId = signal<number | null>(null);
  readonly commandMenuTemplates = signal<CommandTemplate[]>([]);
  readonly commandMenuError = signal('');
  readonly commandMenuLoading = signal(false);
  private commandMenuLoadGeneration = 0;
  readonly commandMenuStyle = signal<Record<string, string>>({});
  readonly listFilter = inject(ListFilterSession);
  private readonly backlogScroll = viewChild<ElementRef<HTMLElement>>('backlogScroll');
  private readonly listContainer = viewChild<ElementRef<HTMLElement>>('listContainer');
  private scrollRestoreGeneration = 0;
  private scrollRestoreAttempted = false;

  readonly items = signal<Item[]>([]);
  readonly columns = signal<Column[]>([]);
  readonly loading = signal(true);
  /**
   * True while the backlog of an earlier visit is on screen and the fresh one is still on its way
   * (`loading` stays true then, so editing and live refresh stay blocked until it arrives).
   */
  readonly showingCached = signal(false);
  readonly error = signal('');
  readonly saving = signal(false);
  readonly reordering = signal(false);
  readonly reorderError = signal('');
  readonly reorderConflict = signal(false);
  readonly reorderAnnouncement = signal('');
  readonly draggingItemId = signal<number | null>(null);
  readonly dropSlot = signal<number | null>(null);
  readonly modal = signal<'item' | null>(null);
  readonly formError = signal('');
  readonly appliedFilter = computed(() =>
    appliedListFilter(
      this.listFilter.filter('backlog'),
      this.columns().map((c) => c.id),
    ),
  );
  readonly activeItems = computed(() =>
    itemsForActiveProject(this.items(), this.projectSession.activeId()),
  );
  readonly filteredItems = computed(() => {
    const filter = this.appliedFilter();
    return this.activeItems().filter((card) => itemMatchesFilter(card, filter));
  });
  /** AC5: filter / live refresh で開中行が一覧から消えたらメニューを閉じ generation を進める */
  private readonly closeCommandMenuWhenRowHidden = effect(() => {
    const openId = this.openCommandItemId();
    if (openId === null) return;
    if (!this.filteredItems().some((card) => card.id === openId)) {
      this.closeCommandMenu();
    }
  });
  readonly filterActive = computed(() =>
    listFilterActive(
      this.appliedFilter(),
      this.columns().map((c) => c.id),
    ),
  );
  readonly canReorder = computed(
    () =>
      !this.loading() &&
      !this.saving() &&
      !this.reordering() &&
      !this.projectSession.switching() &&
      this.modal() === null &&
      this.filteredItems().length > 1 &&
      !this.filterActive(),
  );
  readonly columnName = computed(() => {
    const map = new Map<number, string>();
    for (const column of this.columns()) map.set(column.id, column.name);
    return map;
  });
  readonly itemForm = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [textLimit(200, true)] }),
    description: new FormControl('', { nonNullable: true, validators: [textLimit(10000)] }),
  });

  private readonly publishAiChatCandidates = effect(() => {
    this.aiChat.setBacklog(toAiChatOptions(this.activeItems(), this.auth.user()));
  });

  ngOnInit() {
    this.load({ useCache: true });
    this.listFilter.load();
    bindProjectSwitchReload(this.projectSession, this.destroyRef, () => this.reloadAfterProjectSwitch());
    this.destroyRef.onDestroy(() => {
      this.scrollRestoreGeneration++;
      this.backlogLoadGeneration++;
      this.closeCommandMenu();
      this.projectSwitchSub?.unsubscribe();
      // Navigating away mid-switch must not leave the board stuck in `switching`.
      this.projectSession.endSwitch();
      if (this.aiChat.pageKind() === 'backlog') this.aiChat.clear();
    });
    const stop = startLiveRefresh({
      enabled: () =>
        !this.loading() &&
        !this.reordering() &&
        !this.saving() &&
        !this.projectSession.switching() &&
        this.modal() === null &&
        this.draggingItemId() === null,
      fetch: () => this.pollBacklogBoard(),
      apply: ({ items, columns }) => {
        this.error.set('');
        const itemsChanged = !sameJson(this.items(), items);
        const columnsChanged = !sameJson(this.columns(), columns);
        if (itemsChanged || columnsChanged) this.rememberBacklogCache(items, columns);
        if (itemsChanged) this.items.set(items);
        if (columnsChanged) this.columns.set(columns);
      },
      ...zoneAwareTimers(this.zone),
    });
    this.destroyRef.onDestroy(stop);
  }

  private scheduleBacklogScrollRestore() {
    if (this.scrollRestoreAttempted) return;
    const saved = readBacklogScroll();
    if (!saved) return;
    this.scrollRestoreAttempted = true;
    const generation = ++this.scrollRestoreGeneration;
    // Baseline at schedule time — not saved values (mount is 0, saved is not).
    scheduleScrollRestore({
      shouldApply: () =>
        generation === this.scrollRestoreGeneration && !this.destroyRef.destroyed,
      injector: this.injector,
      captureBaseline: () => {
        const el = this.backlogScroll()?.nativeElement;
        return [el?.scrollTop ?? 0, el?.scrollLeft ?? 0];
      },
      readCurrent: () => {
        const elNow = this.backlogScroll()?.nativeElement;
        if (!elNow) return [null, null];
        return [elNow.scrollTop, elNow.scrollLeft];
      },
      targets: [saved.scrollTop, saved.scrollLeft],
      apply: ([scrollTop, scrollLeft]) => {
        const elNow = this.backlogScroll()?.nativeElement;
        if (elNow) {
          elNow.scrollTop = scrollTop;
          elNow.scrollLeft = scrollLeft;
        }
        clearBacklogScroll();
      },
      onSkipped: () => clearBacklogScroll(),
    });
  }

  /** `useCache`: on first entry, show the backlog of the earlier visit while the fresh one loads. */
  load(options: { useCache?: boolean } = {}) {
    this.closeCommandMenu();
    const generation = ++this.backlogLoadGeneration;
    this.loading.set(true);
    this.showCachedBacklog(options.useCache === true);
    this.error.set('');
    this.reorderError.set('');
    this.reorderConflict.set(false);
    this.backlogEtag = '';
    this.boardMetaEtag = '';
    forkJoin({
      backlog: this.backlogGetConditional(),
      board: this.boardMetaGetConditional(),
    })
      .pipe(
        finalize(() => {
          if (generation !== this.backlogLoadGeneration) return;
          this.loading.set(false);
          this.showingCached.set(false);
        }),
      )
      .subscribe({
        next: ({ backlog, board }) => {
          if (generation !== this.backlogLoadGeneration) return;
          if (backlog.status !== 'ok' || board.status !== 'ok') return;
          this.rememberEtagsFromOk(backlog, board);
          const normalized = normalizeBoardMeta(board.body);
          applyBoardDataWithActiveSync(this.projectSession, normalized, (meta) => {
            this.rememberBacklogCache(backlog.body.items, meta.columns);
            // Unchanged since the cached view: skip rebuilding every card.
            if (!sameJson(this.items(), backlog.body.items)) this.items.set(backlog.body.items);
            if (!sameJson(this.columns(), meta.columns)) this.columns.set(meta.columns);
            // Schedule after data arrives so the first afterNextRender sees .backlog-scroll
            // (not the loading-only first paint).
            this.scheduleBacklogScrollRestore();
          });
        },
        error: (e) => {
          if (generation !== this.backlogLoadGeneration) return;
          // The error panel replaces the cached backlog; the AI chat candidates are built from items(),
          // so nothing stale may stay in it.
          if (this.showingCached()) {
            this.items.set([]);
            this.columns.set([]);
          }
          this.error.set(errorMessage(e));
        },
      });
  }

  /**
   * Puts the backlog of the earlier visit on screen at once (no loading panel). Needs the items and
   * the columns they were loaded with; anything less falls back to the loading panel.
   */
  private showCachedBacklog(useCache: boolean) {
    this.showingCached.set(false);
    if (!useCache) return;
    const activeId = this.projectSession.activeId();
    // Unlike the board, the cache is keyed by project and holds no settings that could name another one.
    if (activeId == null || this.projectSession.switching()) return;
    const view = this.projectBoardCache.getBacklogView(activeId);
    if (!view) return;
    this.items.set(view.items);
    this.columns.set(view.columns);
    this.showingCached.set(true);
    this.scheduleBacklogScrollRestore();
  }

  /** ETag keys use fetchKey 0 (backlog page does not pass projectId). */
  private pollBacklogBoard(): Observable<{ items: Item[]; columns: Column[] }> {
    const prev = { items: this.items(), columns: this.columns() };
    return forkJoin({
      backlog: this.backlogGetConditional(this.backlogEtag || null),
      board: this.boardMetaGetConditional(this.boardMetaEtag || null),
    }).pipe(
      tap(({ backlog, board }) => this.rememberEtagsFromOk(backlog, board)),
      map(({ backlog, board }) => mergeBacklogBoardPoll(prev, backlog, board)),
      mergeMap((merged) => (merged ? [merged] : EMPTY)),
    );
  }

  /** 列と設定だけ（アイテム本体は backlog 側から取る）。GET /api/board/meta。 */
  private boardMetaGetConditional(
    etag?: string | null,
  ): Observable<ConditionalGetResult<BoardMeta>> {
    return resolveBoardMetaConditional(this.api, etag);
  }

  private backlogGetConditional(
    etag?: string | null,
  ): Observable<ConditionalGetResult<{ items: Item[] }>> {
    return resolveBacklogConditional(this.api, undefined, etag);
  }

  private rememberEtagsFromOk(
    backlog: ConditionalGetResult<{ items: Item[] }>,
    board: ConditionalGetResult<BoardMeta>,
  ) {
    if (backlog.status === 'ok' && backlog.etag) this.backlogEtag = backlog.etag;
    if (board.status === 'ok' && board.etag) this.boardMetaEtag = board.etag;
  }

  /**
   * Reload after ProjectSession.switchTo. `switching` stays true until this
   * request settles so a poll of the previous project cannot apply (L-040).
   */
  private reloadAfterProjectSwitch() {
    this.closeCommandMenu();
    const generation = ++this.backlogLoadGeneration;
    // The cached view of the old project must not stay on screen next to the new project's items.
    this.showingCached.set(false);
    const activeId = this.projectSession.activeId();
    const cached = activeId != null ? this.projectBoardCache.getBacklog(activeId) : undefined;
    if (cached) {
      this.items.set(cached);
    }
    this.projectSwitchSub?.unsubscribe();
    this.backlogEtag = '';
    this.boardMetaEtag = '';
    this.projectSwitchSub = forkJoin({
      backlog: this.backlogGetConditional(),
      board: this.boardMetaGetConditional(),
    })
      .pipe(
        finalize(() => {
          if (generation !== this.backlogLoadGeneration) return;
          this.loading.set(false);
          this.projectSession.endSwitch();
        }),
      )
      .subscribe({
        next: ({ backlog, board }) => {
          if (generation !== this.backlogLoadGeneration) return;
          if (backlog.status !== 'ok' || board.status !== 'ok') return;
          this.rememberEtagsFromOk(backlog, board);
          this.error.set('');
          const normalized = normalizeBoardMeta(board.body);
          applyBoardDataWithActiveSync(this.projectSession, normalized, (meta) => {
            this.rememberBacklogCache(backlog.body.items, meta.columns);
            this.items.set(backlog.body.items);
            this.columns.set(meta.columns);
          });
        },
        error: (e) => {
          if (generation !== this.backlogLoadGeneration) return;
          this.error.set(errorMessage(e));
        },
      });
  }

  private rememberBacklogCache(items: Item[], columns: Column[]) {
    const activeId = this.projectSession.activeId();
    if (activeId != null && activeId > 0) {
      this.projectBoardCache.putBacklog(activeId, items, columns);
    }
  }

  async copyItemLink(number: number, projectId?: number) {
    const origin = await this.appOrigin.resolve();
    const scopedProjectId = projectId && projectId > 0 ? projectId : undefined;
    return this.linkCopy.copyItemNumber(number, origin, scopedProjectId);
  }

  toggleCommandMenu(itemId: number, itemNumber: number, projectId: number, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    const opening = this.openCommandItemId() !== itemId;
    if (!opening) {
      this.closeCommandMenu();
      return;
    }
    const button = event.currentTarget;
    if (!(button instanceof HTMLElement)) return;
    const generation = ++this.commandMenuLoadGeneration;
    const scopedProjectId = projectId > 0 ? projectId : undefined;
    const listPromise = firstValueFrom(
      this.api.listItemCommandTemplatesByNumber(itemNumber, scopedProjectId),
    );

    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const textPromise = listPromise.then(async (res) => {
        const templates = res?.templates ?? [];
        if (templates.length !== 1) {
          throw new Error('not-single');
        }
        const origin = await this.appOrigin.resolve();
        return resolveCommand(
          templates[0].template,
          itemDetailUrl(origin, itemNumber, scopedProjectId),
        );
      });
      void navigator.clipboard
        .write([new ClipboardItem({ 'text/plain': textPromise })])
        .then(() => {
          this.zone.run(() => {
            if (generation !== this.commandMenuLoadGeneration) return;
            this.commandCopy.announce(true);
            this.closeCommandMenu();
          });
        })
        .catch(() => {
          this.zone.run(() => {
            if (generation !== this.commandMenuLoadGeneration) return;
            this.openCommandMenuAfterList(
              itemId,
              itemNumber,
              scopedProjectId,
              button,
              generation,
              listPromise,
            );
          });
        });
      return;
    }

    this.openCommandMenuAfterList(
      itemId,
      itemNumber,
      scopedProjectId,
      button,
      generation,
      listPromise,
    );
  }

  private openCommandMenuAfterList(
    itemId: number,
    itemNumber: number,
    projectId: number | undefined,
    button: HTMLElement,
    generation: number,
    listPromise: Promise<{ templates?: CommandTemplate[] }>,
  ) {
    this.commandMenuStyle.set({});
    this.commandMenuTemplates.set([]);
    this.commandMenuError.set('');
    this.commandMenuLoading.set(true);
    this.openCommandItemId.set(itemId);
    void listPromise.then(
      (res) => {
        this.zone.run(() => {
          if (generation !== this.commandMenuLoadGeneration || this.openCommandItemId() !== itemId) {
            return;
          }
          const templates = res?.templates ?? [];
          this.commandMenuTemplates.set(templates);
          this.commandMenuError.set('');
          this.commandMenuLoading.set(false);
          if (templates.length === 1) {
            void this.closeMenuAndCopyCommand(templates[0].template, itemNumber, projectId);
          }
        });
      },
      (error) => {
        this.zone.run(() => {
          if (generation !== this.commandMenuLoadGeneration || this.openCommandItemId() !== itemId) {
            return;
          }
          this.commandMenuTemplates.set([]);
          this.commandMenuError.set(errorMessage(error));
          this.commandMenuLoading.set(false);
        });
      },
    );
    afterNextRender(
      () => {
        if (this.openCommandItemId() !== itemId) return;
        this.commandMenuStyle.set(this.fixedCommandMenuStyle(button));
      },
      { injector: this.injector },
    );
  }

  private fixedCommandMenuStyle(button: HTMLElement): Record<string, string> {
    const rect = button.getBoundingClientRect();
    const menuMax = 240;
    const gap = 4;
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const openUp = spaceBelow < menuMax && rect.top > spaceBelow;
    return openUp
      ? {
          top: 'auto',
          bottom: `${Math.max(8, window.innerHeight - rect.top + gap)}px`,
          left: 'auto',
          right: `${Math.max(8, window.innerWidth - rect.right)}px`,
        }
      : {
          top: `${rect.bottom + gap}px`,
          bottom: 'auto',
          left: 'auto',
          right: `${Math.max(8, window.innerWidth - rect.right)}px`,
        };
  }

  private closeCommandMenu() {
    this.commandMenuLoadGeneration++;
    this.openCommandItemId.set(null);
    this.commandMenuStyle.set({});
    this.commandMenuTemplates.set([]);
    this.commandMenuError.set('');
    this.commandMenuLoading.set(false);
  }

  async copyCommand(
    templateText: string,
    number: number,
    projectId: number | undefined,
    event: Event,
  ) {
    event.preventDefault();
    event.stopPropagation();
    return this.closeMenuAndCopyCommand(templateText, number, projectId);
  }

  private async closeMenuAndCopyCommand(
    templateText: string,
    number: number,
    projectId?: number,
  ) {
    this.closeCommandMenu();
    const origin = await this.appOrigin.resolve();
    const scopedProjectId = projectId && projectId > 0 ? projectId : undefined;
    return this.commandCopy.copyResolved(templateText, number, origin, scopedProjectId);
  }

  @HostListener('document:click', ['$event'])
  closeCommandMenuFromPointer(event: Event) {
    const target = event.target;
    if (target instanceof Element && target.closest('.copy-command')) return;
    this.closeCommandMenu();
  }

  @HostListener('document:keydown.escape')
  closeCommandMenuFromKeyboard() {
    this.closeCommandMenu();
  }

  @HostListener('window:resize')
  @HostListener('window:scroll')
  closeCommandMenuOnViewportChange() {
    if (this.openCommandItemId() === null) return;
    this.closeCommandMenu();
  }

  closeCommandMenuOnBacklogScroll() {
    if (this.openCommandItemId() === null) return;
    this.closeCommandMenu();
  }

  preventCopyDrag(event: DragEvent) {
    event.preventDefault();
  }

  /** Real URL so modifier-clicks / copy-link keep working via href. */
  itemHref(card: Item): string {
    const projectId = card.projectId > 0 ? card.projectId : undefined;
    return this.location.prepareExternalUrl(itemAppPath(card.number, projectId));
  }

  onDetailClick(event: MouseEvent, card: Item) {
    if (!isUnmodifiedPrimaryClick(event)) {
      return;
    }
    event.preventDefault();
    const el = this.backlogScroll()?.nativeElement;
    saveBacklogScroll({
      scrollTop: el?.scrollTop ?? 0,
      scrollLeft: el?.scrollLeft ?? 0,
    });
    saveReturnTo('/backlog');
    if (card.projectId > 0) {
      void this.router.navigate(['/items', card.number], {
        queryParams: { project: card.projectId },
      });
    } else {
      void this.router.navigate(['/items', card.number]);
    }
  }

  statusName(columnId: number): string {
    return this.columnName().get(columnId) ?? '不明';
  }

  openItem() {
    if (
      this.loading() ||
      this.reordering() ||
      this.saving() ||
      this.projectSession.switching() ||
      this.error() ||
      this.columns().length === 0
    ) {
      return;
    }
    this.itemForm.reset({ title: '', description: '' });
    this.formError.set('');
    this.modal.set('item');
  }

  close() {
    if (!this.saving()) this.modal.set(null);
  }

  dismissReorderError() {
    if (this.reorderConflict()) return;
    this.reorderError.set('');
  }

  addItem() {
    if (this.itemForm.invalid || this.saving() || this.projectSession.switching()) {
      this.itemForm.markAllAsTouched();
      return;
    }
    const todoId = todoColumnId(this.columns());
    if (todoId == null) {
      this.formError.set(TODO_COLUMN_MISSING);
      return;
    }
    this.saving.set(true);
    this.formError.set('');
    const value = this.itemForm.getRawValue();
    this.itemForm.disable({ emitEvent: false });
    this.api
      .createItem({ ...value, title: value.title.trim(), columnId: todoId })
      .pipe(
        finalize(() => {
          this.saving.set(false);
          this.itemForm.enable({ emitEvent: false });
        }),
      )
      .subscribe({
        next: (card) => {
          this.items.update((list) => [...list, card]);
          this.modal.set(null);
        },
        error: (e) => this.formError.set(errorMessage(e)),
      });
  }

  onItemDragStart(event: DragEvent, card: Item, rowEl: HTMLElement) {
    const target = event.target instanceof Element ? event.target : null;
    if (
      !this.canReorder() ||
      !target ||
      target.closest('.backlog-detail-link') ||
      target.closest('.copy-command') ||
      target.closest('.copy-card-link')
    ) {
      event.preventDefault();
      return;
    }
    this.draggingItemId.set(card.id);
    this.dropSlot.set(null);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(card.id));
      const rect = rowEl.getBoundingClientRect();
      event.dataTransfer.setDragImage?.(
        rowEl,
        Math.max(0, event.clientX - rect.left),
        Math.max(0, event.clientY - rect.top),
      );
    }
  }

  onListDragOver(event: DragEvent) {
    const draggingId = this.draggingItemId();
    if (draggingId === null) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    const scrollEl = this.backlogScroll()?.nativeElement;
    if (scrollEl) {
      const scrollRect = scrollEl.getBoundingClientRect();
      const delta = computeAutoScrollDelta(event.clientY, scrollRect.top, scrollRect.bottom);
      if (delta !== 0) scrollEl.scrollTop += delta;
    }
    const slot = this.computeSlotFromPointer(event.clientY);
    if (slot === null) return;
    const cards = this.items();
    const fromIndex = cards.findIndex((c) => c.id === draggingId);
    const to = targetIndex(fromIndex, slot, cards.length);
    this.dropSlot.set(to === null ? null : slot);
  }

  onListDragLeave(event: DragEvent) {
    const scrollEl = this.backlogScroll()?.nativeElement;
    if (!scrollEl) return;
    if (!scrollEl.contains(event.relatedTarget as Node | null)) {
      this.dropSlot.set(null);
    }
  }

  onListDrop(event: DragEvent) {
    const draggingId = this.draggingItemId();
    if (draggingId === null) return;
    event.preventDefault();
    const slot = this.dropSlot() ?? this.computeSlotFromPointer(event.clientY);
    this.resetDragState();
    if (slot === null || !this.canReorder()) return;
    const cards = this.items();
    const fromIndex = cards.findIndex((c) => c.id === draggingId);
    const toIndex = targetIndex(fromIndex, slot, cards.length);
    if (toIndex !== null) {
      this.applyReorder(fromIndex, toIndex);
    }
  }

  onItemDragEnd() {
    this.resetDragState();
  }

  onRankKeydown(event: KeyboardEvent, cardIndex: number) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const cards = this.items();
    if (!this.canReorder() || cardIndex < 0 || cardIndex >= cards.length) return;
    const toIndex = event.key === 'ArrowUp' ? cardIndex - 1 : cardIndex + 1;
    if (toIndex < 0 || toIndex >= cards.length) return;
    event.preventDefault();
    this.applyReorder(cardIndex, toIndex, cards[cardIndex].id);
  }

  private computeSlotFromPointer(clientY: number): number | null {
    const container = this.listContainer()?.nativeElement;
    if (!container) return null;
    const bounds = Array.from(container.querySelectorAll<HTMLElement>('.backlog-row')).map((el) => {
      const rect = el.getBoundingClientRect();
      return { top: rect.top, height: rect.height };
    });
    return computeDropSlot(clientY, bounds);
  }

  private resetDragState() {
    this.draggingItemId.set(null);
    this.dropSlot.set(null);
  }

  private applyReorder(fromIndex: number, toIndex: number, focusItemId?: number) {
    const previous = this.items();
    if (
      this.reordering() ||
      fromIndex < 0 ||
      fromIndex >= previous.length ||
      toIndex < 0 ||
      toIndex >= previous.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const next = moveItem(previous, fromIndex, toIndex);
    const moved = next[toIndex];
    const restoreFocus = () => {
      if (focusItemId !== undefined) this.focusRankAfterRender(focusItemId);
    };
    this.reordering.set(true);
    this.reorderError.set('');
    this.reorderConflict.set(false);
    this.items.set(next);
    restoreFocus();

    this.api
      .reorderBacklog(next.map((c) => c.id))
      .pipe(finalize(() => this.reordering.set(false)))
      .subscribe({
        next: (res) => {
          this.items.set(res.items);
          this.reorderAnnouncement.set(`${formatItemNumber(moved.number)} を${toIndex + 1}番目に移動しました`);
          restoreFocus();
        },
        error: (e) => {
          this.items.set(previous);
          this.reorderError.set(errorMessage(e));
          this.reorderConflict.set((e as { status?: number } | null)?.status === 409);
          this.reorderAnnouncement.set('バックログの移動を保存できませんでした');
          restoreFocus();
        },
      });
  }

  private focusRankAfterRender(cardId: number) {
    if (this.destroyRef.destroyed || this.modal() !== null) return;
    afterNextRender(
      () => {
        if (this.destroyRef.destroyed || this.modal() !== null) return;
        const container = this.listContainer()?.nativeElement;
        if (!container) return;
        const ranks = Array.from(
          container.querySelectorAll<HTMLButtonElement>('.backlog-rank'),
        );
        const target = ranks.find(
          (el) => Number(el.closest('[data-card-id]')?.getAttribute('data-card-id')) === cardId,
        );
        if (!target) return;
        target.focus();
        target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      },
      { injector: this.injector },
    );
  }
}
