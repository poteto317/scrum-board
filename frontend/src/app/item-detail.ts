import { formatItemNumber } from './item-number';
import { ItemHistory } from './item-history';
import { Modal } from './modal';
import { Component, DestroyRef, HostListener, inject, NgZone, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ReactiveFormsModule } from '@angular/forms';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
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
import { Column, RelatedItem } from './models';
import { ASSIGNEE_PRESETS, assigneeKind } from './assignee';
import { ItemAssignee } from './item-assignee';
import { ItemAutosave } from './item-autosave';
import { ItemPrLinks } from './item-pr-links';
import { ItemRelatedItems } from './item-related-items';
import { displayLabel } from './related-item';
import { COMMAND_ITEM_MENU_EMPTY } from './command-template';
import { ItemCommandsSession } from './item-commands-session';
import { CommandTemplatesSession } from './command-templates-session';
import { AppOrigin } from './app-origin';
import { CopyCommandFeedback } from './copy-command-feedback';
import { CopyLinkFeedback } from './copy-link-feedback';
import { LatestCopyFeedback } from './latest-copy-feedback';
import { sameJson, startLiveRefresh, zoneAwareTimers } from './live-refresh';

@Component({
  selector: 'app-item-detail',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    DatePipe,
    Modal,
    ItemHistory,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
  ],
  providers: [
    ItemAutosave,
    ItemPrLinks,
    ItemRelatedItems,
    ItemAssignee,
    CommandTemplatesSession,
    ItemCommandsSession,
  ],
  templateUrl: './item-detail.html',
  styleUrl: './item-detail.css',
})
export class ItemDetail implements OnInit {
  readonly formatItemNumber = formatItemNumber;
  private readonly api = inject(Api);
  private readonly appOrigin = inject(AppOrigin);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly reload$ = new Subject<void>();
  private readonly changed$ = new Subject<void>();
  readonly autosave = inject(ItemAutosave);
  readonly prLinks = inject(ItemPrLinks);
  readonly relatedItems = inject(ItemRelatedItems);
  readonly assignee = inject(ItemAssignee);
  readonly relatedDisplayLabel = displayLabel;
  readonly commands = inject(CommandTemplatesSession);
  readonly itemCommands = inject(ItemCommandsSession);
  readonly presets = ASSIGNEE_PRESETS;
  readonly assigneeKind = assigneeKind;
  readonly item = this.autosave.item;
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
  readonly commandMenuEmpty = COMMAND_ITEM_MENU_EMPTY;
  readonly commandUrlHelp = '{{url}} はこのアイテムのリンクに置き換わります。';
  readonly commandMenuOpen = signal(false);
  readonly managingCommands = signal(false);
  /** True while a PR/related list item is being dragged (pause live refresh). */
  readonly listDragging = signal(false);
  private deleted = false;

  constructor() {
    this.prLinks.bind({
      item: () => this.item(),
      applyPrSave: (updated) => this.autosave.applyPrSave(updated),
      markPrSideDirty: () => this.autosave.markPrSideDirty(),
      onError: (message) => this.error.set(message),
      cancel$: this.changed$,
    });
    this.relatedItems.bind({
      item: () => this.item(),
      applyRelatedSave: (updated) => this.autosave.applyRelatedSave(updated),
      markRelatedSideDirty: () => this.autosave.markRelatedSideDirty(),
      onError: (message) => this.error.set(message),
      cancel$: this.changed$,
    });
    this.assignee.bind({
      item: () => this.item(),
      applyAssigneeSave: (updated) => this.autosave.applyAssigneeSave(updated),
      onError: (message) => this.error.set(message),
      cancel$: this.changed$,
    });
  }

  async copyItemLink(): Promise<void> {
    const card = this.item();
    if (!card) return;
    const origin = await this.appOrigin.resolve();
    return this.linkCopy.copyItemNumber(card.number, origin);
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
          this.relatedItems.reset();
          this.assignee.reset();
          this.listDragging.set(false);
          this.deleted = false;
          this.confirmDelete.set(false);
          this.loading.set(true);
          this.error.set('');
          return forkJoin({
            board: this.api.board(),
            card: this.api.itemByNumber(Number(params.get('number'))),
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
        this.autosave.reset({
          ...card,
          prUrls: card.prUrls ?? [],
          relatedItems: card.relatedItems ?? [],
          assignee: card.assignee ?? '',
        });
        this.itemCommands.load(card.number);
      });
    const stop = startLiveRefresh({
      enabled: () =>
        !this.loading() &&
        this.routeNumber() > 0 &&
        !this.autosave.hasChanges() &&
        !this.itemCommands.isDirty() &&
        !this.listDragging() &&
        !this.busy(),
      fetch: () => {
        const number = this.routeNumber();
        return forkJoin({
          board: this.api.board(),
          card: this.api.itemByNumber(number),
        });
      },
      apply: ({ board, card }) => {
        if (card.number !== this.routeNumber()) return;
        if (this.autosave.hasChanges() || this.listDragging() || this.busy()) return;
        this.error.set('');
        this.columns.set(board.columns);
        const next = {
          ...card,
          prUrls: card.prUrls ?? [],
          relatedItems: card.relatedItems ?? [],
          assignee: card.assignee ?? '',
        };
        if (this.item() && sameJson(this.item(), next)) return;
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
      this.relatedItems.saving() ||
      this.assignee.saving() ||
      this.itemCommands.saving() ||
      this.confirmDelete() ||
      this.deleting()
    );
  }
  /** Saving in flight (excludes delete confirmation UI). */
  savingBusy() {
    return (
      this.autosave.saving() ||
      this.prLinks.saving() ||
      this.relatedItems.saving() ||
      this.assignee.saving() ||
      this.itemCommands.saving() ||
      this.deleting()
    );
  }
  async canLeave(): Promise<boolean> {
    if (this.deleted) return true;
    if (
      this.prLinks.saving() ||
      this.relatedItems.saving() ||
      this.assignee.saving() ||
      this.itemCommands.saving()
    ) {
      return window.confirm(
        '保存中です。移動すると保存が中断される可能性があります。移動しますか？',
      );
    }
    if (this.itemCommands.isDirty()) {
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
        this.itemCommands.isDirty() ||
        this.prLinks.saving() ||
        this.relatedItems.saving() ||
        this.assignee.saving() ||
        this.itemCommands.saving())
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
      this.relatedItems.saving() ||
      this.assignee.saving() ||
      !this.item()
    )
      return;
    this.autosave.cancel();
    this.form.disable({ emitEvent: false });
    this.deleting.set(true);
    this.error.set('');
    this.api
      .deleteItem(this.item()!.id)
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
    // Loading / load failure: toggle menu so the existing status rows show (spec).
    if (this.itemCommands.loading() || this.itemCommands.loadError()) {
      this.commandMenuOpen.update((open) => !open);
      return;
    }
    const templates = this.itemCommands.templates();
    if (templates.length === 1) {
      void this.copyCommand(templates[0].template, event);
      return;
    }
    this.commandMenuOpen.update((open) => !open);
  }

  async copyCommand(templateText: string, event: Event) {
    event.preventDefault();
    event.stopPropagation();
    const current = this.item();
    if (!current) return;
    this.commandMenuOpen.set(false);
    const origin = await this.appOrigin.resolve();
    return this.commandCopy.copyResolved(templateText, current.number, origin);
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

  applyCommandsToAllItems() {
    this.commands.applyToAllItems(undefined, () => {
      const card = this.item();
      if (card) this.itemCommands.load(card.number);
    });
  }

  setCommandDefaults() {
    this.commands.setAsDefaults();
  }

  deleteCatalogCommand(id: number) {
    this.commands.delete(id, () => {
      const card = this.item();
      if (card) this.itemCommands.load(card.number);
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

  onPrDrop(event: CdkDragDrop<string[]>) {
    if (event.previousIndex === event.currentIndex) return;
    this.prLinks.reorder(event.previousIndex, event.currentIndex);
  }

  onRelatedDrop(event: CdkDragDrop<RelatedItem[]>) {
    if (event.previousIndex === event.currentIndex) return;
    this.relatedItems.reorder(event.previousIndex, event.currentIndex);
  }

  onListDragStarted() {
    this.listDragging.set(true);
  }

  onListDragEnded() {
    this.listDragging.set(false);
  }
}
