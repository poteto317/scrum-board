import { Modal } from './modal';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
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
import { Router } from '@angular/router';
import {
  CDK_DRAG_CONFIG,
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDragStart,
  CdkDropList,
} from '@angular/cdk/drag-drop';
import { filter, finalize, firstValueFrom, map } from 'rxjs';
import { Api } from './api';
import { errorMessage } from './api-error';
import { assigneeKind } from './assignee';
import { itemAppPath, itemDetailUrl } from './item-link';
import { normalizeBoardData, NormalizedBoardData, normalizeItem } from './board-data';
import {
  applyBoardMobileSettings,
  boardMobileMediaQuery,
  resolveMobileColumnId,
  visibleMobileColumns,
  withResolvedMobileColumnId,
} from './board-mobile';
import { saveMobileBoardColumn } from './board-mobile-settings';
import { cardLayoutToggleGate } from './board-layout-settings';
import {
  measurePackOffsetsAsItems,
  scheduleCardHeightMeasure,
} from './board-layout-measure';
import { switchFreeToPack, switchPackToFree } from './board-layout-switch';
import { computeFreeOffsetY, freeListMinHeightPx, pointerClientY } from './board-layout-y';
import {
  affectedColumnIds,
  applyFreeItemDrop,
  applyItemDrop,
  buildItemOrderPayload,
  ItemOrderColumn,
  ITEM_AUTO_SCROLL_INTERVAL_MS,
  ITEM_DRAG_THRESHOLD_PX,
  ITEM_TOUCH_DRAG_DELAY_MS,
  columnIdFromDropListId,
  dropListIdForColumn,
  sortColumnItems,
} from './item-order';
import {
  computeAutoScrollDelta,
  computeDropSlot,
  moveColumn,
  targetColumnIndex,
} from './column-order';
import { textLimit } from './form-validation';
import { formatItemNumber } from './item-number';
import { CardLayout, Item, Column } from './models';
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
import { sameJson, startLiveRefresh, zoneAwareTimers } from './live-refresh';
import {
  scheduleScrollRestore,
} from './list-scroll-restore';
import { isUnmodifiedPrimaryClick } from './primary-click';
import {
  clearBoardScroll,
  readBoardScroll,
  saveBoardScroll,
  saveReturnTo,
} from './list-scroll-session';
import { appliedListFilter, itemMatchesFilter, listFilterActive } from './list-filter';
import { ListFilterBar } from './list-filter-bar';
import { ListFilterSession } from './list-filter-session';
import { autoScrollPageVertically, pageScrollElement } from './page-scroll';
import { TODO_COLUMN_MISSING, todoColumnId } from './todo-column';

@Component({
  selector: 'app-board',
  imports: [
    ReactiveFormsModule,
    Modal,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    NgStyle,
    CopyFeedbackBanner,
    ListFilterBar,
  ],
  templateUrl: './board.html',
  styleUrl: './board.css',
  providers: [
    {
      provide: CDK_DRAG_CONFIG,
      useValue: {
        dragStartThreshold: ITEM_DRAG_THRESHOLD_PX,
        dragStartDelay: { touch: ITEM_TOUCH_DRAG_DELAY_MS, mouse: 0 },
      },
    },
  ],
})
export class Board implements OnInit {
  readonly formatItemNumber = formatItemNumber;
  readonly assigneeKind = assigneeKind;
  private readonly api = inject(Api);
  private readonly appOrigin = inject(AppOrigin);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  readonly listFilter = inject(ListFilterSession);
  private readonly boardScroll = viewChild<ElementRef<HTMLElement>>('boardScroll');
  private readonly columnsContainer = viewChild<ElementRef<HTMLElement>>('columnsContainer');
  private scrollRestoreGeneration = 0;
  private scrollRestoreAttempted = false;

  readonly data = signal<NormalizedBoardData>(normalizeBoardData({ columns: [], items: [] }));
  readonly loading = signal(true);
  readonly error = signal('');
  readonly saving = signal(false);
  readonly reordering = signal(false);
  readonly settingsSaving = signal(false);
  readonly layoutSwitching = signal(false);
  readonly reorderError = signal('');
  readonly reorderConflict = signal(false);
  readonly reorderAnnouncement = signal('');
  private readonly copyStatus = new LatestCopyFeedback(this.destroyRef);
  private readonly linkCopy = new CopyLinkFeedback(this.destroyRef, this.copyStatus);
  private readonly commandCopy = new CopyCommandFeedback(this.destroyRef, this.copyStatus);
  private autoScrollTimer: ReturnType<typeof setInterval> | null = null;
  private dragPointer: { x: number; y: number } | null = null;
  private dragMovedSinceTick = false;
  private itemDragGrabOffsetY = 0;
  private readonly cardHeights = signal<ReadonlyMap<number, number>>(new Map());
  private readonly stopAutoScrollOnDestroy = this.destroyRef.onDestroy(() =>
    this.stopAutoScrollTimer(),
  );
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
  /** Viewport-fixed coords so the menu is not clipped by `.board-scroll` overflow. */
  readonly commandMenuStyle = signal<Record<string, string>>({});
  readonly draggingColumnId = signal<number | null>(null);
  /**
   * The card CDK is dragging: from (cdkDragStarted) until (cdkDragEnded), which CDK emits only after the preview has
   * settled (up to ~300ms after the pointer was let go) and just before the drop. CDK reports the drop's indexes
   * against the list as it was when the drag began, so the board must not be replaced while this is set.
   */
  readonly draggingItemId = signal<number | null>(null);
  readonly dropSlot = signal<number | null>(null);
  readonly modal = signal<'column' | 'item' | null>(null);
  readonly formError = signal('');
  readonly isBoardMobile = signal(false);
  readonly canReorder = computed(
    () =>
      !this.isBoardMobile() &&
      !this.loading() &&
      !this.saving() &&
      !this.reordering() &&
      !this.layoutSwitching() &&
      !this.settingsSaving() &&
      this.modal() === null &&
      this.data().columns.length > 1,
  );
  readonly filterActive = computed(() =>
    listFilterActive(
      this.appliedFilter(),
      this.data().columns.map((c) => c.id),
    ),
  );
  readonly canReorderItems = computed(
    () =>
      !this.loading() &&
      !this.saving() &&
      !this.reordering() &&
      !this.layoutSwitching() &&
      !this.settingsSaving() &&
      this.modal() === null &&
      !this.filterActive(),
  );
  readonly cardLayout = computed(() =>
    this.data().settings.cardLayout === 'free' ? 'free' : 'pack',
  );
  /** Effective layout: mobile 1-column mode always pack (persisted cardLayout unchanged). */
  readonly isFreeLayout = computed(() => !this.isBoardMobile() && this.cardLayout() === 'free');
  readonly selectedMobileColumnId = computed(() =>
    resolveMobileColumnId(this.data().settings.mobileBoardColumnId, this.data().columns),
  );
  readonly visibleColumns = computed(() =>
    visibleMobileColumns(
      this.data().columns,
      this.isBoardMobile(),
      this.selectedMobileColumnId(),
    ),
  );
  readonly boardLoadState = computed(() => {
    if (this.loading()) return 'loading' as const;
    if (this.error()) return 'failed' as const;
    return 'ready' as const;
  });
  readonly layoutToggleGate = computed(() =>
    cardLayoutToggleGate({
      boardLoad: this.boardLoadState(),
      settingsSave: this.settingsSaving() ? 'saving' : 'idle',
      itemReorder: this.reordering() ? 'saving' : 'idle',
      layoutSwitchSeq: this.layoutSwitching() ? 'in progress' : 'idle',
      itemDragging: this.draggingItemId() !== null ? 'dragging' : 'idle',
    }),
  );
  readonly canToggleCardLayout = computed(() => this.layoutToggleGate().allowed);
  readonly dropListIds = computed(() => this.visibleColumns().map((c) => this.dropListId(c.id)));
  readonly columnForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [textLimit(60, true)] }),
  });
  readonly itemForm = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [textLimit(200, true)] }),
    description: new FormControl('', { nonNullable: true, validators: [textLimit(10000)] }),
  });
  readonly appliedFilter = computed(() =>
    appliedListFilter(
      this.listFilter.filter(),
      this.data().columns.map((c) => c.id),
    ),
  );
  readonly grouped = computed(() => {
    const free = this.isFreeLayout();
    const filter = this.appliedFilter();
    const groups = new Map<number, Item[]>();
    for (const column of this.data().columns) groups.set(column.id, []);
    for (const card of this.data().items) {
      if (!itemMatchesFilter(card, filter)) continue;
      groups.get(card.columnId)?.push(card);
    }
    for (const [columnId, list] of groups) {
      groups.set(columnId, sortColumnItems(list, free));
    }
    return groups;
  });
  readonly filteredItemCount = computed(() => {
    let n = 0;
    for (const list of this.grouped().values()) n += list.length;
    return n;
  });
  dropListId(columnId: number) {
    return dropListIdForColumn(columnId);
  }
  connectedLists(columnId: number) {
    if (this.isBoardMobile()) return [];
    return this.dropListIds().filter((id) => id !== dropListIdForColumn(columnId));
  }

  freeListMinHeight(columnId: number): number {
    return freeListMinHeightPx(this.grouped().get(columnId) ?? [], this.cardHeights());
  }
  readonly done = computed(() => {
    const id = this.data().columns.find((c) => c.name === 'Done')?.id;
    return this.grouped().get(id ?? -1)?.length ?? 0;
  });

  ngOnInit() {
    this.bindBoardMobileMedia();
    this.load();
    this.listFilter.load();
    this.destroyRef.onDestroy(() => {
      this.scrollRestoreGeneration++;
    });
    const stop = startLiveRefresh({
      enabled: () =>
        !this.loading() &&
        !this.reordering() &&
        !this.saving() &&
        !this.settingsSaving() &&
        !this.layoutSwitching() &&
        this.modal() === null &&
        this.draggingColumnId() === null &&
        this.draggingItemId() === null,
      fetch: () => this.pollBoard(),
      apply: (d) => {
        this.error.set('');
        if (sameJson(this.data(), d)) return;
        this.data.set(d);
        this.scheduleCardHeightMeasure();
      },
      ...zoneAwareTimers(this.zone),
    });
    this.destroyRef.onDestroy(stop);
  }

  private bindBoardMobileMedia() {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(boardMobileMediaQuery());
    const sync = () => this.isBoardMobile.set(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    this.destroyRef.onDestroy(() => mq.removeEventListener('change', sync));
  }

  private scheduleBoardScrollRestore() {
    if (this.scrollRestoreAttempted) return;
    const saved = readBoardScroll();
    if (!saved) return;
    this.scrollRestoreAttempted = true;
    const generation = ++this.scrollRestoreGeneration;
    // Baseline at schedule time — not saved values (mount is 0, saved is not).
    scheduleScrollRestore({
      shouldApply: () =>
        generation === this.scrollRestoreGeneration && !this.destroyRef.destroyed,
      injector: this.injector,
      captureBaseline: () => {
        const page = pageScrollElement();
        const boardEl = this.boardScroll()?.nativeElement;
        return [page?.scrollTop ?? 0, boardEl?.scrollLeft ?? 0];
      },
      readCurrent: () => {
        const pageNow = pageScrollElement();
        const boardNow = this.boardScroll()?.nativeElement;
        return [
          pageNow ? pageNow.scrollTop : null,
          boardNow ? boardNow.scrollLeft : null,
        ];
      },
      targets: [saved.scrollY, saved.scrollLeft],
      apply: ([scrollY, scrollLeft]) => {
        const pageNow = pageScrollElement();
        const boardNow = this.boardScroll()?.nativeElement;
        if (pageNow) pageNow.scrollTop = scrollY;
        if (boardNow) boardNow.scrollLeft = scrollLeft;
        clearBoardScroll();
      },
      onSkipped: () => clearBoardScroll(),
    });
  }

  /**
   * A poll's answer is only good for the board it was requested for. If anything changed the board in the meantime
   * (a move, its saved answer, a created card, a reload), the answer is older than that change and would undo it
   * until the next poll, so it is dropped.
   */
  private pollBoard() {
    const requestedFor = this.data();
    return this.api.board().pipe(
      map((raw) => applyBoardMobileSettings(raw)),
      filter(() => this.data() === requestedFor),
    );
  }

  async copyItemLink(number: number) {
    const origin = await this.appOrigin.resolve();
    return this.linkCopy.copyItemNumber(number, origin);
  }

  toggleCommandMenu(itemId: number, itemNumber: number, event: Event) {
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
    const listPromise = firstValueFrom(this.api.listItemCommandTemplatesByNumber(itemNumber));

    // Preserve user activation: write ClipboardItem during the click, resolve text after fetch.
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const textPromise = listPromise.then(async (res) => {
        const templates = res?.templates ?? [];
        if (templates.length !== 1) {
          throw new Error('not-single');
        }
        const origin = await this.appOrigin.resolve();
        return resolveCommand(templates[0].template, itemDetailUrl(origin, itemNumber));
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
            this.openCommandMenuAfterList(itemId, itemNumber, button, generation, listPromise);
          });
        });
      return;
    }

    this.openCommandMenuAfterList(itemId, itemNumber, button, generation, listPromise);
  }

  private openCommandMenuAfterList(
    itemId: number,
    itemNumber: number,
    button: HTMLElement,
    generation: number,
    listPromise: Promise<{ templates?: CommandTemplate[] }>,
  ) {
    // Apply .command-menu-open first so hover transform is cleared (it would be the fixed containing block).
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
            void this.closeMenuAndCopyCommand(templates[0].template, itemNumber);
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

  async copyCommand(templateText: string, number: number, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    return this.closeMenuAndCopyCommand(templateText, number);
  }

  private async closeMenuAndCopyCommand(templateText: string, number: number) {
    this.closeCommandMenu();
    const origin = await this.appOrigin.resolve();
    return this.commandCopy.copyResolved(templateText, number, origin);
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

  load() {
    this.loading.set(true);
    this.error.set('');
    this.reorderError.set('');
    this.reorderConflict.set(false);
    this.api
      .board()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (d) => {
          this.data.set(applyBoardMobileSettings(d));
          // Schedule after data arrives so the first afterNextRender sees #boardScroll
          // (not the loading-only first paint).
          this.scheduleBoardScrollRestore();
          this.scheduleCardHeightMeasure();
        },
        error: (e) => this.error.set(errorMessage(e)),
      });
  }

  onMobileColumnChange(rawId: string): Promise<void> | void {
    const columnId = Number(rawId);
    return saveMobileBoardColumn(
      {
        isBusy: () => this.settingsSaving() || this.layoutSwitching() || this.reordering(),
        setSettingsSaving: (busy) => this.settingsSaving.set(busy),
        getData: () => this.data(),
        setData: (data) => this.data.set(data),
        setReorderError: (message) => this.reorderError.set(message),
        setReorderConflict: (conflict) => this.reorderConflict.set(conflict),
        patchBoardSettings: (body) => this.api.patchBoardSettings(body),
      },
      columnId,
    );
  }

  onCardLayoutToggle(checked: boolean): Promise<void> | void {
    if (!this.canToggleCardLayout()) return;
    const next: CardLayout = checked ? 'free' : 'pack';
    const current = this.cardLayout();
    if (next === current) return;
    if (next === 'free') return this.switchPackToFree();
    return this.switchFreeToPack();
  }

  openColumn() {
    if (this.reordering()) return;
    this.columnForm.reset();
    this.formError.set('');
    this.modal.set('column');
  }

  openItem(_columnId?: number) {
    if (this.reordering()) return;
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

  addColumn() {
    if (this.columnForm.invalid || this.saving() || this.reordering()) {
      this.columnForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.formError.set('');
    const name = this.columnForm.controls.name.value.trim();
    this.columnForm.disable({ emitEvent: false });
    this.api
      .createColumn(name)
      .pipe(
        finalize(() => {
          this.saving.set(false);
          this.columnForm.enable({ emitEvent: false });
        }),
      )
      .subscribe({
        next: (column) => {
          this.data.update((d) => ({ ...d, columns: [...d.columns, column] }));
          this.modal.set(null);
        },
        error: (e) => this.formError.set(errorMessage(e)),
      });
  }

  addItem() {
    if (this.itemForm.invalid || this.saving() || this.reordering()) {
      this.itemForm.markAllAsTouched();
      return;
    }
    const todoId = todoColumnId(this.data().columns);
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
          this.data.update((d) => ({ ...d, items: [...d.items, normalizeItem(card)] }));
          this.modal.set(null);
          this.scheduleCardHeightMeasure();
        },
        error: (e) => this.formError.set(errorMessage(e)),
      });
  }

  /**
   * CDK's own edge scrolling is off (it would fight page scrolling), so this scrolls the board sideways and the
   * document vertically. It runs on every pointer move and, like a column drag's repeating dragover, keeps going on a
   * timer while the pointer rests at an edge.
   */
  onItemDragMoved(event: { pointerPosition: { x: number; y: number } }) {
    this.dragPointer = event.pointerPosition;
    this.dragMovedSinceTick = true;
    this.autoScrollAt(event.pointerPosition);
  }

  onItemDragStarted(event: CdkDragStart<Item>, card: Item) {
    this.draggingItemId.set(card.id);
    const pointerY = pointerClientY(event.event);
    const rect = event.source.element.nativeElement.getBoundingClientRect();
    this.itemDragGrabOffsetY = pointerY == null ? 0 : pointerY - rect.top;
    this.stopAutoScrollTimer();
    this.dragMovedSinceTick = false;
    this.autoScrollTimer = setInterval(() => {
      // A move in this interval already scrolled; only a resting pointer needs the timer.
      if (!this.dragMovedSinceTick && this.dragPointer) this.autoScrollAt(this.dragPointer);
      this.dragMovedSinceTick = false;
    }, ITEM_AUTO_SCROLL_INTERVAL_MS);
  }

  /** The pointer was let go: CDK reports the end only after the preview has settled (up to ~300ms), too late to keep scrolling. */
  onItemDragReleased() {
    this.stopAutoScrollTimer();
  }

  /** CDK emits this and then the drop, one straight after the other, so no poll can run in between. */
  onItemDragEnded() {
    this.draggingItemId.set(null);
    this.stopAutoScrollTimer();
    this.dragPointer = null;
  }

  private stopAutoScrollTimer() {
    if (this.autoScrollTimer !== null) clearInterval(this.autoScrollTimer);
    this.autoScrollTimer = null;
  }

  private autoScrollAt(pointer: { x: number; y: number }) {
    const scrollEl = this.boardScroll()?.nativeElement;
    if (scrollEl) {
      const scrollRect = scrollEl.getBoundingClientRect();
      const delta = computeAutoScrollDelta(pointer.x, scrollRect.left, scrollRect.right);
      if (delta !== 0) scrollEl.scrollLeft += delta;
    }
    // Columns grow with their cards; vertical browsing is the page, not each .card-list.
    autoScrollPageVertically(pageScrollElement(), pointer.y, window.innerHeight);
  }

  /** Real URL of a card, so the browser's own link features (new tab, copy link, status bar) keep working. */
  itemHref(card: Item): string {
    return this.location.prepareExternalUrl(itemAppPath(card.number));
  }

  onItemClick(event: MouseEvent, card: Item) {
    // Ctrl/Cmd/Shift/Alt-click and non-primary buttons are the browser's: let the href do its job.
    if (!isUnmodifiedPrimaryClick(event)) {
      return;
    }
    event.preventDefault();
    const page = pageScrollElement();
    const boardEl = this.boardScroll()?.nativeElement;
    saveBoardScroll({
      scrollY: page?.scrollTop ?? 0,
      scrollLeft: boardEl?.scrollLeft ?? 0,
    });
    saveReturnTo('/');
    void this.router.navigate(['/items', card.number]);
  }

  /**
   * Bound on the card's drag handle only (not the article, link, or copy button), so arrow keys pressed on the link
   * or copy button never move the card. Enter on the link is its native click; only the arrow keys are handled here.
   * Keyboard column reorder is pack only (L-472).
   */
  onItemKeydown(event: KeyboardEvent, columnId: number, index: number) {
    if (this.isFreeLayout()) return;
    const list = this.grouped().get(columnId) ?? [];
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (!this.canReorderItems()) return;
    const toIndex = event.key === 'ArrowUp' ? index - 1 : index + 1;
    if (toIndex < 0 || toIndex >= list.length) return;
    event.preventDefault();
    const movedId = list[index].id;
    const next = applyItemDrop(this.data().items, columnId, columnId, index, toIndex);
    if (!next) return;
    this.persistItemOrder(
      next,
      [columnId],
      `${list[index].title}を${toIndex + 1}番目に移動しました`,
      { focusItemId: movedId },
    );
  }

  onItemDrop(event: CdkDragDrop<Item[]>, columnId: number) {
    this.stopAutoScrollTimer();
    if (!this.canReorderItems()) return;
    const previousColumnId = columnIdFromDropListId(event.previousContainer.id);
    if (previousColumnId === null) return;
    // CDK's indexes refer to the list as it was when the drag began; if the card there is not the dragged one, the
    // list changed underneath the drag and the indexes would move some other card.
    const dragged = event.item.data as Item | undefined;
    const source = this.grouped().get(previousColumnId) ?? [];
    if (!dragged || source[event.previousIndex]?.id !== dragged.id) return;

    if (this.isFreeLayout()) {
      this.onFreeItemDrop(event, previousColumnId, columnId, dragged);
      return;
    }

    const next = applyItemDrop(
      this.data().items,
      previousColumnId,
      columnId,
      event.previousIndex,
      event.currentIndex,
    );
    if (!next) return;
    const title = dragged.title;
    const columnName = this.data().columns.find((c) => c.id === columnId)?.name ?? '';
    this.persistItemOrder(
      next,
      affectedColumnIds(previousColumnId, columnId),
      `${title}を${columnName}の${event.currentIndex + 1}番目へ移動しました`,
    );
  }

  private onFreeItemDrop(
    event: CdkDragDrop<Item[]>,
    previousColumnId: number,
    columnId: number,
    dragged: Item,
  ) {
    const sameColumn = previousColumnId === columnId;
    let nextOffsetY = dragged.offsetY ?? 0;
    if (sameColumn) {
      const listEl = this.columnsContainer()?.nativeElement?.querySelector<HTMLElement>(
        `#${dropListIdForColumn(columnId)}`,
      );
      if (!listEl) return;
      const listRect = listEl.getBoundingClientRect();
      nextOffsetY = computeFreeOffsetY({
        listTop: listRect.top,
        pointerY: event.dropPoint.y,
        grabOffsetY: this.itemDragGrabOffsetY,
        scrollTop: listEl.scrollTop,
      });
    }
    const next = applyFreeItemDrop(
      this.data().items,
      previousColumnId,
      columnId,
      dragged.id,
      nextOffsetY,
    );
    if (!next) return;
    const columnName = this.data().columns.find((c) => c.id === columnId)?.name ?? '';
    this.persistItemOrder(
      next,
      affectedColumnIds(previousColumnId, columnId),
      sameColumn
        ? `${dragged.title}の位置を更新しました`
        : `${dragged.title}を${columnName}へ移動しました`,
      { includeOffsetYs: true },
    );
  }

  private persistItemOrder(
    nextCards: Item[],
    columnIds: number[],
    announcement: string,
    options?: { focusItemId?: number; includeOffsetYs?: boolean },
  ) {
    if (this.reordering()) return;
    const previous = this.data().items;
    const focusItemId = options?.focusItemId;
    const includeOffsetYs = options?.includeOffsetYs === true || this.isFreeLayout();
    const restoreFocus = () => {
      if (focusItemId !== undefined) this.focusItemAfterRender(focusItemId);
    };
    this.reordering.set(true);
    this.reorderError.set('');
    this.reorderConflict.set(false);
    this.data.update((d) => ({ ...d, items: nextCards }));
    this.scheduleCardHeightMeasure();
    restoreFocus();
    this.api
      .reorderItems(buildItemOrderPayload(nextCards, columnIds, { includeOffsetYs }))
      .pipe(finalize(() => this.reordering.set(false)))
      .subscribe({
        next: (res) => {
          this.data.update((d) => ({
            ...d,
            items: (res.items ?? []).map((item) => normalizeItem(item)),
          }));
          this.reorderAnnouncement.set(announcement);
          this.scheduleCardHeightMeasure();
          restoreFocus();
        },
        error: (e) => {
          this.data.update((d) => ({ ...d, items: previous }));
          this.reorderError.set(errorMessage(e));
          this.reorderConflict.set((e as { status?: number } | null)?.status === 409);
          this.reorderAnnouncement.set('アイテムの移動を保存できませんでした');
          this.scheduleCardHeightMeasure();
          restoreFocus();
        },
      });
  }

  private layoutSwitchDeps() {
    return {
      isBusy: () => this.layoutSwitching() || this.settingsSaving(),
      setLayoutSwitching: (busy: boolean) => this.layoutSwitching.set(busy),
      setSettingsSaving: (busy: boolean) => this.settingsSaving.set(busy),
      getData: () => this.data(),
      setData: (data: NormalizedBoardData) => this.data.set(withResolvedMobileColumnId(data)),
      updateData: (fn: (data: NormalizedBoardData) => NormalizedBoardData) =>
        this.data.update((d) => withResolvedMobileColumnId(fn(d))),
      setReorderError: (message: string) => this.reorderError.set(message),
      setReorderConflict: (conflict: boolean) => this.reorderConflict.set(conflict),
      setReorderAnnouncement: (message: string) => this.reorderAnnouncement.set(message),
      measurePackOffsetsAsItems: () => this.measurePackOffsetsAsItems(),
      scheduleCardHeightMeasure: () => this.scheduleCardHeightMeasure(),
      reorderItems: (columns: ItemOrderColumn[]) => this.api.reorderItems(columns),
      patchBoardSettings: (body: { cardLayout?: CardLayout; mobileBoardColumnId?: number }) =>
        this.api.patchBoardSettings(body),
    };
  }

  private switchPackToFree() {
    return switchPackToFree(this.layoutSwitchDeps());
  }

  private switchFreeToPack() {
    return switchFreeToPack(this.layoutSwitchDeps());
  }

  private measurePackOffsetsAsItems(): Item[] {
    const d = this.data();
    return measurePackOffsetsAsItems(
      this.columnsContainer()?.nativeElement,
      d.columns,
      d.items,
    );
  }

  private scheduleCardHeightMeasure() {
    scheduleCardHeightMeasure({
      destroyRef: this.destroyRef,
      injector: this.injector,
      getRoot: () => this.columnsContainer()?.nativeElement,
      setHeights: (heights) => this.cardHeights.set(heights),
    });
  }

  private focusItemAfterRender(itemId: number) {
    this.focusAfterRender(`[data-card-id="${itemId}"] .card-drag-handle`);
  }

  onColumnDragStart(event: DragEvent, column: Column, columnEl: HTMLElement) {
    const target = event.target instanceof Element ? event.target : null;
    if (!this.canReorder() || !target || target.closest('.icon-button')) {
      event.preventDefault();
      return;
    }
    this.draggingColumnId.set(column.id);
    this.dropSlot.set(null);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(column.id));
      const rect = columnEl.getBoundingClientRect();
      event.dataTransfer.setDragImage?.(
        columnEl,
        Math.max(0, event.clientX - rect.left),
        Math.max(0, event.clientY - rect.top),
      );
    }
  }

  onColumnsDragOver(event: DragEvent) {
    const draggingId = this.draggingColumnId();
    if (draggingId === null) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    const scrollEl = this.boardScroll()?.nativeElement;
    if (scrollEl) {
      const scrollRect = scrollEl.getBoundingClientRect();
      const delta = computeAutoScrollDelta(event.clientX, scrollRect.left, scrollRect.right);
      if (delta !== 0) scrollEl.scrollLeft += delta;
    }
    const slot = this.computeSlotFromPointer(event.clientX);
    if (slot === null) return;
    const columns = this.data().columns;
    const fromIndex = columns.findIndex((c) => c.id === draggingId);
    const targetIndex = targetColumnIndex(fromIndex, slot, columns.length);
    this.dropSlot.set(targetIndex === null ? null : slot);
  }

  onColumnsDragLeave(event: DragEvent) {
    const scrollEl = this.boardScroll()?.nativeElement;
    if (!scrollEl) return;
    if (!scrollEl.contains(event.relatedTarget as Node | null)) {
      this.dropSlot.set(null);
    }
  }

  onColumnsDrop(event: DragEvent) {
    const draggingId = this.draggingColumnId();
    if (draggingId === null) return;
    event.preventDefault();
    const slot = this.dropSlot() ?? this.computeSlotFromPointer(event.clientX);
    this.resetDragState();
    if (slot === null || !this.canReorder()) return;
    const columns = this.data().columns;
    const fromIndex = columns.findIndex((c) => c.id === draggingId);
    const toIndex = targetColumnIndex(fromIndex, slot, columns.length);
    if (toIndex !== null) {
      this.applyReorder(fromIndex, toIndex);
    }
  }

  onColumnDragEnd() {
    this.resetDragState();
  }

  onHandleKeydown(event: KeyboardEvent, columnIndex: number) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const columns = this.data().columns;
    if (!this.canReorder() || columnIndex < 0 || columnIndex >= columns.length) return;
    const toIndex = event.key === 'ArrowLeft' ? columnIndex - 1 : columnIndex + 1;
    if (toIndex < 0 || toIndex >= columns.length) return;
    event.preventDefault();
    this.applyReorder(columnIndex, toIndex, columns[columnIndex].id);
  }

  private computeSlotFromPointer(clientX: number): number | null {
    const container = this.columnsContainer()?.nativeElement;
    if (!container) return null;
    const bounds = Array.from(container.querySelectorAll<HTMLElement>('.kanban-column')).map(
      (el) => {
        const rect = el.getBoundingClientRect();
        return { left: rect.left, width: rect.width };
      },
    );
    return computeDropSlot(clientX, bounds);
  }

  private resetDragState() {
    this.draggingColumnId.set(null);
    this.dropSlot.set(null);
  }

  private applyReorder(fromIndex: number, toIndex: number, focusColumnId?: number) {
    const previousColumns = this.data().columns;
    if (
      this.reordering() ||
      fromIndex < 0 ||
      fromIndex >= previousColumns.length ||
      toIndex < 0 ||
      toIndex >= previousColumns.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const nextColumns = moveColumn(previousColumns, fromIndex, toIndex);
    const movedColumn = nextColumns[toIndex];
    const restoreFocus = () => {
      if (focusColumnId !== undefined) this.focusHandleAfterRender(focusColumnId);
    };
    this.reordering.set(true);
    this.reorderError.set('');
    this.reorderConflict.set(false);
    this.data.update((d) => ({ ...d, columns: nextColumns }));
    restoreFocus();

    this.api
      .reorderColumns(nextColumns.map((c) => c.id))
      .pipe(finalize(() => this.reordering.set(false)))
      .subscribe({
        next: (res) => {
          this.data.update((d) => ({ ...d, columns: res.columns }));
          this.reorderAnnouncement.set(`${movedColumn.name}列を${toIndex + 1}番目に移動しました`);
          restoreFocus();
        },
        error: (e) => {
          this.data.update((d) => ({ ...d, columns: previousColumns }));
          this.reorderError.set(errorMessage(e));
          this.reorderConflict.set((e as { status?: number } | null)?.status === 409);
          this.reorderAnnouncement.set('列の移動を保存できませんでした');
          restoreFocus();
        },
      });
  }

  private focusHandleAfterRender(columnId: number) {
    this.focusAfterRender(`[data-column-id="${columnId}"] .column-drag-handle`);
  }

  private focusAfterRender(selector: string) {
    if (this.destroyRef.destroyed || this.modal() !== null) return;
    afterNextRender(
      () => {
        if (this.destroyRef.destroyed || this.modal() !== null) return;
        const el = this.columnsContainer()?.nativeElement?.querySelector<HTMLElement>(selector);
        if (!el) return;
        el.focus();
        el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      },
      { injector: this.injector },
    );
  }
}
