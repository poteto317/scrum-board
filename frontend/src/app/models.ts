import type { Label } from './label';

export interface Column {
  id: number;
  name: string;
  position: number;
}
export interface RelatedItem {
  kind: 'item' | 'url';
  number?: number;
  projectId?: number;
  title?: string;
  url?: string;
  label?: string;
}

export type CardLayout = 'pack' | 'free';

export interface Project {
  id: number;
  name: string;
  position: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface BoardSettings {
  cardLayout: CardLayout;
  /** スマホ1列表示の列 ID。正規化後は number（欠落・無効は resolve 側で補完）。 */
  mobileBoardColumnId?: number;
  /** 解決後の表示中プロジェクト。欠落・非数は undefined（normalizeBoardData で補完）。 */
  activeProjectId?: number;
  /** 未知キーは読み書きで捨てない（L-459）。 */
  [key: string]: unknown;
}

export interface Item {
  number: number;
  id: number;
  /** 所属プロジェクト。欠落時は 0（normalizeItem で補完）。 */
  projectId: number;
  columnId: number;
  title: string;
  description: string;
  /** ソリューション本文。欠落時は ''（normalizeItem で補完）。 */
  solution: string;
  position: number;
  backlogPosition: number;
  /** 欠落時は 0（normalizeBoardData / normalizeItem で補完）。 */
  offsetY: number;
  prUrls: string[];
  /** Read-only display labels aligned with prUrls; omitted on board/PATCH. */
  prTitles?: string[];
  relatedItems: RelatedItem[];
  labels?: Label[];
  assignee: string;
  /** Close 理由。欠落時は ''（normalizeItem で補完）。 */
  closeReason: string;
  /** お気に入り。欠落時は false（normalizeItem で補完）。 */
  favorite: boolean;
  /** 期限 UTC `…Z`（秒 00）。欠落時は null（normalizeItem で補完。空文字にしない）。 */
  dueAt: string | null;
  /** Done に入った日時。非 Done のカードでは null。 */
  doneAt?: string | null;
  /** アーカイブ日時。通常カードでは null。 */
  archivedAt?: string | null;
  /** 閲覧: public | open | restricted。欠落時は open（normalizeItem）。 */
  viewAccess?: 'public' | 'open' | 'restricted';
  /** 編集: open | restricted。欠落時は open（normalizeItem）。 */
  editAccess?: 'open' | 'restricted';
  createdByUserId?: number | null;
  /** サーバが当該セッション向けに付けた権限フラグ（詳細 GET 等）。 */
  canEdit?: boolean;
  canManage?: boolean;
  /** manage のみ。一般 GET では欠落。 */
  acl?: { viewUserIds: number[]; editUserIds: number[] };
  createdAt: string;
  updatedAt: string;
}
export interface BoardData {
  columns: Column[];
  items: Item[];
  /** 欠落時は pack（normalizeBoardData で補完）。 */
  settings?: BoardSettings;
}
/** GET /api/board/meta の応答: BoardData からアイテム本体を除いた列と設定。 */
export interface BoardMeta {
  columns: Column[];
  /** 欠落時は pack（normalizeBoardMeta で補完）。 */
  settings?: BoardSettings;
}
/** POST /api/items body — dueAt は create 非対応（PATCH のみ）。 */
export type ItemInput = Pick<Item, 'title' | 'description' | 'columnId'> &
  Partial<Pick<Item, 'prUrls' | 'relatedItems' | 'assignee' | 'closeReason' | 'solution' | 'favorite' | 'projectId'>> & {
    labelIds?: number[];
  };
/** PATCH /api/items/{id} body — dueAt の null クリアを含む。 */
export type ItemPatch = Partial<ItemInput & Pick<Item, 'dueAt'>>;

export interface HistoryChange {
  field: string;
  before: string;
  after: string;
}
export interface HistoryEvent {
  id: number;
  kind: string;
  occurredAt: string;
  recordedAt: string;
  changes: HistoryChange[];
  note: string;
  evidenceUrl: string;
}
export interface HistoryPage {
  events: HistoryEvent[];
  nextBefore: number;
}

export interface ItemComment {
  id: number;
  itemId: number;
  author: string;
  body: string;
  createdByUserId?: number;
  createdAt: string;
  updatedAt: string;
}

/** Normalize API comment; author/body always string (missing → ""). */
export function normalizeComment(raw: Partial<ItemComment> | null | undefined): ItemComment {
  return {
    id: typeof raw?.id === 'number' ? raw.id : 0,
    itemId: typeof raw?.itemId === 'number' ? raw.itemId : 0,
    author: typeof raw?.author === 'string' ? raw.author : '',
    createdByUserId:
      typeof raw?.createdByUserId === 'number' && raw.createdByUserId > 0
        ? raw.createdByUserId
        : undefined,
    body: typeof raw?.body === 'string' ? raw.body : '',
    createdAt: typeof raw?.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : '',
  };
}

/** Goal length limit as Unicode scalars (L-858; match BE). */
export const SPRINT_GOAL_MAX_SCALARS = 2000;
export const SPRINT_NAME_MAX = 120;

export type SprintStatus = 'planned' | 'active' | 'completed';

export interface SprintSummary {
  id: number;
  projectId: number;
  name: string;
  goal: string;
  startDate: string;
  endDate: string;
  status: SprintStatus;
  velocity: number | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SprintItemRef {
  id: number;
  number: number;
  title: string;
  columnId: number;
}

export interface Sprint extends SprintSummary {
  suggestedVelocity: number;
  items: SprintItemRef[];
}

/** PATCH body. `velocity: null` clears; omit key = no change (L-002). */
export interface SprintPatch {
  name?: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
  velocity?: number | null;
}

export function sprintStatusLabel(status: SprintStatus): string {
  switch (status) {
    case 'planned':
      return '計画中';
    case 'active':
      return '進行中';
    case 'completed':
      return '完了';
  }
}

/** Unicode scalar count (same basis as textLimit / BE rune count). */
export function unicodeScalarLength(value: string): number {
  return [...value].length;
}
