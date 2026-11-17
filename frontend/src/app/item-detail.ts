import { formatItemNumber } from './item-number';
import { ItemHistory } from './item-history';
import { Modal } from './modal';
import {
  afterNextRender,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  inject,
  Injector,
  NgZone,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { DatePipe, Location } from '@angular/common';
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
import { formatDueAtLocal } from './due-at';
import { DueAtPicker } from './due-at-picker';
import { ItemAssignee } from './item-assignee';
import { ItemAutosave } from './item-autosave';
import { ItemCloseTransition } from './item-close-transition';
import { ItemDueAt } from './item-due-at';
import { ItemPrLinks } from './item-pr-links';
import { ItemRelatedItems } from './item-related-items';
import { displayLabel } from './related-item';
import { prDisplayLabel } from './pr-display';
import { COMMAND_ITEM_MENU_EMPTY } from './command-template';
import { ItemCommandsSession } from './item-commands-session';
import { CommandTemplatesSession } from './command-templates-session';
import { AppOrigin } from './app-origin';
import { CopyCommandFeedback } from './copy-command-feedback';
import { CopyFeedbackBanner } from './copy-feedback-banner';
import { CopyLinkFeedback } from './copy-link-feedback';
import { LatestCopyFeedback } from './latest-copy-feedback';
import { sameJson, startLiveRefresh, zoneAwareTimers } from './live-refresh';
import { isUnmodifiedPrimaryClick } from './primary-click';
import {
  clearBoardScroll,
  clearReturnTo,
  ListReturnTo,
  readReturnTo,
} from './list-scroll-session';
import { parseDescriptionLinks } from './description-link';
import { DescriptionEditor } from './description-editor';

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
    CopyFeedbackBanner,
    DueAtPicker,
  ],
  providers: [
    ItemAutosave,
    ItemPrLinks,
    ItemRelatedItems,
    ItemAssignee,
    ItemDueAt,
    ItemCloseTransition,
    DescriptionEditor,
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
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly zone = inject(NgZone);
  private readonly reload$ = new Subject<void>();
  private readonly changed$ = new Subject<void>();
  readonly autosave = inject(ItemAutosave);
  readonly prLinks = inject(ItemPrLinks);
  readonly relatedItems = inject(ItemRelatedItems);
  readonly assignee = inject(ItemAssignee);
  readonly dueAt = inject(ItemDueAt);
  readonly closeTransition = inject(ItemCloseTransition);
  readonly descriptionEditor = inject(DescriptionEditor);
  private readonly descArea = viewChild<ElementRef<HTMLTextAreaElement>>('descArea');
  private readonly dueAtPicker = viewChild(DueAtPicker);
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
  readonly copyFeedbackKind = this.copyStatus.kind;
  readonly commandMenuEmpty = COMMAND_ITEM_MENU_EMPTY;
  readonly commandUrlHelp = '{{url}} はこのアイテムのリンクに置き換わります。';
  readonly commandMenuOpen = signal(false);
  readonly managingCommands = signal(false);
  /** True while a PR/related list item is being dragged (pause live refresh). */
  readonly listDragging = signal(false);
  private deleted = false;

  prLabel(url: string, index: number) {
    return prDisplayLabel(url, this.item()?.prTitles, index);
  }
  descriptionSegments() {
    return parseDescriptionLinks(this.form.controls.description.value ?? '');
  }
  startDescriptionEdit() {
    this.descriptionEditor.startEdit();
    this.focusDescriptionArea();
  }
  onDescriptionBlur(event: FocusEvent) {
    const next = event.relatedTarget as HTMLElement | null;
    // Keep editing when focus moves to the link toolbar or the link dialog.
    if (next?.closest('.description-edit-toolbar, .description-link-dialog')) return;
    this.descriptionEditor.endEditIfIdle();
    if (!this.descriptionEditor.open()) this.autosave.flush();
  }
  onDescriptionViewClick(event: MouseEvent) {
    this.startEditUnlessLink(event.target);
  }
  openDescriptionLink(area: HTMLTextAreaElement) {
    const start = area.selectionStart ?? 0;
    const end = area.selectionEnd ?? 0;
    this.descriptionEditor.begin({
      start,
      end,
      selectedText: area.value.slice(start, end),
    });
  }
  confirmDescriptionLink() {
    const result = this.descriptionEditor.apply(this.form.controls.description.value ?? '');
    if (!result) return;
    this.form.controls.description.setValue(result.text);
    this.form.controls.description.markAsDirty();
    this.autosave.flush();
    this.focusDescriptionArea(result.caret);
  }
  private startEditUnlessLink(target: EventTarget | null) {
    if ((target as HTMLElement | null)?.closest('a')) return;
    this.startDescriptionEdit();
  }
  private focusDescriptionArea(caret?: number) {
    afterNextRender(
      () => {
        const el = this.descArea()?.nativeElement;
        if (!el) return;
        el.focus();
        if (caret != null) el.setSelectionRange(caret, caret);
      },
      { injector: this.injector },
    );
  }

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
    this.dueAt.bind({
      item: () => this.item(),
      applyDueSave: (updated) => this.autosave.applyDueSave(updated),
      markDueSideDirty: () => this.autosave.markDueSideDirty(),
      onError: (message) => this.error.set(message),
      cancel$: this.changed$,
    });
    this.closeTransition.bind({
      item: () => this.item(),
      columns: () => this.columns(),
      columnId: this.form.controls.columnId,
      suspendFlush: (active) => this.autosave.suspendFlush(active),
      dropInFlight: () => this.autosave.dropInFlight(),
      flush: () => this.autosave.flush(),
      applyCloseSave: (updated) => this.autosave.applyCloseSave(updated),
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
          this.dueAt.reset();
          this.closeTransition.reset();
          this.descriptionEditor.reset();
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
          closeReason: card.closeReason ?? '',
          dueAt: card.dueAt ?? null,
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
          closeReason: card.closeReason ?? '',
          dueAt: card.dueAt ?? null,
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
  dueAtDisplay(): string {
    const value = this.item()?.dueAt;
    if (value == null) return '期限なし';
    return formatDueAtLocal(value) || '期限なし';
  }

  confirmDueAt() {
    this.dueAt.confirm(this.dueAtPicker()?.readPartsFromWheels() ?? null);
  }

  /** True while any immediate save or destructive action is in flight. */
  busy() {
    return (
      this.autosave.saving() ||
      this.prLinks.saving() ||
      this.relatedItems.saving() ||
      this.assignee.saving() ||
      this.dueAt.open() ||
      this.dueAt.saving() ||
      this.itemCommands.saving() ||
      this.confirmDelete() ||
      this.closeTransition.open() ||
      this.closeTransition.saving() ||
      this.descriptionEditor.open() ||
      this.deleting()
    );
  }
  /** Saving in flight (excludes delete confirmation UI / uncommitted picker open). */
  savingBusy() {
    return (
      this.autosave.saving() ||
      this.prLinks.saving() ||
      this.relatedItems.saving() ||
      this.assignee.saving() ||
      this.dueAt.saving() ||
      this.itemCommands.saving() ||
      this.closeTransition.saving() ||
      this.deleting()
    );
  }
  async canLeave(): Promise<boolean> {
    if (this.deleted) return true;
    if (
      this.prLinks.saving() ||
      this.relatedItems.saving() ||
      this.assignee.saving() ||
      this.dueAt.saving() ||
      this.closeTransition.saving() ||
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
        this.dueAt.saving() ||
        this.closeTransition.saving() ||
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
      this.dueAt.saving() ||
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
          clearReturnTo();
          clearBoardScroll();
          this.deleted = true;
          void this.router.navigate(['/']);
        },
        error: (error) => {
          this.confirmDelete.set(false);
          this.error.set(errorMessage(error));
        },
      });
  }

  private listReturnPath(): ListReturnTo {
    return readReturnTo() ?? '/';
  }

  backLinkLabel(): string {
    return this.listReturnPath() === '/backlog' ? '← バックログに戻る' : '← ボードに戻る';
  }

  /** Real list URL so middle-click / open-in-new-tab work via href. */
  backLinkHref(): string {
    return this.location.prepareExternalUrl(this.listReturnPath());
  }

  onBackClick(event: MouseEvent) {
    if (!isUnmodifiedPrimaryClick(event)) return;
    event.preventDefault();
    void this.goBackToList();
  }

  async goBackToList() {
    const to = this.listReturnPath();
    const ok = await this.router.navigateByUrl(to);
    if (ok) clearReturnTo();
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
