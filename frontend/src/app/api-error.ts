import { HttpErrorResponse } from '@angular/common/http';

/** 404 の応答か（通信の失敗や、ほかの状態は false） */
export function isNotFound(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 404;
}

/** 409 の応答なら、本文の proposal などの中身（無ければ null） */
export function conflictBody<T>(error: unknown): T | null {
  const response = error as { status?: unknown; error?: unknown } | null;
  return response?.status === 409 && response.error ? (response.error as T) : null;
}

export function errorMessage(error: unknown): string {
  const response = error as HttpErrorResponse;
  return response?.error?.message || '通信に失敗しました。接続を確認して再試行してください。';
}
