import { signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import type { Api, ProjectAIConversation } from './api';
import { errorMessage } from './api-error';

export type ConversationListState = 'loading' | 'error' | 'ready';

/**
 * 会話の一覧: 読み込み（読み込み中・失敗・読めた）と、手元での書き換え。
 * 表示中の会話や、誰の・どのプロジェクトの一覧か（スコープ）は持たない。呼び出す側が、
 * 読み込みのたびに「この応答をまだ使うか」を渡す。
 */
export class ProjectAiConversationList {
  readonly conversations = signal<ProjectAIConversation[]>([]);
  readonly state = signal<ConversationListState>('loading');
  readonly error = signal('');
  /** 一覧の世代。読み込みを始めるか、手元で書き換えたら進め、それより前に始めた読み込みを捨てる */
  private generation = 0;
  private request?: Subscription;

  constructor(private readonly api: Pick<Api, 'listProjectAIConversations'>) {}

  /** 読み直す。stillWanted が false を返す応答（別のプロジェクト・ユーザーのもの）は捨てる */
  load(projectId: number, stillWanted: () => boolean) {
    const generation = ++this.generation;
    const current = () => stillWanted() && generation === this.generation;
    this.request?.unsubscribe();
    this.state.set('loading');
    this.error.set('');
    this.request = this.api.listProjectAIConversations(projectId).subscribe({
      next: (conversations) => {
        if (!current()) return;
        this.conversations.set(conversations);
        this.state.set('ready');
      },
      error: (err) => {
        if (!current()) return;
        this.error.set(errorMessage(err));
        this.state.set('error');
      },
    });
  }

  /**
   * 読めている一覧を手元で書き換える。それより前に始めた読み込みは古いので捨てる。
   * まだ読めていなければ、書き換えずに false を返す（欠けた一覧を「読めた」ことにしない。
   * 呼び出す側が読み直す）。
   */
  patch(update: (list: ProjectAIConversation[]) => ProjectAIConversation[]): boolean {
    if (this.state() !== 'ready') return false;
    this.generation++;
    this.conversations.update(update);
    return true;
  }

  /** 進行中の読み込みを捨て、空の「読み込み中」に戻す */
  reset() {
    this.cancel();
    this.generation++;
    this.conversations.set([]);
    this.state.set('loading');
    this.error.set('');
  }

  cancel() {
    this.request?.unsubscribe();
  }
}
