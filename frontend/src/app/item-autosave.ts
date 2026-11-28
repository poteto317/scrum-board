import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Api } from './api';
import { Item, ItemInput, ItemPatch } from './models';
import { textLimit, trimmedTextLimit } from './form-validation';
import { errorMessage } from './api-error';
import { alignPrTitles } from './pr-display';
import { mergeCloseTransitionItem } from './close-reason';
import { Label, normalizeLabels } from './label';

const fields = ['title', 'description', 'columnId', 'closeReason'] as const;
type Field = (typeof fields)[number];
/** Item fields updated outside the autosave form; prefer local on form flush. */
const sideFields = ['prUrls', 'relatedItems', 'labels', 'assignee', 'dueAt'] as const;
type SideField = (typeof sideFields)[number];

// Provided by ItemDetail: drafts and timers never survive a detail screen.
@Injectable()
export class ItemAutosave {
  private readonly api = inject(Api);
  private readonly destroyRef = inject(DestroyRef);
  readonly item = signal<Item | null>(null);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly changed = signal(false);
  readonly form = new FormGroup({
    title: new FormControl('', { nonNullable: true, validators: [textLimit(200, true)] }),
    description: new FormControl('', { nonNullable: true, validators: [textLimit(10000)] }),
    columnId: new FormControl(0, { nonNullable: true, validators: [Validators.min(1)] }),
    closeReason: new FormControl('', { nonNullable: true, validators: [trimmedTextLimit(2000)] }),
  });
  private timer?: ReturnType<typeof setTimeout>;
  private maxTimer?: ReturnType<typeof setTimeout>;
  private request?: Subscription;
  private generation = 0;
  private composing = new Set<Field>();
  private retryFields = new Set<Field>();
  private edits: Record<Field, number> = { title: 0, description: 0, columnId: 0, closeReason: 0 };
  private sideDirty = new Set<SideField>();
  /** Shield projectId from an in-flight title/description flush after a move. */
  private projectDirty = false;
  /** Shield favorite from an in-flight title/description flush after a toggle. */
  private favoriteDirty = false;
  private waiters: ((saved: boolean) => void)[] = [];
  /** Blocks debounced/explicit flush while a modal holds uncommitted form state. */
  private suspended = false;

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
  /** Pause/resume autosave (e.g. while a confirm modal owns the form draft). */
  suspendFlush(active: boolean) {
    this.suspended = active;
    if (active) this.clearTimers();
    else if (this.hasChanges()) this.schedule();
  }
  /** Drop in-flight form flush so a parallel dedicated PATCH cannot be overwritten by a stale response. */
  dropInFlight() {
    this.generation++;
    this.clearTimers();
    this.request?.unsubscribe();
    this.request = undefined;
    this.saving.set(false);
    for (const resolve of this.waiters.splice(0)) resolve(false);
  }
  /** Apply AI「説明に反映」: sync description form+item without a conflicting autosave flush. */
  applyDescriptionSave(updated: Pick<Item, 'description' | 'updatedAt'>) {
    const card = this.item();
    if (!card) return;
    this.dropInFlight();
    const description = updated.description ?? '';
    this.item.set({
      ...card,
      description,
      updatedAt: updated.updatedAt || card.updatedAt,
    });
    this.form.controls.description.setValue(description, { emitEvent: false });
    this.changed.set(false);
  }
  /** Apply Close transition response: merge side fields and sync columnId/closeReason controls. */
  applyCloseSave(updated: Item) {
    const local = this.item();
    const merged = mergeCloseTransitionItem(local, updated);
    // PATCH omits prTitles; keep/remap local enrichment like form flush (L-002).
    if (local?.prTitles?.length || updated.prTitles?.length) {
      merged.prTitles = alignPrTitles(
        local?.prUrls ?? updated.prUrls ?? [],
        local?.prTitles ?? updated.prTitles,
        merged.prUrls,
      );
    }
    this.item.set(merged);
    this.form.controls.columnId.setValue(merged.columnId, { emitEvent: false });
    this.form.controls.closeReason.setValue(merged.closeReason ?? '', { emitEvent: false });
  }
  reset(item: Item | null) {
    this.cancel();
    this.item.set(item);
    this.composing.clear();
    this.retryFields.clear();
    this.sideDirty.clear();
    this.error.set('');
    this.changed.set(false);
    if (item)
      this.form.reset(
        {
          title: item.title,
          description: item.description,
          columnId: item.columnId,
          closeReason: item.closeReason ?? '',
        },
        { emitEvent: false },
      );
  }
  /** Merge immediate side-field saves without touching form drafts. */
  applySideSave(updated: Partial<Pick<Item, SideField | 'prTitles' | 'updatedAt'>>) {
    const card = this.item();
    if (!card) return;
    const next: Item = {
      ...card,
      updatedAt: updated.updatedAt || card.updatedAt,
    };
    for (const key of sideFields) {
      if (updated[key] === undefined) continue;
      // Shield when a form flush is in flight. applyPrSave / applyRelatedSave also mark their
      // fields so optimistic side edits before mark*SideDirty still win over a concurrent flush.
      if (this.saving()) this.sideDirty.add(key);
      if (key === 'dueAt') continue; // null-safe merge lives in applyDueSave only
      if (key === 'prUrls') next.prUrls = [...(updated.prUrls ?? [])];
      else if (key === 'relatedItems') next.relatedItems = [...(updated.relatedItems ?? [])];
      else if (key === 'labels') next.labels = normalizeLabels(updated.labels);
      else next[key] = (updated[key] as string) ?? '';
    }
    if (updated.prTitles !== undefined) {
      next.prTitles = [...updated.prTitles];
    }
    this.item.set(next);
  }
  applyPrSave(updated: Pick<Item, 'prUrls' | 'prTitles' | 'updatedAt'>) {
    this.sideDirty.add('prUrls');
    this.applySideSave(updated);
  }
  /** Shield prUrls from an in-flight title/description flush (L-453). */
  markPrSideDirty() {
    this.sideDirty.add('prUrls');
  }
  /** Shield relatedItems from an in-flight title/description flush (L-453). */
  markRelatedSideDirty() {
    this.sideDirty.add('relatedItems');
  }
  applyRelatedSave(updated: Pick<Item, 'relatedItems' | 'updatedAt'>) {
    this.sideDirty.add('relatedItems');
    this.applySideSave(updated);
  }
  applyAssigneeSave(updated: Pick<Item, 'assignee' | 'updatedAt'>) {
    this.applySideSave(updated);
  }
  /** Merge favorite without putting it on the autosave form (L-453 / L-790). */
  applyFavoriteSave(updated: Pick<Item, 'favorite' | 'updatedAt'>) {
    const card = this.item();
    if (!card) return;
    // Always shield: a later title/description flush must not overwrite the star
    // with a stale PATCH response (same pattern as projectDirty).
    this.favoriteDirty = true;
    this.item.set({
      ...card,
      favorite: updated.favorite === true,
      updatedAt: updated.updatedAt || card.updatedAt,
    });
  }
  /** Shield dueAt from an in-flight title/description flush (L-453). */
  markDueSideDirty() {
    this.sideDirty.add('dueAt');
  }
  /** Merge a project move without going through the autosave form. */
  applyProjectSave(updated: Pick<Item, 'projectId' | 'updatedAt'>) {
    const card = this.item();
    if (!card) return;
    this.projectDirty = true;
    this.item.set({
      ...card,
      projectId: updated.projectId,
      updatedAt: updated.updatedAt || card.updatedAt,
    });
  }
  /** Merge dueAt side save without string `?? ''` (L-002: keep null). */
  applyDueSave(updated: Pick<Item, 'dueAt' | 'updatedAt'>) {
    this.sideDirty.add('dueAt');
    const card = this.item();
    if (!card) return;
    if (this.saving()) this.sideDirty.add('dueAt');
    this.item.set({
      ...card,
      dueAt: updated.dueAt ?? null,
      updatedAt: updated.updatedAt || card.updatedAt,
    });
  }
  applyLabelsSave(updated: Pick<Item, 'labels' | 'updatedAt'>) {
    this.applySideSave(updated);
  }
  applyCatalogLabelUpdate(updated: Label) {
    const card = this.item();
    if (!card?.labels?.some((l) => l.id === updated.id)) return;
    if (this.saving()) this.sideDirty.add('labels');
    this.item.set({
      ...card,
      labels: card.labels.map((l) => (l.id === updated.id ? { ...updated } : l)),
    });
  }
  applyCatalogLabelDelete(labelId: number) {
    const card = this.item();
    if (!card?.labels?.some((l) => l.id === labelId)) return;
    if (this.saving()) this.sideDirty.add('labels');
    this.item.set({
      ...card,
      labels: card.labels.filter((l) => l.id !== labelId),
    });
  }
  private value(field: Field) {
    const raw = this.form.controls[field].value;
    return field === 'title' || field === 'closeReason' ? String(raw).trim() : raw;
  }
  hasChanges(): boolean {
    // Even a reverted draft must wait for an earlier in-flight write to settle.
    if (this.saving() || this.retryFields.size || this.composing.size) return true;
    const card = this.item();
    return !!card && fields.some((field) => this.value(field) !== card[field]);
  }
  private patch(): ItemPatch {
    const card = this.item();
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
    if (this.suspended || !this.item()) return;
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
    if (this.suspended || this.saving() || !this.item()) return;
    const patch = this.patch();
    if (!Object.keys(patch).length) {
      this.resolveWaiters();
      return;
    }
    const snapshot = this.form.getRawValue();
    const edits = { ...this.edits };
    const confirmed = this.item()!;
    const generation = this.generation;
    this.saving.set(true);
    this.error.set('');
    this.request = this.api.updateItem(this.item()!.id, patch).subscribe({
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
            // Only adopt the response when it differs from what the user sees (trimmed text is not a change).
            const control = this.form.controls[field] as FormControl<string | number>;
            if (this.value(field) !== card[field])
              control.setValue(card[field], { emitEvent: false });
          }
        }
        // Prefer local side fields touched during this request (including set→clear).
        // Untouched fields adopt the server value so agent updates are kept (L-781).
        const local = this.item();
        const merged: Item = {
          ...card,
          prUrls: [...(card.prUrls ?? [])],
          relatedItems: [...(card.relatedItems ?? [])],
          labels: normalizeLabels(card.labels),
        };
        if (local) {
          for (const key of sideFields) {
            if (!this.sideDirty.has(key)) continue;
            if (key === 'prUrls') merged.prUrls = [...(local.prUrls ?? [])];
            else if (key === 'relatedItems') merged.relatedItems = [...(local.relatedItems ?? [])];
            else if (key === 'labels') merged.labels = normalizeLabels(local.labels);
            else if (key === 'dueAt') merged.dueAt = local.dueAt ?? null;
            else merged[key] = local[key];
            this.sideDirty.delete(key);
          }
          // PATCH responses omit prTitles; keep/remap local enrichment (L-002 / display names).
          if (local.prTitles?.length || card.prTitles?.length) {
            merged.prTitles = alignPrTitles(
              local.prUrls ?? card.prUrls ?? [],
              local.prTitles ?? card.prTitles,
              merged.prUrls,
            );
          }
          if (this.favoriteDirty) {
            merged.favorite = local.favorite === true;
            this.favoriteDirty = false;
          }
          if (this.projectDirty) {
            merged.projectId = local.projectId;
            this.projectDirty = false;
          }
        }
        this.item.set(merged);
      },
      error: (error) => {
        if (generation !== this.generation) return;
        // A lost response can mean the write committed; resend these fields even if reverted locally.
        for (const field of fields) if (field in patch) this.retryFields.add(field);
        this.sideDirty.clear();
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
    this.suspended = false;
    this.clearTimers();
    this.request?.unsubscribe();
    this.request = undefined;
    this.sideDirty.clear();
    this.projectDirty = false;
    this.favoriteDirty = false;
    this.saving.set(false);
    for (const resolve of this.waiters.splice(0)) resolve(false);
  }
}
