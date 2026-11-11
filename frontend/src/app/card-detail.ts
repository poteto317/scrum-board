import { Modal } from './modal';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  catchError,
  combineLatest,
  EMPTY,
  finalize,
  forkJoin,
  startWith,
  Subject,
  switchMap,
  takeUntil,
} from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Api } from './api';
import { errorMessage } from './api-error';
import { textLimit } from './form-validation';
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
  private readonly destroyRef = inject(DestroyRef);
  private readonly reload$ = new Subject<void>();
  private readonly changed$ = new Subject<void>();
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
    combineLatest([this.route.paramMap, this.reload$.pipe(startWith(undefined))])
      .pipe(
        switchMap(([params]) => {
          // Route reuse must also cancel pending writes before a new card is shown.
          this.changed$.next();
          this.card.set(null);
          this.confirmDelete.set(false);
          this.saved.set(false);
          this.loading.set(true);
          this.error.set('');
          return forkJoin({
            board: this.api.board(),
            card: this.api.cardByNumber(Number(params.get('number'))),
          }).pipe(
            catchError((error) => {
              this.error.set(errorMessage(error));
              return EMPTY;
            }),
            finalize(() => this.loading.set(false)),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ board, card }) => {
        this.columns.set(board.columns);
        this.card.set(card);
        this.form.reset({
          title: card.title,
          description: card.description,
          columnId: card.columnId,
        });
      });
  }
  load() {
    this.reload$.next();
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
        takeUntil(this.changed$),
        takeUntilDestroyed(this.destroyRef),
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
      .pipe(
        takeUntil(this.changed$),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false)),
      )
      .subscribe({
        next: () => this.router.navigate(['/']),
        error: (e) => {
          this.confirmDelete.set(false);
          this.error.set(errorMessage(e));
        },
      });
  }
}
