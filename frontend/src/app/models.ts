export interface Column {
  id: number;
  name: string;
  position: number;
}
export interface Card {
  id: number;
  columnId: number;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}
export interface BoardData {
  columns: Column[];
  cards: Card[];
}
export type CardInput = Pick<Card, 'title' | 'description' | 'columnId'>;
