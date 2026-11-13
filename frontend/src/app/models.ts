export interface Column {
  id: number;
  name: string;
  position: number;
}
export interface Card {
  number: number;
  id: number;
  columnId: number;
  title: string;
  description: string;
  prUrl: string;
  createdAt: string;
  updatedAt: string;
}
export interface BoardData {
  columns: Column[];
  cards: Card[];
}
export type CardInput = Pick<Card, 'title' | 'description' | 'columnId'> &
  Partial<Pick<Card, 'prUrl'>>;

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
