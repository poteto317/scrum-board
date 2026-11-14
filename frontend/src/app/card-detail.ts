import { CardHistory } from './card-history';
import { Modal } from './modal';
import { Component, DestroyRef, HostListener, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ReactiveFormsModule } from '@angular/forms';
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
import { Column } from './models';
import { CardAutosave } from './card-autosave';
import { CopyLinkFeedback } from './copy-link-feedback';

@Component({
  selector: 'app-card-detail',
  imports: [ReactiveFormsModule, RouterLink, DatePipe, Modal, CardHistory],
  providers: [CardAutosave],
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
  readonly autosave = inject(CardAutosave);
  readonly card = this.autosave.card;
  readonly form = this.autosave.form;
  readonly columns = signal<Column[]>([]);
  readonly loading = signal(true);
  readonly deleting = signal(false);
  readonly error = signal('');
  readonly confirmDelete = signal(false);
  private readonly linkCopy = new CopyLinkFeedback(this.destroyRef);
  readonly copyLinkFeedback = this.linkCopy.message;
  private deleted = false;

  copyCardLink(): Promise<void> {
    const card = this.card();
    if (!card) return Promise.resolve();
    return this.linkCopy.copyCardNumber(card.number);
  }

  ngOnInit() {
    combineLatest([this.route.paramMap, this.reload$.pipe(startWith(undefined))])
      .pipe(
        switchMap(([params]) => {
          this.changed$.next();
          this.autosave.reset(null);
          this.deleted = false;
          this.confirmDelete.set(false);
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
        this.autosave.reset(card);
      });
  }
  load() {
    this.reload$.next();
  }
  async canLeave(): Promise<boolean> {
    if (this.deleted || !this.autosave.hasChanges()) return true;
    if (await this.autosave.settle()) return true;
    return window.confirm('未保存の変更があります。変更を破棄して移動しますか？');
  }
  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent) {
    if (!this.deleted && this.autosave.hasChanges()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  remove() {
    if (this.deleting() || this.autosave.saving() || !this.card()) return;
    this.autosave.cancel();
    this.form.disable({ emitEvent: false });
    this.deleting.set(true);
    this.error.set('');
    this.api
      .deleteCard(this.card()!.id)
      .pipe(
        takeUntil(this.changed$),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.deleting.set(false);
          this.form.enable({ emitEvent: false });
        }),
      )
      .subscribe({
        next: () => {
          this.deleted = true;
          this.router.navigate(['/']);
        },
        error: (error) => {
          this.confirmDelete.set(false);
          this.error.set(errorMessage(error));
        },
      });
  }
}
