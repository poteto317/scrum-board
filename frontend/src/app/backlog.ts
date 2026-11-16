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
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize, forkJoin } from 'rxjs';
import { Api } from './api';
import { errorMessage } from './api-error';
import { computeAutoScrollDelta, computeDropSlot, moveItem, targetIndex } from './backlog-order';
import { textLimit } from './form-validation';
import { formatItemNumber } from './item-number';
import { Item, Column } from './models';
import { sameJson, startLiveRefresh, zoneAwareTimers } from './live-refresh';
import { TODO_COLUMN_MISSING, todoColumnId } from './todo-column';

@Component({
  selector: 'app-backlog',
  imports: [ReactiveFormsModule, RouterLink, Modal],
  templateUrl: './backlog.html',
  styleUrl: './backlog.css',
})
export class Backlog implements OnInit {
  readonly formatItemNumber = formatItemNumber;
  private readonly api = inject(Api);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly backlogScroll = viewChild<ElementRef<HTMLElement>>('backlogScroll');
  private readonly listContainer = viewChild<ElementRef<HTMLElement>>('listContainer');

  readonly items = signal<Item[]>([]);
  readonly columns = signal<Column[]>([]);
  readonly loading = signal(true);
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
  readonly canReorder = computed(
    () =>
      !this.loading() &&
      !this.saving() &&
      !this.reordering() &&
      this.modal() === null &&
      this.items().length > 1,
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

  ngOnInit() {
    this.load();
    const stop = startLiveRefresh({
      enabled: () =>
        !this.loading() &&
        !this.reordering() &&
        !this.saving() &&
        this.modal() === null &&
        this.draggingItemId() === null,
      fetch: () => forkJoin({ backlog: this.api.backlog(), board: this.api.board() }),
      apply: ({ backlog, board }) => {
        this.error.set('');
        if (!sameJson(this.items(), backlog.items)) this.items.set(backlog.items);
        if (!sameJson(this.columns(), board.columns)) this.columns.set(board.columns);
      },
      ...zoneAwareTimers(this.zone),
    });
    this.destroyRef.onDestroy(stop);
  }

  load() {
    this.loading.set(true);
    this.error.set('');
    this.reorderError.set('');
    this.reorderConflict.set(false);
    forkJoin({ backlog: this.api.backlog(), board: this.api.board() })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: ({ backlog, board }) => {
          this.items.set(backlog.items);
          this.columns.set(board.columns);
        },
        error: (e) => this.error.set(errorMessage(e)),
      });
  }

  statusName(columnId: number): string {
    return this.columnName().get(columnId) ?? '不明';
  }

  openItem() {
    if (
      this.loading() ||
      this.reordering() ||
      this.saving() ||
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
    if (this.itemForm.invalid || this.saving()) {
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
    if (!this.canReorder() || !target || target.closest('.backlog-detail-link')) {
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

  onHandleKeydown(event: KeyboardEvent, cardIndex: number) {
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

  private applyReorder(fromIndex: number, toIndex: number, focusCardId?: number) {
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
      if (focusCardId !== undefined) this.focusHandleAfterRender(focusCardId);
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

  private focusHandleAfterRender(cardId: number) {
    if (this.destroyRef.destroyed || this.modal() !== null) return;
    afterNextRender(
      () => {
        if (this.destroyRef.destroyed || this.modal() !== null) return;
        const container = this.listContainer()?.nativeElement;
        if (!container) return;
        const handles = Array.from(
          container.querySelectorAll<HTMLButtonElement>('.backlog-drag-handle'),
        );
        const target = handles.find(
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
