import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Api } from './api';
import { Card, CardInput } from './models';
import { textLimit } from './form-validation';
import { prUrlValidator } from './pr-url';
import { errorMessage } from './api-error';

const fields = ['title', 'description', 'columnId', 'prUrl'] as const;
type Field = (typeof fields)[number];

// Provided by CardDetail: drafts and timers never survive a detail screen.
@Injectable()
export class CardAutosave {
  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);
  readonly card = signal<Card | null>(null);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly changed = signal(false);
  readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [textLimit(200, true)] }),
    description: new FormControl('', { nonNullable: true, validators: [textLimit(10000)] }),
    columnId: new FormControl(0, { nonNullable: true, validators: [Validators.min(1)] }),
    prUrl: new FormControl('', { nonNullable: true, validators: [prUrlValidator] }),
  });
  private timer?: ReturnType<typeof setTimeout>;
  private maxTimer?: ReturnType<typeof setTimeout>;
  private request?: Subscription;
  private generation = 0;
  private composing = new Set<Field>();
  private retryFields = new Set<Field>();
  private edits: Record<Field, number> = { title: 0, description: 0, columnId: 0, prUrl: 0 };
  private waiters: ((saved: boolean) => void)[] = [];

  constructor() {
    for (const field of fields) {
      const control = this.form.controls[field] as FormControl<string | number>;
      control.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.edits[field]++);
    }
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.changed.set(true);
      this.schedule();
    });
    this.destroyRef.onDestroy(() => this.cancel());
  }
  reset(card: Card | null) {
    this.cancel();
    this.card.set(card);
    this.composing.clear();
    this.retryFields.clear();
    this.error.set('');
    this.changed.set(false);
    if (card)
      this.form.reset(
        {
          title: card.title,
          description: card.description,
          columnId: card.columnId,
          prUrl: card.prUrl,
        },
        { emitEvent: false },
      );
  }
  private value(field: Field) {
    const raw = this.form.controls[field].value;
    return field === 'title' || field === 'prUrl' ? String(raw).trim() : raw;
  }
  hasChanges(): boolean {
    // Even a reverted draft must wait for an earlier in-flight write to settle.
    if (this.saving() || this.retryFields.size || this.composing.size) return true;
    const card = this.card();
    return !!card && fields.some((field) => this.value(field) !== card[field]);
  }
  private patch(): Partial<CardInput> {
    const card = this.card();
    const patch: Record<string, string | number> = {};
    if (card)
      for (const field of fields) {
        if (
          !this.composing.has(field) &&
          this.form.controls[field].valid &&
          (this.retryFields.has(field) || this.value(field) !== card[field])
        )
          patch[field] = this.value(field);
      }
    return patch;
  }
  composition(field: Field, active: boolean) {
    if (active) this.composing.add(field);
    else {
      this.composing.delete(field);
      this.schedule();
    }
  }
  private schedule() {
    if (!this.card()) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 600);
    this.maxTimer ??= setTimeout(() => this.flush(), 2000);
  }
  private clearTimers() {
    clearTimeout(this.timer);
    clearTimeout(this.maxTimer);
    this.timer = undefined;
    this.maxTimer = undefined;
  }
  flush() {
    this.clearTimers();
    if (this.saving() || !this.card()) return;
    const patch = this.patch();
    if (!Object.keys(patch).length) {
      this.resolveWaiters();
      return;
    }
    const snapshot = this.form.getRawValue();
    const edits = { ...this.edits };
    const confirmed = this.card()!;
    const generation = this.generation;
    this.saving.set(true);
    this.error.set('');
    this.request = this.api.updateCard(this.card()!.id, patch).subscribe({
      next: (card) => {
        if (generation !== this.generation) return;
        for (const field of fields) {
          if (field in patch) this.retryFields.delete(field);
          if (
            !this.composing.has(field) &&
            this.form.controls[field].value === snapshot[field] &&
            (field in patch ||
              (edits[field] === this.edits[field] && this.value(field) === confirmed[field]))
          ) {
            // Keep edits made while the request was pending, including a return to the original value.
            const control = this.form.controls[field] as FormControl<string | number>;
            control.setValue(card[field], { emitEvent: false });
          }
        }
        this.card.set(card);
      },
      error: (error) => {
        if (generation !== this.generation) return;
        // A lost response can mean the write committed; resend these fields even if reverted locally.
        for (const field of fields) if (field in patch) this.retryFields.add(field);
        this.saving.set(false);
        this.clearTimers();
        this.error.set(errorMessage(error));
        this.resolveWaiters();
      },
      complete: () => {
        if (generation !== this.generation) return;
        this.saving.set(false);
        if (Object.keys(this.patch()).length) this.flush();
        else this.resolveWaiters();
      },
    });
  }
  settle(): Promise<boolean> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      this.flush();
      this.resolveWaiters();
    });
  }
  private resolveWaiters() {
    if (this.saving()) return;
    const saved = !this.hasChanges();
    for (const resolve of this.waiters.splice(0)) resolve(saved);
  }
  cancel() {
    this.generation++;
    this.clearTimers();
    this.request?.unsubscribe();
    this.request = undefined;
    this.saving.set(false);
    for (const resolve of this.waiters.splice(0)) resolve(false);
  }
}
