import { HttpErrorResponse } from '@angular/common/http';

/** 404 の応答か（通信の失敗や、ほかの状態は false） */
export function isNotFound(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 404;
}

export function errorMessage(error: unknown): string {
  const response = error as HttpErrorResponse;
  return response?.error?.message || '通信に失敗しました。接続を確認して再試行してください。';
}
