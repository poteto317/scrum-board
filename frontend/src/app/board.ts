import { Modal } from './modal';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { Api, errorMessage, textLimit } from './api';
import { BoardData } from './models';

@Component({
  selector: 'app-board',
  imports: [ReactiveFormsModule, RouterLink, Modal],
  templateUrl: './board.html',
  styleUrl: './board.css',
})
export class Board implements OnInit {
  private readonly api = inject(Api);
  readonly data = signal<BoardData>({ columns: [], cards: [] });
  readonly loading = signal(true);
  readonly error = signal('');
  readonly saving = signal(false);
  readonly modal = signal<'column' | 'card' | null>(null);
  readonly formError = signal('');
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
  load() {
    this.loading.set(true);
    this.error.set('');
    this.api
      .board()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({ next: (d) => this.data.set(d), error: (e) => this.error.set(errorMessage(e)) });
  }
  openColumn() {
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
  addColumn() {
    if (this.columnForm.invalid || this.saving()) {
      this.columnForm.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.formError.set('');
    this.api
      .createColumn(this.columnForm.controls.name.value.trim())
      .pipe(finalize(() => this.saving.set(false)))
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
    this.api
      .createCard({ ...value, title: value.title.trim() })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (card) => {
          this.data.update((d) => ({ ...d, cards: [...d.cards, card] }));
          this.modal.set(null);
        },
        error: (e) => this.formError.set(errorMessage(e)),
      });
  }
}
