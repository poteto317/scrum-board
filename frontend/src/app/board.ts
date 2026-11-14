import { Modal } from './modal';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  NgZone,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { Location } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  CDK_DRAG_CONFIG,
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
} from '@angular/cdk/drag-drop';
import { filter, finalize } from 'rxjs';
import { Api } from './api';
import { errorMessage } from './api-error';
import { assigneeKind } from './assignee';
import {
  affectedColumnIds,
  applyCardDrop,
  buildCardOrderPayload,
  CARD_AUTO_SCROLL_INTERVAL_MS,
  CARD_DRAG_THRESHOLD_PX,
  CARD_TOUCH_DRAG_DELAY_MS,
  columnIdFromDropListId,
  dropListIdForColumn,
} from './card-order';
import {
  computeAutoScrollDelta,
  computeDropSlot,
  moveColumn,
  targetColumnIndex,
} from './column-order';
import { textLimit } from './form-validation';
import { BoardData, Card, Column } from './models';
import { CopyLinkFeedback } from './copy-link-feedback';
import { sameJson, startLiveRefresh, zoneAwareTimers } from './live-refresh';
import { autoScrollPageVertically, pageScrollElement } from './page-scroll';
import { TODO_COLUMN_MISSING, todoColumnId } from './todo-column';

@Component({
  selector: 'app-board',
  imports: [ReactiveFormsModule, Modal, CdkDropList, CdkDrag, CdkDragHandle],
  templateUrl: './board.html',
  styleUrl: './board.css',
  providers: [
    {
      provide: CDK_DRAG_CONFIG,
      useValue: {
        dragStartThreshold: CARD_DRAG_THRESHOLD_PX,
        dragStartDelay: { touch: CARD_TOUCH_DRAG_DELAY_MS, mouse: 0 },
      },
    },
  ],
})
export class Board implements OnInit {
  readonly assigneeKind = assigneeKind;
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly boardScroll = viewChild<ElementRef<HTMLElement>>('boardScroll');
  private readonly columnsContainer = viewChild<ElementRef<HTMLElement>>('columnsContainer');

  readonly data = signal<BoardData>({ columns: [], cards: [] });
  readonly loading = signal(true);
  readonly error = signal('');
  readonly saving = signal(false);
  readonly reordering = signal(false);
  readonly reorderError = signal('');
  readonly reorderConflict = signal(false);
  readonly reorderAnnouncement = signal('');
  private readonly linkCopy = new CopyLinkFeedback(this.destroyRef);
  private autoScrollTimer: ReturnType<typeof setInterval> | null = null;
  private dragPointer: { x: number; y: number } | null = null;
  private dragMovedSinceTick = false;
  private readonly stopAutoScrollOnDestroy = this.destroyRef.onDestroy(() =>
    this.stopAutoScrollTimer(),
  );
  readonly copyLinkAnnouncement = this.linkCopy.message;
  readonly draggingColumnId = signal<number | null>(null);
  /**
   * The card CDK is dragging: from (cdkDragStarted) until (cdkDragEnded), which CDK emits only after the preview has
   * settled (up to ~300ms after the pointer was let go) and just before the drop. CDK reports the drop's indexes
   * against the list as it was when the drag began, so the board must not be replaced while this is set.
   */
  readonly draggingCardId = signal<number | null>(null);
  readonly dropSlot = signal<number | null>(null);
  readonly modal = signal<'column' | 'card' | null>(null);
  readonly formError = signal('');
  readonly canReorder = computed(
    () =>
      !this.loading() &&
      !this.saving() &&
      !this.reordering() &&
      this.modal() === null &&
      this.data().columns.length > 1,
  );
  readonly canReorderCards = computed(
    () => !this.loading() && !this.saving() && !this.reordering() && this.modal() === null,
  );
  readonly dropListIds = computed(() => this.data().columns.map((c) => this.dropListId(c.id)));
  readonly columnForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [textLimit(60, true)] }),
  });
  readonly cardForm = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [textLimit(200, true)] }),
    description: new FormControl('', { nonNullable: true, validators: [textLimit(10000)] }),
  });
  readonly grouped = computed(() => {
    const groups = new Map<number, BoardData['cards']>();
    for (const column of this.data().columns) groups.set(column.id, []);
    for (const card of this.data().cards) groups.get(card.columnId)?.push(card);
    for (const [, list] of groups) {
      list.sort((a, b) => a.position - b.position || a.id - b.id);
    }
    return groups;
  });
  dropListId(columnId: number) {
    return dropListIdForColumn(columnId);
  }
  connectedLists(columnId: number) {
    return this.dropListIds().filter((id) => id !== dropListIdForColumn(columnId));
  }
  readonly done = computed(() => {
    const id = this.data().columns.find((c) => c.name === 'Done')?.id;
    return this.data().cards.filter((c) => c.columnId === id).length;
  });

  ngOnInit() {
    this.load();
    const stop = startLiveRefresh({
      enabled: () =>
        !this.loading() &&
        !this.reordering() &&
        !this.saving() &&
        this.modal() === null &&
        this.draggingColumnId() === null &&
        this.draggingCardId() === null,
      fetch: () => this.pollBoard(),
      apply: (d) => {
        this.error.set('');
        if (sameJson(this.data(), d)) return;
        this.data.set(d);
      },
      ...zoneAwareTimers(this.zone),
    });
    this.destroyRef.onDestroy(stop);
  }

  /**
   * A poll's answer is only good for the board it was requested for. If anything changed the board in the meantime
   * (a move, its saved answer, a created card, a reload), the answer is older than that change and would undo it
   * until the next poll, so it is dropped.
   */
  private pollBoard() {
    const requestedFor = this.data();
    return this.api.board().pipe(filter(() => this.data() === requestedFor));
  }

  copyCardLink(number: number) {
    return this.linkCopy.copyCardNumber(number);
  }

  load() {
    this.loading.set(true);
    this.error.set('');
    this.reorderError.set('');
    this.reorderConflict.set(false);
    this.api
      .board()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({ next: (d) => this.data.set(d), error: (e) => this.error.set(errorMessage(e)) });
  }

  openColumn() {
    if (this.reordering()) return;
    this.columnForm.reset();
    this.formError.set('');
    this.modal.set('column');
  }

  openCard(_columnId?: number) {
    if (this.reordering()) return;
    this.cardForm.reset({ title: '', description: '' });
    this.formError.set('');
    this.modal.set('card');
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

  addCard() {
    if (this.cardForm.invalid || this.saving() || this.reordering()) {
      this.cardForm.markAllAsTouched();
      return;
    }
    const todoId = todoColumnId(this.data().columns);
    if (todoId == null) {
      this.formError.set(TODO_COLUMN_MISSING);
      return;
    }
    this.saving.set(true);
    this.formError.set('');
    const value = this.cardForm.getRawValue();
    this.cardForm.disable({ emitEvent: false });
    this.api
      .createCard({ ...value, title: value.title.trim(), columnId: todoId })
      .pipe(
        finalize(() => {
          this.saving.set(false);
          this.cardForm.enable({ emitEvent: false });
        }),
      )
      .subscribe({
        next: (card) => {
          this.data.update((d) => ({ ...d, cards: [...d.cards, card] }));
          this.modal.set(null);
        },
        error: (e) => this.formError.set(errorMessage(e)),
      });
  }

  /**
   * CDK's own edge scrolling is off (it would fight page scrolling), so this scrolls the board sideways and the
   * document vertically. It runs on every pointer move and, like a column drag's repeating dragover, keeps going on a
   * timer while the pointer rests at an edge.
   */
  onCardDragMoved(event: { pointerPosition: { x: number; y: number } }) {
    this.dragPointer = event.pointerPosition;
    this.dragMovedSinceTick = true;
    this.autoScrollAt(event.pointerPosition);
  }

  onCardDragStarted(card: Card) {
    this.draggingCardId.set(card.id);
    this.stopAutoScrollTimer();
    this.dragMovedSinceTick = false;
    this.autoScrollTimer = setInterval(() => {
      // A move in this interval already scrolled; only a resting pointer needs the timer.
      if (!this.dragMovedSinceTick && this.dragPointer) this.autoScrollAt(this.dragPointer);
      this.dragMovedSinceTick = false;
    }, CARD_AUTO_SCROLL_INTERVAL_MS);
  }

  /** The pointer was let go: CDK reports the end only after the preview has settled (up to ~300ms), too late to keep scrolling. */
  onCardDragReleased() {
    this.stopAutoScrollTimer();
  }

  /** CDK emits this and then the drop, one straight after the other, so no poll can run in between. */
  onCardDragEnded() {
    this.draggingCardId.set(null);
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
  cardHref(card: Card): string {
    return this.location.prepareExternalUrl(`/cards/${card.number}`);
  }

  onCardClick(event: MouseEvent, card: Card) {
    // Ctrl/Cmd/Shift/Alt-click and non-primary buttons are the browser's: let the href do its job.
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    void this.router.navigate(['/cards', card.number]);
  }

  /**
   * Bound on the card's drag handle only (not the article, link, or copy button), so arrow keys pressed on the link
   * or copy button never move the card. Enter on the link is its native click; only the arrow keys are handled here.
   */
  onCardKeydown(event: KeyboardEvent, columnId: number, index: number) {
    const list = this.grouped().get(columnId) ?? [];
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (!this.canReorderCards()) return;
    const toIndex = event.key === 'ArrowUp' ? index - 1 : index + 1;
    if (toIndex < 0 || toIndex >= list.length) return;
    event.preventDefault();
    const movedId = list[index].id;
    const next = applyCardDrop(this.data().cards, columnId, columnId, index, toIndex);
    if (!next) return;
    this.persistCardOrder(
      next,
      [columnId],
      `${list[index].title}を${toIndex + 1}番目に移動しました`,
      movedId,
    );
  }

  onCardDrop(event: CdkDragDrop<Card[]>, columnId: number) {
    this.stopAutoScrollTimer();
    if (!this.canReorderCards()) return;
    const previousColumnId = columnIdFromDropListId(event.previousContainer.id);
    if (previousColumnId === null) return;
    // CDK's indexes refer to the list as it was when the drag began; if the card there is not the dragged one, the
    // list changed underneath the drag and the indexes would move some other card.
    const dragged = event.item.data as Card | undefined;
    const source = this.grouped().get(previousColumnId) ?? [];
    if (!dragged || source[event.previousIndex]?.id !== dragged.id) return;
    const next = applyCardDrop(
      this.data().cards,
      previousColumnId,
      columnId,
      event.previousIndex,
      event.currentIndex,
    );
    if (!next) return;
    const title = dragged.title;
    const columnName = this.data().columns.find((c) => c.id === columnId)?.name ?? '';
    this.persistCardOrder(
      next,
      affectedColumnIds(previousColumnId, columnId),
      `${title}を${columnName}の${event.currentIndex + 1}番目へ移動しました`,
    );
  }

  private persistCardOrder(
    nextCards: Card[],
    columnIds: number[],
    announcement: string,
    focusCardId?: number,
  ) {
    if (this.reordering()) return;
    const previous = this.data().cards;
    const restoreFocus = () => {
      if (focusCardId !== undefined) this.focusCardAfterRender(focusCardId);
    };
    this.reordering.set(true);
    this.reorderError.set('');
    this.reorderConflict.set(false);
    this.data.update((d) => ({ ...d, cards: nextCards }));
    restoreFocus();
    this.api
      .reorderCards(buildCardOrderPayload(nextCards, columnIds))
      .pipe(finalize(() => this.reordering.set(false)))
      .subscribe({
        next: (res) => {
          this.data.update((d) => ({ ...d, cards: res.cards }));
          this.reorderAnnouncement.set(announcement);
          restoreFocus();
        },
        error: (e) => {
          this.data.update((d) => ({ ...d, cards: previous }));
          this.reorderError.set(errorMessage(e));
          this.reorderConflict.set((e as { status?: number } | null)?.status === 409);
          this.reorderAnnouncement.set('カードの移動を保存できませんでした');
          restoreFocus();
        },
      });
  }

  private focusCardAfterRender(cardId: number) {
    this.focusAfterRender(`[data-card-id="${cardId}"] .card-drag-handle`);
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
