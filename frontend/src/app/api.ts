import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BoardData, Card, CardInput, Column, HistoryPage } from './models';

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);
  board() {
    return this.http.get<BoardData>('/api/board');
  }
  cardByNumber(number: number) {
    return this.http.get<Card>(`/api/cards/by-number/${number}`);
  }
  history(number: number, before = 0) {
    return this.http.get<HistoryPage>(`/api/cards/by-number/${number}/history`, {
      params: before ? { before: String(before) } : {},
    });
  }
  createColumn(name: string) {
    return this.http.post<Column>('/api/columns', { name });
  }
  reorderColumns(columnIds: number[]) {
    return this.http.put<{ columns: Column[] }>('/api/columns/order', { columnIds });
  }
  reorderCards(columns: { columnId: number; cardIds: number[] }[]) {
    return this.http.put<{ cards: Card[] }>('/api/cards/order', { columns });
  }
  backlog() {
    return this.http.get<{ cards: Card[] }>('/api/backlog');
  }
  reorderBacklog(cardIds: number[]) {
    return this.http.put<{ cards: Card[] }>('/api/backlog/order', { cardIds });
  }
  createCard(input: CardInput) {
    return this.http.post<Card>('/api/cards', input);
  }
  updateCard(id: number, input: Partial<CardInput>) {
    return this.http.patch<Card>(`/api/cards/${id}`, input);
  }
  deleteCard(id: number) {
    return this.http.delete<void>(`/api/cards/${id}`);
  }
}
