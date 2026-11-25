import { Injectable, inject, signal } from '@angular/core';
import { Observable, Subscription, finalize, tap } from 'rxjs';
import {
  Api,
  RecurringRule,
  RecurringRuleInput,
  RecurringRulePatch,
} from './api';
import { errorMessage } from './api-error';

export const RECURRING_LOAD_FAILURE =
  '繰り返しルールを読み込めませんでした。再試行してください。';

/** Pure list merge helpers — no HTTP / signal I/O. */
export function withCreatedRule(
  rules: RecurringRule[],
  created: RecurringRule,
): RecurringRule[] {
  return [...rules, created].sort((a, b) => a.id - b.id);
}

export function withPatchedRule(
  rules: RecurringRule[],
  updated: RecurringRule,
): RecurringRule[] {
  return rules.map((r) => (r.id === updated.id ? updated : r));
}

export function withoutRule(rules: RecurringRule[], id: number): RecurringRule[] {
  return rules.filter((r) => r.id !== id);
}

@Injectable({ providedIn: 'root' })
export class RecurringSession {
  private readonly api = inject(Api);

  readonly rules = signal<RecurringRule[] | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal('');
  private loadGeneration = 0;
  private mutateGeneration = 0;
  private loadSub?: Subscription;

  clear() {
    this.loadGeneration++;
    this.mutateGeneration++;
    this.loadSub?.unsubscribe();
    this.loadSub = undefined;
    this.rules.set(null);
    this.loading.set(false);
    this.loadError.set('');
  }

  load(): void {
    this.fetchList();
  }

  /**
   * Invalidate in-flight list/mutations, then reload.
   * onSettled runs only for this generation (success or error).
   */
  reloadForProjectSwitch(onSettled: () => void): void {
    this.mutateGeneration++;
    this.rules.set(null);
    this.fetchList(onSettled);
  }

  create(input: RecurringRuleInput): Observable<RecurringRule> {
    const generation = ++this.mutateGeneration;
    return this.api.createRecurringRule(input).pipe(
      tap((created) => {
        if (generation !== this.mutateGeneration) return;
        const cur = this.rules();
        if (cur) this.rules.set(withCreatedRule(cur, created));
        else this.fetchList();
      }),
    );
  }

  patch(id: number, patch: RecurringRulePatch): Observable<RecurringRule> {
    const generation = ++this.mutateGeneration;
    return this.api.patchRecurringRule(id, patch).pipe(
      tap((updated) => {
        if (generation !== this.mutateGeneration) return;
        const cur = this.rules();
        if (cur) this.rules.set(withPatchedRule(cur, updated));
      }),
    );
  }

  delete(id: number): Observable<void> {
    const generation = ++this.mutateGeneration;
    return this.api.deleteRecurringRule(id).pipe(
      tap(() => {
        if (generation !== this.mutateGeneration) return;
        const cur = this.rules();
        if (cur) this.rules.set(withoutRule(cur, id));
      }),
    );
  }

  private fetchList(onSettled?: () => void): void {
    // Bump before unsubscribe so a cancelled prior finalize cannot settle.
    const generation = ++this.loadGeneration;
    this.loadSub?.unsubscribe();
    this.loading.set(true);
    this.loadError.set('');
    this.loadSub = this.api
      .listRecurringRules()
      .pipe(
        finalize(() => {
          if (generation !== this.loadGeneration) return;
          this.loading.set(false);
          onSettled?.();
        }),
      )
      .subscribe({
        next: (res) => {
          if (generation !== this.loadGeneration) return;
          this.rules.set(res.rules ?? []);
          this.loadError.set('');
        },
        error: (err) => {
          if (generation !== this.loadGeneration) return;
          // GET fail ≠ empty success
          this.rules.set(null);
          this.loadError.set(errorMessage(err) || RECURRING_LOAD_FAILURE);
        },
      });
  }
}
