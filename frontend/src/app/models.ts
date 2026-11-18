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
  assignee: string;
  /** Close 理由。欠落時は ''（normalizeItem で補完）。 */
  closeReason: string;
  /** 期限 UTC `…Z`（秒 00）。欠落時は null（normalizeItem で補完。空文字にしない）。 */
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface BoardData {
  columns: Column[];
  items: Item[];
  /** 欠落時は pack（normalizeBoardData で補完）。 */
  settings?: BoardSettings;
}
/** POST /api/items body — dueAt は create 非対応（PATCH のみ）。 */
export type ItemInput = Pick<Item, 'title' | 'description' | 'columnId'> &
  Partial<Pick<Item, 'prUrls' | 'relatedItems' | 'assignee' | 'closeReason' | 'solution' | 'projectId'>>;
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
