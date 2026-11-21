import { Injectable, signal } from '@angular/core';
import type { Item } from './models';
import { sameJson } from './live-refresh';
import type { AiChatPageKind, AiChatTarget, AiChatTargetOption } from './ai-chat-target';

export type { AiChatPageKind };

@Injectable({ providedIn: 'root' })
export class AiChatContext {
  readonly pageKind = signal<AiChatPageKind>('other');
  readonly candidates = signal<AiChatTargetOption[]>([]);
  readonly routeTarget = signal<AiChatTarget | null>(null);
  readonly onDescriptionApplied = signal<((item: Item) => void) | null>(null);
  readonly onCommentApplied = signal<(() => void) | null>(null);

  setBoard(candidates: AiChatTargetOption[]) {
    this.setList('board', candidates);
  }

  setBacklog(candidates: AiChatTargetOption[]) {
    this.setList('backlog', candidates);
  }

  setDetail(
    target: AiChatTarget,
    handlers: {
      onDescriptionApplied: (item: Item) => void;
      onCommentApplied: () => void;
    },
  ) {
    this.pageKind.set('detail');
    this.candidates.set([]);
    this.routeTarget.set(target);
    this.onDescriptionApplied.set(handlers.onDescriptionApplied);
    this.onCommentApplied.set(handlers.onCommentApplied);
  }

  clear() {
    this.pageKind.set('other');
    this.candidates.set([]);
    this.routeTarget.set(null);
    this.onDescriptionApplied.set(null);
    this.onCommentApplied.set(null);
  }

  private setList(kind: 'board' | 'backlog', candidates: AiChatTargetOption[]) {
    this.pageKind.set(kind);
    if (!sameJson(this.candidates(), candidates)) {
      this.candidates.set(candidates);
    }
    this.routeTarget.set(null);
    this.onDescriptionApplied.set(null);
    this.onCommentApplied.set(null);
  }
}
