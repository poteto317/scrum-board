import {
  Component,
  DestroyRef,
  Input,
  OnChanges,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Subscription, catchError, forkJoin, map, of } from 'rxjs';
import { Api } from './api';
import { HistoryEvent } from './models';
import { mergePrTitleMap, missingPrTitleUrls } from './history-link-change';
import { HistoryLinkValue } from './history-link-value';
import { validPrUrl } from './pr-url';

const PR_TITLE_BATCH = 50;
const PR_TITLE_MAX_URLS = 100;

@Component({
  selector: 'app-item-history',
  imports: [DatePipe, HistoryLinkValue],
  templateUrl: './item-history.html',
  styleUrl: './item-history.css',
})
export class ItemHistory implements OnChanges {
  @Input({ required: true }) number = 0;
  @Input() projectId?: number;
  @Input() revision = '';
  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);
  private request?: Subscription;
  private titlesRequest?: Subscription;
  private generation = 0;
  private failedBefore = 0;
  readonly events = signal<HistoryEvent[]>([]);
  readonly nextBefore = signal(0);
  readonly loading = signal(false);
  readonly error = signal(false);
  /** url → display label from POST /api/pr-titles */
  readonly prTitleMap = signal<Record<string, string>>({});
  readonly labels: Record<string, string> = {
    title: 'タイトル',
    description: '説明',
    status: 'ステータス',
    prUrl: 'GitHub PR',
    prUrls: 'GitHub PR',
    relatedItems: '関連',
    assignee: '対応',
    closeReason: 'Close理由',
  };
  readonly kinds: Record<string, string> = {
    created: '作成',
    updated: '変更',
    baseline: '履歴機能導入時の状態',
    restored: '復元した記録',
  };

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.generation++;
      this.request?.unsubscribe();
      this.titlesRequest?.unsubscribe();
    });
  }

  ngOnChanges(changes: SimpleChanges) {
    this.request?.unsubscribe();
    this.titlesRequest?.unsubscribe();
    if (changes['number']) {
      this.events.set([]);
      this.nextBefore.set(0);
      this.prTitleMap.set({});
    }
    this.load(0);
  }

  more() {
    if (!this.loading() && this.nextBefore()) this.load(this.nextBefore());
  }

  retry() {
    if (!this.loading()) this.load(this.failedBefore);
  }

  safeEvidence(value: string) {
    return !!value && validPrUrl(value) && value === value.trim();
  }

  private load(before: number) {
    if (this.number <= 0) return;
    this.request?.unsubscribe();
    this.titlesRequest?.unsubscribe();
    const generation = ++this.generation;
    this.loading.set(true);
    this.error.set(false);
    this.failedBefore = before;
    const scopedProjectId = this.projectId && this.projectId > 0 ? this.projectId : undefined;
    const history$ =
      scopedProjectId != null
        ? this.api.history(this.number, before, scopedProjectId)
        : this.api.history(this.number, before);
    this.request = history$.subscribe({
      next: (page) => {
        if (generation !== this.generation) return;
        if (before) {
          this.events.set([...this.events(), ...page.events]);
          this.nextBefore.set(page.nextBefore);
        } else {
          const fresh = new Set(page.events.map((e) => e.id));
          const loaded = this.events();
          const older = loaded.filter((e) => !fresh.has(e.id));
          if (older.length === loaded.length && loaded.length && page.nextBefore) {
            this.events.set(page.events);
            this.nextBefore.set(page.nextBefore);
          } else {
            this.events.set([...page.events, ...older]);
            if (!older.length) this.nextBefore.set(page.nextBefore);
          }
        }
        this.resolvePrTitles(generation);
      },
      error: () => {
        if (generation === this.generation) {
          this.error.set(true);
          this.loading.set(false);
        }
      },
      complete: () => {
        if (generation === this.generation) this.loading.set(false);
      },
    });
  }

  private resolvePrTitles(generation: number) {
    const list = missingPrTitleUrls(this.events(), this.prTitleMap()).slice(0, PR_TITLE_MAX_URLS);
    if (!list.length) return;
    const chunks: string[][] = [];
    for (let i = 0; i < list.length; i += PR_TITLE_BATCH) {
      chunks.push(list.slice(i, i + PR_TITLE_BATCH));
    }
    this.titlesRequest?.unsubscribe();
    this.titlesRequest = forkJoin(
      chunks.map((chunk) =>
        this.api.prTitles(chunk).pipe(
          map((res) => res.titles ?? {}),
          catchError(() => of({} as Record<string, string>)),
        ),
      ),
    ).subscribe({
      next: (parts) => {
        if (generation !== this.generation) return;
        const merged = parts.reduce<Record<string, string>>(
          (acc, part) => mergePrTitleMap(acc, part),
          {},
        );
        this.prTitleMap.update((prev) => mergePrTitleMap(prev, merged));
      },
    });
  }
}
