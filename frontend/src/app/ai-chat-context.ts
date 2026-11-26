import { Injectable, signal } from '@angular/core';
import type { Item } from './models';
import { isUnchangedItem, type AiChatFocusItem, type AiChatPageKind } from './ai-chat-target';

export type { AiChatPageKind };

@Injectable({ providedIn: 'root' })
export class AiChatContext {
  readonly pageKind = signal<AiChatPageKind>('other');
  /** アイテム詳細で開いているアイテム。プロジェクトは持たない（detailProjectId が持つ） */
  readonly focusItem = signal<AiChatFocusItem | null>(null);
  /**
   * アイテム詳細のプロジェクト（ここだけが持つ）。詳細から詳細へ移って次のアイテムを
   * 読み込んでいる間（focusItem が null の間）も残る。詳細でなくなったら null。
   */
  readonly detailProjectId = signal<number | null>(null);
  readonly onDescriptionApplied = signal<((item: Item) => void) | null>(null);
  readonly onCommentApplied = signal<(() => void) | null>(null);

  setBoard() {
    this.setList('board');
  }

  setBacklog() {
    this.setList('backlog');
  }

  setDetail(
    detail: { projectId: number; item: AiChatFocusItem },
    handlers: {
      onDescriptionApplied: (item: Item) => void;
      onCommentApplied: () => void;
    },
  ) {
    this.pageKind.set('detail');
    this.detailProjectId.set(detail.projectId);
    if (!isUnchangedItem(this.focusItem(), detail.item)) {
      this.focusItem.set(detail.item);
    }
    this.onDescriptionApplied.set(handlers.onDescriptionApplied);
    this.onCommentApplied.set(handlers.onCommentApplied);
  }

  /**
   * アイテム詳細の中で次のアイテムを読み込んでいる間に呼ぶ。開いているアイテムだけ外し、
   * 画面の種類とプロジェクトは保つ（チャットを破棄せず、送信中の回答を失わない）。
   */
  releaseDetailItem() {
    if (this.pageKind() !== 'detail') return;
    this.releaseTarget();
  }

  clear() {
    this.pageKind.set('other');
    this.resetDetail();
  }

  private setList(kind: 'board' | 'backlog') {
    this.pageKind.set(kind);
    this.resetDetail();
  }

  private resetDetail() {
    this.detailProjectId.set(null);
    this.releaseTarget();
  }

  private releaseTarget() {
    this.focusItem.set(null);
    this.onDescriptionApplied.set(null);
    this.onCommentApplied.set(null);
  }
}
