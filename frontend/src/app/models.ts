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

export interface Item {
  number: number;
  id: number;
  columnId: number;
  title: string;
  description: string;
  position: number;
  backlogPosition: number;
  prUrls: string[];
  relatedItems: RelatedItem[];
  assignee: string;
  createdAt: string;
  updatedAt: string;
}
export interface BoardData {
  columns: Column[];
  items: Item[];
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
