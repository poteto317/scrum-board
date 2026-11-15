import { CardHistory } from './card-history';
import { Modal } from './modal';
import { Component, DestroyRef, HostListener, inject, NgZone, OnInit, signal } from '@angular/core';
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
import { ASSIGNEE_PRESETS, assigneeKind } from './assignee';
import { CardAssignee } from './card-assignee';
import { CardAutosave } from './card-autosave';
import { CardPrLinks } from './card-pr-links';
import { COMMAND_CARD_MENU_EMPTY } from './command-template';
import { CardCommandsSession } from './card-commands-session';
import { CommandTemplatesSession } from './command-templates-session';
import { CopyCommandFeedback } from './copy-command-feedback';
import { CopyLinkFeedback } from './copy-link-feedback';
import { LatestCopyFeedback } from './latest-copy-feedback';
import { sameJson, startLiveRefresh, zoneAwareTimers } from './live-refresh';

@Component({
  selector: 'app-card-detail',
  imports: [ReactiveFormsModule, RouterLink, DatePipe, Modal, CardHistory],
  providers: [
    CardAutosave,
    CardPrLinks,
    CardAssignee,
    CommandTemplatesSession,
    CardCommandsSession,
  ],
  templateUrl: './card-detail.html',
  styleUrl: './card-detail.css',
})
export class CardDetail implements OnInit {
  private readonly api = inject(Api);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly reload$ = new Subject<void>();
  private readonly changed$ = new Subject<void>();
  readonly autosave = inject(CardAutosave);
  readonly prLinks = inject(CardPrLinks);
  readonly assignee = inject(CardAssignee);
  readonly commands = inject(CommandTemplatesSession);
  readonly cardCommands = inject(CardCommandsSession);
  readonly presets = ASSIGNEE_PRESETS;
  readonly assigneeKind = assigneeKind;
  readonly card = this.autosave.card;
  readonly form = this.autosave.form;
  readonly columns = signal<Column[]>([]);
  readonly loading = signal(true);
  readonly deleting = signal(false);
  readonly error = signal('');
  readonly confirmDelete = signal(false);
  private readonly routeNumber = signal(0);
  private readonly copyStatus = new LatestCopyFeedback(this.destroyRef);
  private readonly linkCopy = new CopyLinkFeedback(this.destroyRef, this.copyStatus);
  private readonly commandCopy = new CopyCommandFeedback(this.destroyRef, this.copyStatus);
  readonly copyLinkFeedback = this.linkCopy.message;
  readonly copyCommandFeedback = this.commandCopy.message;
  readonly copyFeedback = this.copyStatus.message;
  readonly commandMenuEmpty = COMMAND_CARD_MENU_EMPTY;
  readonly commandUrlHelp = '{{url}} はこのカードのリンクに置き換わります。';
  readonly commandMenuOpen = signal(false);
  readonly managingCommands = signal(false);
  private deleted = false;

  constructor() {
    this.prLinks.bind({
      card: () => this.card(),
      applyPrSave: (updated) => this.autosave.applyPrSave(updated),
      onError: (message) => this.error.set(message),
      cancel$: this.changed$,
    });
    this.assignee.bind({
      card: () => this.card(),
      applyAssigneeSave: (updated) => this.autosave.applyAssigneeSave(updated),
      onError: (message) => this.error.set(message),
      cancel$: this.changed$,
    });
  }

  copyCardLink(): Promise<void> {
    const card = this.card();
    if (!card) return Promise.resolve();
    return this.linkCopy.copyCardNumber(card.number);
  }

  ngOnInit() {
    this.commands.load();
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.routeNumber.set(Number(params.get('number')));
    });
    combineLatest([this.route.paramMap, this.reload$.pipe(startWith(undefined))])
      .pipe(
        switchMap(([params]) => {
          this.changed$.next();
          this.autosave.reset(null);
          this.prLinks.reset();
          this.assignee.reset();
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
        this.autosave.reset({ ...card, prUrls: card.prUrls ?? [], assignee: card.assignee ?? '' });
        this.cardCommands.load(card.number);
      });
    const stop = startLiveRefresh({
      enabled: () =>
        !this.loading() &&
        this.routeNumber() > 0 &&
        !this.autosave.hasChanges() &&
        !this.cardCommands.isDirty() &&
        !this.busy(),
      fetch: () => {
        const number = this.routeNumber();
        return forkJoin({
          board: this.api.board(),
          card: this.api.cardByNumber(number),
        });
      },
      apply: ({ board, card }) => {
        if (card.number !== this.routeNumber()) return;
        if (this.autosave.hasChanges() || this.busy()) return;
        this.error.set('');
        this.columns.set(board.columns);
        const next = { ...card, prUrls: card.prUrls ?? [], assignee: card.assignee ?? '' };
        if (this.card() && sameJson(this.card(), next)) return;
        this.autosave.reset(next);
      },
      ...zoneAwareTimers(this.zone),
    });
    this.destroyRef.onDestroy(stop);
  }
  load() {
    this.reload$.next();
  }
  /** True while any immediate save or destructive action is in flight. */
  busy() {
    return (
      this.autosave.saving() ||
      this.prLinks.saving() ||
      this.assignee.saving() ||
      this.cardCommands.saving() ||
      this.confirmDelete() ||
      this.deleting()
    );
  }
  /** Saving in flight (excludes delete confirmation UI). */
  savingBusy() {
    return (
      this.autosave.saving() ||
      this.prLinks.saving() ||
      this.assignee.saving() ||
      this.cardCommands.saving() ||
      this.deleting()
    );
  }
  async canLeave(): Promise<boolean> {
    if (this.deleted) return true;
    if (this.prLinks.saving() || this.assignee.saving() || this.cardCommands.saving()) {
      return window.confirm(
        '保存中です。移動すると保存が中断される可能性があります。移動しますか？',
      );
    }
    if (this.cardCommands.isDirty()) {
      return window.confirm('未保存の変更があります。変更を破棄して移動しますか？');
    }
    if (!this.autosave.hasChanges()) return true;
    if (await this.autosave.settle()) return true;
    return window.confirm('未保存の変更があります。変更を破棄して移動しますか？');
  }
  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent) {
    if (
      !this.deleted &&
      (this.autosave.hasChanges() ||
        this.cardCommands.isDirty() ||
        this.prLinks.saving() ||
        this.assignee.saving() ||
        this.cardCommands.saving())
    ) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  remove() {
    if (
      this.deleting() ||
      this.autosave.saving() ||
      this.prLinks.saving() ||
      this.assignee.saving() ||
      !this.card()
    )
      return;
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

  toggleCommandMenu(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    this.commandMenuOpen.update((open) => !open);
  }

  copyCommand(templateText: string, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    const current = this.card();
    if (!current) return;
    this.commandMenuOpen.set(false);
    return this.commandCopy.copyResolved(templateText, current.number);
  }

  openCommandManager() {
    this.commandMenuOpen.set(false);
    this.commands.adminMessage.set('');
    this.commands.cancelEdit();
    this.managingCommands.set(true);
  }

  closeCommandManager() {
    if (this.commands.saving()) return;
    this.managingCommands.set(false);
    this.commands.cancelEdit();
  }

  applyCommandsToAllCards() {
    this.commands.applyToAllCards(undefined, () => {
      const card = this.card();
      if (card) this.cardCommands.load(card.number);
    });
  }

  setCommandDefaults() {
    this.commands.setAsDefaults();
  }

  deleteCatalogCommand(id: number) {
    this.commands.delete(id, () => {
      const card = this.card();
      if (card) this.cardCommands.load(card.number);
    });
  }

  @HostListener('document:click', ['$event'])
  closeCommandMenuFromPointer(event: Event) {
    const target = event.target;
    if (target instanceof Element && target.closest('.copy-command')) return;
    this.commandMenuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  closeCommandMenuFromKeyboard() {
    this.commandMenuOpen.set(false);
  }
}
