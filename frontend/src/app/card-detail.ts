import { Modal } from './modal';
import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { finalize, forkJoin } from 'rxjs';
import { Api, errorMessage, textLimit } from './api';
import { Card, Column } from './models';

@Component({
  selector: 'app-card-detail',
  imports: [ReactiveFormsModule, RouterLink, DatePipe, Modal],
  templateUrl: './card-detail.html',
  styleUrl: './card-detail.css',
})
export class CardDetail implements OnInit {
  private readonly api = inject(Api);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly card = signal<Card | null>(null);
  readonly columns = signal<Column[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly confirmDelete = signal(false);
  readonly saved = signal(false);
  readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [textLimit(200, true)] }),
    description: new FormControl('', { nonNullable: true, validators: [textLimit(10000)] }),
    columnId: new FormControl(0, { nonNullable: true }),
  });
  ngOnInit() {
    this.load();
  }
  load() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.loading.set(true);
    this.error.set('');
    forkJoin({ board: this.api.board(), card: this.api.card(id) })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: ({ board, card }) => {
          this.columns.set(board.columns);
          this.card.set(card);
          this.form.reset({
            title: card.title,
            description: card.description,
            columnId: card.columnId,
          });
        },
        error: (e) => this.error.set(errorMessage(e)),
      });
  }
  save() {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving() || !this.card()) return;
    this.saving.set(true);
    this.saved.set(false);
    this.error.set('');
    const value = this.form.getRawValue();
    this.form.disable({ emitEvent: false });
    this.api
      .updateCard(this.card()!.id, { ...value, title: value.title.trim() })
      .pipe(
        finalize(() => {
          this.saving.set(false);
          this.form.enable({ emitEvent: false });
        }),
      )
      .subscribe({
        next: (card) => {
          this.card.set(card);
          this.form.reset({
            title: card.title,
            description: card.description,
            columnId: card.columnId,
          });
          this.saved.set(true);
        },
        error: (e) => this.error.set(errorMessage(e)),
      });
  }
  remove() {
    if (this.saving() || !this.card()) return;
    this.saving.set(true);
    this.error.set('');
    this.api
      .deleteCard(this.card()!.id)
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => this.router.navigate(['/']),
        error: (e) => {
          this.confirmDelete.set(false);
          this.error.set(errorMessage(e));
        },
      });
  }
}
