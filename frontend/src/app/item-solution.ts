import { formatItemNumber } from './item-number';
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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  catchError,
  combineLatest,
  debounceTime,
  EMPTY,
  filter,
  forkJoin,
  type Observable,
  of,
  Subject,
  switchMap,
  tap,
} from 'rxjs';
import { Api } from './api';
import {
  DESCRIPTION_MAX_LEN,
  parseDescriptionBlocks,
} from './description-blocks';
import { DescriptionBlocksEditor } from './description-blocks-editor';
import { DescriptionEditor } from './description-editor';
import { textLimit } from './form-validation';
import { sameJson, startLiveRefresh, zoneAwareTimers } from './live-refresh';
import type { Item } from './models';
import { Modal } from './modal';
import { normalizeItem } from './board-data';
import { ProjectSession } from './project-session';
import { ItemFavorite } from './item-favorite';
import { favoriteMenuLabel, ItemMenuActions } from './item-menu-actions';

const SOLUTION_LENGTH_ERROR = `ソリューションは${DESCRIPTION_MAX_LEN}文字以内で入力してください。`;

@Component({
  selector: 'app-item-solution',
  imports: [ReactiveFormsModule, RouterLink, DescriptionBlocksEditor, Modal],
  providers: [DescriptionEditor, ItemFavorite],
  templateUrl: './item-solution.html',
  styleUrl: './item-solution.css',
})
export class ItemSolution implements OnInit {
  private readonly api = inject(Api);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);
  private readonly projectSession = inject(ProjectSession);
  private readonly router = inject(Router);
  readonly descriptionEditor = inject(DescriptionEditor);
  readonly favorite = inject(ItemFavorite);
  private readonly itemMenuActions = inject(ItemMenuActions);
  private readonly blocksEditor = viewChild(DescriptionBlocksEditor);
  private readonly reload$ = new Subject<void>();
  private readonly changed$ = new Subject<void>();
  private saveGeneration = 0;
  private flushWaiters: Array<(ok: boolean) => void> = [];

  readonly formatItemNumber = formatItemNumber;
  readonly solutionLengthError = SOLUTION_LENGTH_ERROR;
  readonly loading = signal(true);
  readonly error = signal('');
  readonly saveError = signal('');
  readonly saving = signal(false);
  readonly item = signal<Item | null>(null);
  readonly routeNumber = signal(0);
  readonly control = new FormControl('', {
    nonNullable: true,
    validators: [textLimit(DESCRIPTION_MAX_LEN)],
  });
  private baseline = '';
  private dirty = false;
  private composing = false;

  constructor() {
    this.favorite.bind({
      item: () => this.item(),
      applyFavoriteSave: (updated) => {
        const card = this.item();
        if (!card) return;
        this.item.set({
          ...card,
          favorite: updated.favorite === true,
          updatedAt: updated.updatedAt,
        });
      },
      onError: (message) => this.error.set(message),
      cancel$: this.changed$,
    });
  }

  ngOnInit() {
    this.itemMenuActions.register({
      scrollToHistory: () => this.navigateToDetailForHistory(),
      goToSolution: () => false,
      toggleFavorite: () => this.favorite.toggle(),
      favoriteLabel: () => favoriteMenuLabel(this.item()?.favorite),
      favoriteDisabled: () => this.favorite.saving() || !this.item(),
    });
    this.destroyRef.onDestroy(() => this.itemMenuActions.unregister());
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.routeNumber.set(Number(params.get('number')));
    });
    combineLatest([this.route.paramMap, this.route.queryParamMap, this.reload$])
      .pipe(
        switchMap(([params, query]) => {
          this.changed$.next();
          this.favorite.reset();
          this.saveGeneration++;
          this.saving.set(false);
          this.resolveFlush(false);
          this.descriptionEditor.reset();
          this.loading.set(true);
          this.error.set('');
          this.saveError.set('');
          this.dirty = false;
          this.baseline = '';
          this.item.set(null);
          this.control.setValue('', { emitEvent: false });
          const num = Number(params.get('number'));
          const queryProjectId = Number(query.get('project'));
          const projectId =
            queryProjectId > 0 ? queryProjectId : this.projectSession.activeId() ?? undefined;
          return forkJoin({
            card: this.api.itemByNumber(num, projectId && projectId > 0 ? projectId : undefined),
          }).pipe(
            catchError(() => {
              this.loading.set(false);
              this.item.set(null);
              this.error.set('ソリューションを読み込めませんでした。');
              return EMPTY;
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ card }) => {
        const next = normalizeItem(card);
        this.item.set(next);
        this.baseline = next.solution;
        this.control.setValue(next.solution, { emitEvent: false });
        this.dirty = false;
        this.loading.set(false);
      });

    this.control.valueChanges
      .pipe(
        tap((value) => {
          this.dirty = value !== this.baseline;
          this.saveError.set('');
        }),
        debounceTime(400),
        filter(() => this.dirty && this.control.valid),
        switchMap((value) => this.persist(value)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();

    const stop = startLiveRefresh({
      enabled: () =>
        !this.loading() &&
        this.routeNumber() > 0 &&
        !this.dirty &&
        !this.saving() &&
        !this.favorite.saving() &&
        !this.composing &&
        !this.descriptionEditor.open(),
      fetch: () => {
        const number = this.routeNumber();
        const card = this.item();
        const projectId =
          card && card.projectId > 0
            ? card.projectId
            : this.projectSession.activeId() ?? undefined;
        return this.api.itemByNumber(number, projectId && projectId > 0 ? projectId : undefined);
      },
      apply: (card) => {
        if (card.number !== this.routeNumber()) return;
        if (
          this.dirty ||
          this.saving() ||
          this.favorite.saving() ||
          this.composing ||
          this.descriptionEditor.open()
        ) {
          return;
        }
        const next = normalizeItem(card);
        if (this.item() && sameJson(this.item(), next)) return;
        this.item.set(next);
        this.baseline = next.solution;
        this.control.setValue(next.solution, { emitEvent: false });
      },
      ...zoneAwareTimers(this.zone),
    });
    this.destroyRef.onDestroy(stop);
    this.reload$.next();
  }

  detailLink(): string[] {
    const card = this.item();
    return card ? ['/items', String(card.number)] : ['/'];
  }

  detailQuery(): Record<string, number> {
    const card = this.item();
    return card && card.projectId > 0 ? { project: card.projectId } : {};
  }

  private navigateToDetailForHistory() {
    const card = this.item();
    if (!card) return;
    const queryParams: Record<string, string | number> = { scrollHistory: '1' };
    if (card.projectId > 0) queryParams['project'] = card.projectId;
    void this.router.navigate(['/items', card.number], { queryParams });
  }

  onTextChange(text: string) {
    this.control.setValue(text, { emitEvent: true });
    this.control.markAsDirty();
  }

  onCompositionChange(composing: boolean) {
    this.composing = composing;
  }

  onLinkRequest(sel: {
    blockIndex: number;
    start: number;
    end: number;
    selectedText: string;
  }): void {
    this.descriptionEditor.begin(sel);
  }

  confirmDescriptionLink(): void {
    const editor = this.blocksEditor();
    const blocks = editor?.blocks() ?? parseDescriptionBlocks(this.control.value);
    const result = this.descriptionEditor.apply(blocks, 'ソリューション');
    if (!result) return;
    this.control.setValue(result.text, { emitEvent: true });
    this.control.markAsDirty();
    editor?.syncFromSerialized(result.text);
    editor?.focusBlock(result.blockIndex, result.caret);
  }

  load() {
    this.reload$.next();
  }

  private persist(value: string): Observable<Item | null> {
    const card = this.item();
    if (!card) {
      this.resolveFlush(false);
      return of(null);
    }
    const generation = ++this.saveGeneration;
    this.saving.set(true);
    this.saveError.set('');
    return this.api.updateItem(card.id, { solution: value }).pipe(
      tap({
        next: (saved) => {
          if (generation !== this.saveGeneration) return;
          const next = normalizeItem(saved);
          this.item.set(next);
          this.baseline = next.solution;
          this.dirty = this.control.value !== this.baseline;
          this.saving.set(false);
          if (this.dirty && this.control.valid) {
            this.persist(this.control.value).subscribe();
            return;
          }
          this.resolveFlush(!this.dirty);
        },
        error: () => {
          if (generation !== this.saveGeneration) return;
          this.saving.set(false);
          this.saveError.set('ソリューションの保存に失敗しました。');
          this.resolveFlush(false);
        },
      }),
      catchError(() => of(null)),
    );
  }

  private resolveFlush(ok: boolean) {
    const waiters = this.flushWaiters;
    this.flushWaiters = [];
    waiters.forEach((w) => w(ok));
  }

  private settle(): Promise<boolean> {
    if (!this.dirty) return Promise.resolve(true);
    if (!this.control.valid) return Promise.resolve(false);
    return new Promise((resolve) => {
      this.flushWaiters.push(resolve);
      this.persist(this.control.value).subscribe();
    });
  }

  async canLeave(): Promise<boolean> {
    if (this.saving()) {
      return window.confirm(
        '保存中です。移動すると保存が中断される可能性があります。移動しますか？',
      );
    }
    if (!this.dirty) return true;
    if (await this.settle()) return true;
    return window.confirm('未保存の変更があります。変更を破棄して移動しますか？');
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent) {
    if (this.dirty || this.saving()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
}
