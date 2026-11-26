import { Component, computed, DestroyRef, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Api, ProjectAIProposal, ProjectAIProposalUpdate } from './api';
import { conflictBody, errorMessage } from './api-error';
import { AuthSession } from './auth-session';
import type { Item } from './models';
import { sameChatScope, type ChatScope } from './project-ai-chat-rules';
import { diffLines } from './project-ai-proposal-diff';
import {
  applyLabel,
  checkBlockReason,
  createdMessage,
  createdSuffix,
  diffBase,
  dismissLabel,
  ItemCheck,
  loadFailureMessage,
  proposalCopy,
  proposalHeading,
  proposalItemRequest,
  proposalPrecheck,
  proposalTargetsItem,
} from './project-ai-proposal-rules';

/** 要求を出したときの、プロジェクト・ユーザー・世代（L-571）。比べ方はチャットと同じ */
type CardScope = ChatScope;

/** 進め方の途中で止まった（プロジェクト・ユーザー・提案が変わった） */
class Stopped extends Error {}

/**
 * AI の提案 1 件。適用は、提案の確保（pending → applied）→ 既存のアイテムの API → 結果、の順。
 * 既存の API が失敗したら、確保を戻す（release）。本体の変更は利用者自身の権限で行う。
 */
@Component({
  selector: 'app-project-ai-proposal-card',
  imports: [RouterLink],
  templateUrl: './project-ai-proposal-card.html',
  styleUrl: './project-ai-proposal-card.css',
})
export class ProjectAiProposalCard {
  readonly proposal = input.required<ProjectAIProposal>();
  readonly projectId = input.required<number>();
  /** 提案の状態が変わった（サーバーが返した提案） */
  readonly changed = output<ProjectAIProposal>();
  /** 適用でアイテムが変わった（3 種類とも、本体の API が成功したとき） */
  readonly itemsChanged = output<void>();

  private readonly api = inject(Api);
  private readonly auth = inject(AuthSession);
  private generation = 0;
  /** 破棄された後は、応答が来ても何もしない（出力も出さない） */
  private destroyed = false;

  readonly check = signal<ItemCheck>({ kind: 'none' });
  /** 適用の直前に読んで、説明が変わっていたと分かった（以後は適用できない） */
  readonly stale = signal(false);
  readonly busy = signal(false);
  readonly status = signal('');
  readonly failure = signal('');

  readonly heading = computed(() => proposalHeading(this.proposal()));
  readonly applyLabel = computed(() => applyLabel(this.proposal()));
  readonly dismissLabel = computed(() => dismissLabel(this.proposal()));
  readonly pending = computed(() => this.proposal().state === 'pending');
  readonly blockReason = computed(() =>
    this.pending() ? checkBlockReason(this.proposal(), this.check()) : null,
  );
  readonly diff = computed(() => {
    const p = this.proposal();
    if (p.kind !== 'description_edit') return [];
    // 適用済み・破棄は、提案のときの説明との差分を出す（今の説明は関係ない）
    const base = this.pending() ? diffBase(p, this.check()) : (p.baseDescription ?? '');
    return diffLines(base, p.description ?? '');
  });
  readonly resultMessage = computed(() => {
    const p = this.proposal();
    if (p.state === 'dismissed') return proposalCopy.dismissed;
    if (p.state !== 'applied') return '';
    // 作成した番号は、テンプレートがリンクにして前に置く
    return p.kind === 'item_create' && p.createdItemNumber != null ? createdSuffix : proposalCopy.applied;
  });

  /** 対象（提案・プロジェクト・ユーザー）が変わったときだけ変わる */
  private readonly targetKey = computed(
    () => `${this.proposal().id}:${this.projectId()}:${this.auth.user()?.id ?? ''}`,
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    // 表示した（または対象・プロジェクト・ユーザーが変わった）ときに、対象のアイテムを読む
    // 状態の変化（確保・解放）では読み直さない: 読み直すと世代が変わり、進行中の適用が止まる
    effect(() => {
      this.targetKey();
      untracked(() => this.loadTarget(this.proposal(), this.projectId()));
    });
  }

  private scope(): CardScope {
    return { generation: this.generation, projectId: this.projectId(), userId: this.auth.user()?.id ?? null };
  }

  /** 進めてよいか（判断は純粋な sameChatScope）。違えば Stopped で以降の要求を出さない */
  private ensureCurrent(scope: CardScope) {
    if (!this.sameScope(scope)) throw new Stopped();
  }

  private loadTarget(p: ProjectAIProposal, projectId: number) {
    this.generation++;
    this.stale.set(false);
    this.busy.set(false);
    this.status.set('');
    this.failure.set('');
    if (p.state !== 'pending' || !proposalTargetsItem(p)) {
      this.check.set({ kind: 'none' });
      return;
    }
    const scope = this.scope();
    this.check.set({ kind: 'loading' });
    this.api.itemByNumber(p.itemNumber!, projectId).subscribe({
      next: (item) => {
        if (this.sameScope(scope)) this.check.set({ kind: 'loaded', item });
      },
      error: (err) => {
        if (this.sameScope(scope)) this.check.set({ kind: 'failed', message: loadFailureMessage(err) });
      },
    });
  }

  private sameScope(scope: CardScope): boolean {
    return !this.destroyed && sameChatScope(scope, this.scope());
  }

  async apply() {
    if (this.busy() || !this.pending() || this.blockReason() || this.stale()) return;
    const p = this.proposal();
    const scope = this.scope();
    this.busy.set(true);
    this.failure.set('');
    this.status.set(proposalCopy.applying);
    try {
      await this.applyProposal(p, scope);
    } catch (err) {
      if (err instanceof Stopped) return;
      throw err;
    } finally {
      if (this.sameScope(scope)) {
        this.busy.set(false);
        if (this.status() === proposalCopy.applying) this.status.set('');
      }
    }
  }

  private async applyProposal(p: ProjectAIProposal, scope: CardScope) {
    // 1. 対象を読み直して確かめる（作成は対象が無い）。表示時に読んだ item は使わない（L-018）
    let item: Item | null = null;
    if (proposalTargetsItem(p)) {
      try {
        item = await firstValueFrom(this.api.itemByNumber(p.itemNumber!, scope.projectId));
      } catch (err) {
        this.ensureCurrent(scope);
        this.failure.set(loadFailureMessage(err));
        return;
      }
      this.ensureCurrent(scope);
      this.check.set({ kind: 'loaded', item });
      const pre = proposalPrecheck(p, item);
      if (pre.kind === 'stale') {
        this.stale.set(true);
        this.failure.set(pre.message);
        return;
      }
      if (pre.kind === 'blocked') {
        this.failure.set(pre.message);
        return;
      }
    }
    // 2. 確保（pending → applied）。409 は、ほかで処理済み
    if (!(await this.updateState(p, scope, { state: 'applied' }))) return;
    // 3. 本体（既存の API を利用者の権限で）
    let created: Item | null = null;
    try {
      created = await this.applyToItem(p, item, scope.projectId);
    } catch (err) {
      this.ensureCurrent(scope);
      await this.release(p, scope, errorMessage(err));
      return;
    }
    this.ensureCurrent(scope);
    this.itemsChanged.emit();
    // 4. 作成は結果を記録する。失敗しても release しない（もう一度作らない）
    if (p.kind === 'item_create' && created) {
      try {
        const recorded = await firstValueFrom(
          this.api.updateProjectAIProposal(scope.projectId, p.id, { state: 'applied', createdItemNumber: created.number }),
        );
        this.ensureCurrent(scope);
        this.changed.emit(recorded);
      } catch {
        this.ensureCurrent(scope);
        this.status.set(createdMessage(created.number, false));
      }
    }
  }

  /** 状態を変える。409 はサーバーの提案に置き換え、false を返す */
  private async updateState(p: ProjectAIProposal, scope: CardScope, body: ProjectAIProposalUpdate): Promise<boolean> {
    try {
      const updated = await firstValueFrom(this.api.updateProjectAIProposal(scope.projectId, p.id, body));
      this.ensureCurrent(scope);
      this.changed.emit(updated);
      return true;
    } catch (err) {
      this.ensureCurrent(scope);
      const current = conflictBody<{ proposal?: ProjectAIProposal }>(err)?.proposal;
      if (current) {
        this.changed.emit(current);
        this.failure.set(proposalCopy.alreadyHandled);
      } else {
        this.failure.set(errorMessage(err));
      }
      return false;
    }
  }

  private applyToItem(p: ProjectAIProposal, item: Item | null, projectId: number): Promise<Item> {
    const request = proposalItemRequest(p, item, projectId);
    if (!request) return Promise.reject(new Error(proposalCopy.notFound));
    return firstValueFrom(
      request.kind === 'create'
        ? this.api.createItem(request.input)
        : this.api.updateItem(request.itemId, request.patch),
    );
  }

  /** 本体が失敗したので確保を戻す。戻せなければ、その旨を理由に足す */
  private async release(p: ProjectAIProposal, scope: CardScope, reason: string) {
    try {
      const released = await firstValueFrom(this.api.updateProjectAIProposal(scope.projectId, p.id, { state: 'pending' }));
      this.ensureCurrent(scope);
      this.changed.emit(released);
      this.failure.set(reason);
    } catch {
      this.ensureCurrent(scope);
      this.failure.set(`${reason}${proposalCopy.releaseFailed}`);
    }
  }

  async dismiss() {
    if (this.busy() || !this.pending()) return;
    const scope = this.scope();
    this.busy.set(true);
    this.failure.set('');
    try {
      await this.updateState(this.proposal(), scope, { state: 'dismissed' });
    } catch (err) {
      if (!(err instanceof Stopped)) throw err;
    } finally {
      if (this.sameScope(scope)) this.busy.set(false);
    }
  }
}
