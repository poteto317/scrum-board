import { Modal } from './modal';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { Api } from './api';
import { errorMessage } from './api-error';
import {
  computeAutoScrollDelta,
  computeDropSlot,
  moveColumn,
  targetColumnIndex,
} from './column-order';
import { textLimit } from './form-validation';
import { BoardData, Column } from './models';
import { CopyLinkFeedback } from './copy-link-feedback';

@Component({
  selector: 'app-board',
  imports: [ReactiveFormsModule, RouterLink, Modal],
  templateUrl: './board.html',
  styleUrl: './board.css',
})
export class Board implements OnInit {
  private readonly api = inject(Api);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
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
  readonly copyLinkAnnouncement = this.linkCopy.message;
  readonly draggingColumnId = signal<number | null>(null);
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
  readonly columnForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [textLimit(60, true)] }),
  });
  readonly cardForm = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [textLimit(200, true)] }),
    description: new FormControl('', { nonNullable: true, validators: [textLimit(10000)] }),
    columnId: new FormControl(0, { nonNullable: true }),
  });
  readonly grouped = computed(() => {
    const groups = new Map<number, BoardData['cards']>();
    for (const column of this.data().columns) groups.set(column.id, []);
    for (const card of this.data().cards) groups.get(card.columnId)?.push(card);
    return groups;
  });
  readonly done = computed(() => {
    const id = this.data().columns.find((c) => c.name === 'Done')?.id;
    return this.data().cards.filter((c) => c.columnId === id).length;
  });

  ngOnInit() {
    this.load();
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

  openCard(columnId: number) {
    this.cardForm.reset({ title: '', description: '', columnId });
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
          this.data.update((d) => ({ ...d, cards: [...d.cards, card] }));
          this.modal.set(null);
        },
        error: (e) => this.formError.set(errorMessage(e)),
      });
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
    if (this.destroyRef.destroyed || this.modal() !== null) return;
    afterNextRender(
      () => {
        if (this.destroyRef.destroyed || this.modal() !== null) return;
        const container = this.columnsContainer()?.nativeElement;
        if (!container) return;
        const handles = Array.from(
          container.querySelectorAll<HTMLButtonElement>('.column-drag-handle'),
        );
        const target = handles.find(
          (el) =>
            Number(el.closest('[data-column-id]')?.getAttribute('data-column-id')) === columnId,
        );
        if (!target) return;
        target.focus();
        target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      },
      { injector: this.injector },
    );
  }
}
