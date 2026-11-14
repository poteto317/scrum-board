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
import { computeAutoScrollDelta, computeDropSlot, moveCard, targetIndex } from './backlog-order';
import { textLimit } from './form-validation';
import { Card, Column } from './models';
import { sameJson, startLiveRefresh, zoneAwareTimers } from './live-refresh';

@Component({
  selector: 'app-backlog',
  imports: [ReactiveFormsModule, RouterLink, Modal],
  templateUrl: './backlog.html',
  styleUrl: './backlog.css',
})
export class Backlog implements OnInit {
  private readonly api = inject(Api);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly backlogScroll = viewChild<ElementRef<HTMLElement>>('backlogScroll');
  private readonly listContainer = viewChild<ElementRef<HTMLElement>>('listContainer');

  readonly cards = signal<Card[]>([]);
  readonly columns = signal<Column[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly saving = signal(false);
  readonly reordering = signal(false);
  readonly reorderError = signal('');
  readonly reorderConflict = signal(false);
  readonly reorderAnnouncement = signal('');
  readonly draggingCardId = signal<number | null>(null);
  readonly dropSlot = signal<number | null>(null);
  readonly modal = signal<'card' | null>(null);
  readonly formError = signal('');
  readonly canReorder = computed(
    () =>
      !this.loading() &&
      !this.saving() &&
      !this.reordering() &&
      this.modal() === null &&
      this.cards().length > 1,
  );
  readonly columnName = computed(() => {
    const map = new Map<number, string>();
    for (const column of this.columns()) map.set(column.id, column.name);
    return map;
  });
  readonly cardForm = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [textLimit(200, true)] }),
    description: new FormControl('', { nonNullable: true, validators: [textLimit(10000)] }),
    columnId: new FormControl(0, { nonNullable: true }),
  });

  ngOnInit() {
    this.load();
    const stop = startLiveRefresh({
      enabled: () =>
        !this.loading() &&
        !this.reordering() &&
        !this.saving() &&
        this.modal() === null &&
        this.draggingCardId() === null,
      fetch: () => forkJoin({ backlog: this.api.backlog(), board: this.api.board() }),
      apply: ({ backlog, board }) => {
        this.error.set('');
        if (!sameJson(this.cards(), backlog.cards)) this.cards.set(backlog.cards);
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
          this.cards.set(backlog.cards);
          this.columns.set(board.columns);
        },
        error: (e) => this.error.set(errorMessage(e)),
      });
  }

  statusName(columnId: number): string {
    return this.columnName().get(columnId) ?? '不明';
  }

  openCard() {
    if (
      this.loading() ||
      this.reordering() ||
      this.saving() ||
      this.error() ||
      this.columns().length === 0
    ) {
      return;
    }
    const todoId = this.columns().find((c) => c.name === 'Todo')?.id ?? this.columns()[0]?.id ?? 0;
    this.cardForm.reset({ title: '', description: '', columnId: todoId });
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

  addCard() {
    if (this.cardForm.invalid || this.saving()) {
      this.cardForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.formError.set('');
    const value = this.cardForm.getRawValue();
    this.cardForm.disable({ emitEvent: false });
    this.api
      .createCard({ ...value, title: value.title.trim() })
      .pipe(
        finalize(() => {
          this.saving.set(false);
          this.cardForm.enable({ emitEvent: false });
        }),
      )
      .subscribe({
        next: (card) => {
          this.cards.update((list) => [...list, card]);
          this.modal.set(null);
        },
        error: (e) => this.formError.set(errorMessage(e)),
      });
  }

  onCardDragStart(event: DragEvent, card: Card, rowEl: HTMLElement) {
    const target = event.target instanceof Element ? event.target : null;
    if (!this.canReorder() || !target || target.closest('.backlog-detail-link')) {
      event.preventDefault();
      return;
    }
    this.draggingCardId.set(card.id);
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
    const draggingId = this.draggingCardId();
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
    const cards = this.cards();
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
    const draggingId = this.draggingCardId();
    if (draggingId === null) return;
    event.preventDefault();
    const slot = this.dropSlot() ?? this.computeSlotFromPointer(event.clientY);
    this.resetDragState();
    if (slot === null || !this.canReorder()) return;
    const cards = this.cards();
    const fromIndex = cards.findIndex((c) => c.id === draggingId);
    const toIndex = targetIndex(fromIndex, slot, cards.length);
    if (toIndex !== null) {
      this.applyReorder(fromIndex, toIndex);
    }
  }

  onCardDragEnd() {
    this.resetDragState();
  }

  onHandleKeydown(event: KeyboardEvent, cardIndex: number) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const cards = this.cards();
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
    this.draggingCardId.set(null);
    this.dropSlot.set(null);
  }

  private applyReorder(fromIndex: number, toIndex: number, focusCardId?: number) {
    const previous = this.cards();
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
    const next = moveCard(previous, fromIndex, toIndex);
    const moved = next[toIndex];
    const restoreFocus = () => {
      if (focusCardId !== undefined) this.focusHandleAfterRender(focusCardId);
    };
    this.reordering.set(true);
    this.reorderError.set('');
    this.reorderConflict.set(false);
    this.cards.set(next);
    restoreFocus();

    this.api
      .reorderBacklog(next.map((c) => c.id))
      .pipe(finalize(() => this.reordering.set(false)))
      .subscribe({
        next: (res) => {
          this.cards.set(res.cards);
          this.reorderAnnouncement.set(`TASK-${moved.number} を${toIndex + 1}番目に移動しました`);
          restoreFocus();
        },
        error: (e) => {
          this.cards.set(previous);
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
