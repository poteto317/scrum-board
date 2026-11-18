import { formatItemNumber } from './item-number';
import { ItemHistory } from './item-history';
import { ItemComments } from './item-comments';
import { Modal } from './modal';
import {
  Component,
  DestroyRef,
  HostListener,
  inject,
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
import { ItemFavorite } from './item-favorite';
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
import { DescriptionEditor } from './description-editor';
import { DescriptionBlocksEditor } from './description-blocks-editor';
import { ProjectSession } from './project-session';

@Component({
  selector: 'app-item-detail',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    DatePipe,
    Modal,
    ItemComments,
    ItemHistory,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    CopyFeedbackBanner,
    DueAtPicker,
    DescriptionBlocksEditor,
  ],
  providers: [
    ItemAutosave,
    ItemPrLinks,
    ItemRelatedItems,
    ItemAssignee,
    ItemFavorite,
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
  readonly projectSession = inject(ProjectSession);
  private readonly appOrigin = inject(AppOrigin);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly reload$ = new Subject<void>();
  private readonly changed$ = new Subject<void>();
  readonly autosave = inject(ItemAutosave);
  readonly prLinks = inject(ItemPrLinks);
  readonly relatedItems = inject(ItemRelatedItems);
  readonly assignee = inject(ItemAssignee);
  readonly favorite = inject(ItemFavorite);
  readonly dueAt = inject(ItemDueAt);
  readonly closeTransition = inject(ItemCloseTransition);
  readonly descriptionEditor = inject(DescriptionEditor);
  private readonly blocksEditor = viewChild(DescriptionBlocksEditor);
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
  readonly projectSaving = signal(false);
  readonly projectMoveError = signal('');
  readonly error = signal('');
  private projectMoveGeneration = 0;
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
  onDescriptionText(text: string): void {
    this.form.controls.description.setValue(text, { emitEvent: true });
    this.form.controls.description.markAsDirty();
  }
  onDescriptionComposition(composing: boolean): void {
    this.autosave.composition('description', composing);
  }
  onDescriptionLinkRequest(sel: {
    blockIndex: number;
    start: number;
    end: number;
    selectedText: string;
  }): void {
    this.descriptionEditor.begin(sel);
  }
  confirmDescriptionLink(): void {
    const editor = this.blocksEditor();
    const blocks = editor?.blocks() ?? [this.form.controls.description.value ?? ''];
    const result = this.descriptionEditor.apply(blocks);
    if (!result) return;
    this.form.controls.description.setValue(result.text, { emitEvent: true });
    this.form.controls.description.markAsDirty();
    editor?.syncFromSerialized(result.text);
    this.autosave.flush();
    editor?.focusBlock(result.blockIndex, result.caret);
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
    this.favorite.bind({
      item: () => this.item(),
      applyFavoriteSave: (updated) => this.autosave.applyFavoriteSave(updated),
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
    const projectId = card.projectId > 0 ? card.projectId : undefined;
    return this.linkCopy.copyItemNumber(card.number, origin, projectId);
  }

  ngOnInit() {
    this.commands.load();
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.routeNumber.set(Number(params.get('number')));
    });
    combineLatest([
      this.route.paramMap,
      this.route.queryParamMap,
      this.reload$.pipe(startWith(undefined)),
    ])
      .pipe(
        switchMap(([params, query]) => {
          this.changed$.next();
          this.autosave.reset(null);
          this.prLinks.reset();
          this.relatedItems.reset();
          this.assignee.reset();
          this.favorite.reset();
          this.dueAt.reset();
          this.closeTransition.reset();
          this.descriptionEditor.reset();
          this.listDragging.set(false);
          this.deleted = false;
          this.confirmDelete.set(false);
          this.projectMoveGeneration++;
          this.projectSaving.set(false);
          this.projectMoveError.set('');
          this.loading.set(true);
          this.error.set('');
          const num = Number(params.get('number'));
          const queryProjectId = Number(query.get('project'));
          return this.loadCardForRoute(num, queryProjectId);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ board, card }) => {
        this.columns.set(board.columns);
        const projectId = card.projectId ?? 0;
        this.autosave.reset({
          ...card,
          projectId,
          prUrls: card.prUrls ?? [],
          relatedItems: card.relatedItems ?? [],
          assignee: card.assignee ?? '',
          closeReason: card.closeReason ?? '',
          solution: card.solution ?? '',
          favorite: card.favorite === true,
          dueAt: card.dueAt ?? null,
        });
        this.itemCommands.load(card.number, projectId > 0 ? projectId : undefined);
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
        const card = this.item();
        const projectId =
          card && card.projectId > 0
            ? card.projectId
            : this.projectSession.activeId() ?? undefined;
        const scopedProjectId = projectId && projectId > 0 ? projectId : undefined;
        return forkJoin({
          board: this.api.board(),
          card: this.api.itemByNumber(number, scopedProjectId),
        });
      },
      apply: ({ board, card }) => {
        if (card.number !== this.routeNumber()) return;
        if (this.autosave.hasChanges() || this.listDragging() || this.busy()) return;
        this.error.set('');
        this.columns.set(board.columns);
        const next = {
          ...card,
          projectId: card.projectId ?? 0,
          prUrls: card.prUrls ?? [],
          relatedItems: card.relatedItems ?? [],
          assignee: card.assignee ?? '',
          closeReason: card.closeReason ?? '',
          solution: card.solution ?? '',
          favorite: card.favorite === true,
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

  private loadCardForRoute(number: number, projectId: number) {
    const scopedProjectId = projectId > 0 ? projectId : undefined;
    const load$ = () =>
      forkJoin({
        board: this.api.board(),
        card: this.api.itemByNumber(number, scopedProjectId),
      });
    const settleLoad = (source: ReturnType<typeof load$>) =>
      source.pipe(
        catchError((error) => {
          this.error.set(errorMessage(error));
          return EMPTY;
        }),
        finalize(() => this.loading.set(false)),
      );
    if (projectId > 0 && projectId !== this.projectSession.activeId()) {
      // Temporary listener so switchTo keeps switching until endSwitch (L-037).
      // Do not leave a permanent onSwitched — that would block header switches.
      const releaseListener = this.projectSession.onSwitched(() => undefined);
      return this.projectSession.switchTo(projectId).pipe(
        switchMap(() => settleLoad(load$())),
        catchError((error) => {
          this.error.set(errorMessage(error));
          this.loading.set(false);
          return EMPTY;
        }),
        finalize(() => {
          this.projectSession.endSwitch();
          releaseListener();
          // switchTo may complete EMPTY (already switching); ensure spinner clears.
          this.loading.set(false);
        }),
      );
    }
    return settleLoad(load$());
  }

  onProjectChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const nextId = Number(select.value);
    const card = this.item();
    if (!card || !Number.isFinite(nextId) || nextId <= 0) return;
    if (nextId === card.projectId || this.projectSaving()) {
      select.value = String(card.projectId);
      return;
    }
    this.moveToProject(nextId, select);
  }

  /**
   * Move the item, then align the active project when it differs.
   * A failed settings PATCH is shown once and is not retried automatically (L-001).
   * Opening this screen does not call this method (no deep-link auto-switch).
   */
  moveToProject(nextId: number, select?: HTMLSelectElement) {
    const card = this.item();
    if (!card || this.projectSaving()) return;
    const generation = ++this.projectMoveGeneration;
    this.projectSaving.set(true);
    this.projectMoveError.set('');
    this.error.set('');
    this.api.updateItem(card.id, { projectId: nextId }).subscribe({
      next: (updated) => {
        if (generation !== this.projectMoveGeneration) return;
        const projectId = typeof updated.projectId === 'number' ? updated.projectId : nextId;
        this.autosave.applyProjectSave({
          projectId,
          updatedAt: updated.updatedAt || card.updatedAt,
        });
        if (this.projectSession.activeId() === projectId) {
          this.projectSaving.set(false);
          return;
        }
        this.alignActiveProject(projectId, generation);
      },
      error: (e) => {
        if (generation !== this.projectMoveGeneration) return;
        if (select) select.value = String(card.projectId);
        this.projectMoveError.set(errorMessage(e));
        this.projectSaving.set(false);
      },
    });
  }

  /** Manual retry of the settings half after the item has already moved. */
  retryAlignActiveProject() {
    const card = this.item();
    if (!card || this.projectSaving()) return;
    if (this.projectSession.activeId() === card.projectId) return;
    const generation = ++this.projectMoveGeneration;
    this.alignActiveProject(card.projectId, generation);
  }

  private alignActiveProject(projectId: number, generation: number) {
    this.projectSaving.set(true);
    this.projectMoveError.set('');
    this.projectSession.patchActive(projectId).subscribe({
      next: () => {
        if (generation !== this.projectMoveGeneration) return;
        this.projectMoveError.set('');
        this.projectSaving.set(false);
      },
      error: (e) => {
        if (generation !== this.projectMoveGeneration) return;
        this.projectMoveError.set(errorMessage(e));
        this.projectSaving.set(false);
      },
    });
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
      this.favorite.saving() ||
      this.dueAt.open() ||
      this.dueAt.saving() ||
      this.itemCommands.saving() ||
      this.confirmDelete() ||
      this.closeTransition.open() ||
      this.closeTransition.saving() ||
      this.descriptionEditor.open() ||
      this.projectSaving() ||
      this.projectSession.switching() ||
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
      this.favorite.saving() ||
      this.dueAt.saving() ||
      this.itemCommands.saving() ||
      this.closeTransition.saving() ||
      this.projectSaving() ||
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
      this.itemCommands.saving() ||
      this.projectSaving()
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
        this.itemCommands.saving() ||
        this.projectSaving())
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
    const projectId = current.projectId > 0 ? current.projectId : undefined;
    return this.commandCopy.copyResolved(templateText, current.number, origin, projectId);
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
