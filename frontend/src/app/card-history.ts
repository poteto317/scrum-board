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
import { Subscription } from 'rxjs';
import { Api } from './api';
import { HistoryEvent } from './models';
import { validPrUrl } from './pr-url';

@Component({
  selector: 'app-card-history',
  imports: [DatePipe],
  templateUrl: './card-history.html',
  styleUrl: './card-history.css',
})
export class CardHistory implements OnChanges {
  @Input({ required: true }) number = 0;
  @Input() revision = '';
  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);
  private request?: Subscription;
  private generation = 0;
  private failedBefore = 0;
  readonly events = signal<HistoryEvent[]>([]);
  readonly nextBefore = signal(0);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly labels: Record<string, string> = {
    title: 'タイトル',
    description: '説明',
    status: 'ステータス',
    prUrl: 'GitHub PR',
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
    });
  }
  ngOnChanges(changes: SimpleChanges) {
    this.request?.unsubscribe();
    // A revision-only change (autosave) refreshes in place; only another card drops the list.
    if (changes['number']) {
      this.events.set([]);
      this.nextBefore.set(0);
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
    const generation = ++this.generation;
    this.loading.set(true);
    this.error.set(false);
    this.failedBefore = before;
    this.request = this.api.history(this.number, before).subscribe({
      next: (page) => {
        if (generation !== this.generation) return;
        if (before) {
          this.events.set([...this.events(), ...page.events]);
          this.nextBefore.set(page.nextBefore);
          return;
        }
        // Refresh the first page, keeping older events already loaded (history is append-only).
        const fresh = new Set(page.events.map((e) => e.id));
        const loaded = this.events();
        const older = loaded.filter((e) => !fresh.has(e.id));
        // No overlap and more pages remain: events in between were added elsewhere, so a merge would hide them.
        if (older.length === loaded.length && loaded.length && page.nextBefore) {
          this.events.set(page.events);
          this.nextBefore.set(page.nextBefore);
          return;
        }
        this.events.set([...page.events, ...older]);
        if (!older.length) this.nextBefore.set(page.nextBefore);
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
}
