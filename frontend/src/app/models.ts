export interface Column {
  id: number;
  name: string;
  position: number;
}
export interface RelatedItem {
  kind: 'item' | 'url';
  number?: number;
  title?: string;
  url?: string;
  label?: string;
}

export type CardLayout = 'pack' | 'free';

export interface BoardSettings {
  cardLayout: CardLayout;
  /** 未知キーは読み書きで捨てない（L-459）。 */
  [key: string]: unknown;
}

export interface Item {
  number: number;
  id: number;
  columnId: number;
  title: string;
  description: string;
  position: number;
  backlogPosition: number;
  /** 欠落時は 0（normalizeBoardData / normalizeItem で補完）。 */
  offsetY?: number;
  prUrls: string[];
  /** Read-only display labels aligned with prUrls; omitted on board/PATCH. */
  prTitles?: string[];
  relatedItems: RelatedItem[];
  assignee: string;
  createdAt: string;
  updatedAt: string;
}
export interface BoardData {
  columns: Column[];
  items: Item[];
  /** 欠落時は pack（normalizeBoardData で補完）。 */
  settings?: BoardSettings;
}
export type ItemInput = Pick<Item, 'title' | 'description' | 'columnId'> &
  Partial<Pick<Item, 'prUrls' | 'relatedItems' | 'assignee'>>;

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
