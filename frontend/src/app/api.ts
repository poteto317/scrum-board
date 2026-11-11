import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { BoardData, Card, CardInput, Column } from './models';

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);
  board() {
    return this.http.get<BoardData>('/api/board');
  }
  card(id: number) {
    return this.http.get<Card>(`/api/cards/${id}`);
  }
  createColumn(name: string) {
    return this.http.post<Column>('/api/columns', { name });
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
export function errorMessage(error: unknown): string {
  const response = error as HttpErrorResponse;
  return response?.error?.message || '通信に失敗しました。接続を確認して再試行してください。';
}
// Match the API's Unicode code-point limits, including emoji.
export const textLimit =
  (max: number, required = false): ValidatorFn =>
  (control: AbstractControl): ValidationErrors | null => {
    const value = String(control.value ?? '');
    if (required && !value.trim()) return { required: true };
    return [...(required ? value.trim() : value)].length > max ? { maxlength: true } : null;
  };
