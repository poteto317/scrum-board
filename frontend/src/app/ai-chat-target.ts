/**
 * 開いているアイテム（アイテム詳細から聞くときだけある）。
 * プロジェクトは持たない: 詳細のプロジェクトは AiChatContext.detailProjectId だけが持つ。
 */
export type AiChatFocusItem = {
  number: number;
  itemId: number;
  title: string;
  canEdit: boolean;
};

export type AiChatPageKind = 'board' | 'backlog' | 'detail' | 'other';

/** ボード・バックログ・アイテム詳細（solution 除く） */
export function isAiChatRoute(url: string): boolean {
  const path = url.split('?')[0] || '/';
  if (path === '/' || path === '') return true;
  if (path === '/backlog') return true;
  if (/^\/items\/\d+$/.test(path)) return true;
  return false;
}

/** 同じアイテムか（番号と ID が同じ。タイトルや権限の変化は別のアイテムとみなさない） */
export function isSameItem(a: AiChatFocusItem | null, b: AiChatFocusItem | null): boolean {
  if (!a || !b) return a === b;
  return a.number === b.number && a.itemId === b.itemId;
}

/** 中身まで同じか（同じアイテムで、タイトルも権限も同じ。伝え直す必要がない） */
export function isUnchangedItem(a: AiChatFocusItem | null, b: AiChatFocusItem | null): boolean {
  if (!a || !b) return a === b;
  return isSameItem(a, b) && a.title === b.title && a.canEdit === b.canEdit;
}

/**
 * チャットのプロジェクト。アイテム詳細ではそのアイテムのプロジェクト detailProjectId
 * （次のアイテムを読み込んでいる間も、直前の詳細のプロジェクトが残る）、
 * ボード・バックログでは選択中のプロジェクト。決まっていなければ null。
 */
export function resolveChatProjectId(args: {
  pageKind: AiChatPageKind;
  detailProjectId: number | null;
  activeProjectId: number | null;
}): number | null {
  const { pageKind, detailProjectId, activeProjectId } = args;
  const id =
    pageKind === 'detail'
      ? detailProjectId
      : pageKind === 'board' || pageKind === 'backlog'
        ? activeProjectId
        : null;
  return id != null && id > 0 ? id : null;
}

/** チャットに渡す「開いているアイテム」。アイテム詳細のときだけある */
export function toFocusItem(
  pageKind: AiChatPageKind,
  focusItem: AiChatFocusItem | null,
): AiChatFocusItem | null {
  return pageKind === 'detail' ? focusItem : null;
}

/** アイテム詳細が、チャットに伝えている内容をどうするか */
export type DetailChatAction = 'set' | 'keep' | 'release' | 'clear';

/**
 * アイテム詳細の状態から、チャットに伝える内容の扱いを決める。
 *
 * - set: アイテムを読み込めている。そのアイテムを伝える（閲覧だけでも）。
 * - keep: 何もしない。チャットが詳細のものでない、同じ番号の読み直しでアイテムが一瞬無い、
 *   または次のアイテムを読み込んでいる途中。
 * - release: 別のアイテムへ移って読み込んでいる。開いているアイテムだけ外す
 *   （プロジェクトのチャットは残し、送信中の回答を失わない）。
 * - clear: もう詳細ではない（別のアイテムへ移ったが読み込んでいない、または読み込めずに終わった）。
 */
export function detailChatAction(
  state:
    | { hasItem: true }
    | {
        hasItem: false;
        /** チャットがいま知っている画面の種類 */
        pageKind: AiChatPageKind;
        /** ルートのアイテム番号（決まっていなければ 0 以下） */
        routeNumber: number;
        /** チャットに伝えてあるアイテムの番号。伝えていなければ null */
        focusNumber: number | null;
        loading: boolean;
      },
): DetailChatAction {
  if (state.hasItem) return 'set';
  if (state.pageKind !== 'detail') return 'keep';
  if (state.focusNumber == null) return state.loading ? 'keep' : 'clear';
  if (!(state.routeNumber > 0) || state.focusNumber === state.routeNumber) return 'keep';
  return state.loading ? 'release' : 'clear';
}
