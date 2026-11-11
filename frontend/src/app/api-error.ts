import { HttpErrorResponse } from '@angular/common/http';

export function errorMessage(error: unknown): string {
  const response = error as HttpErrorResponse;
  return response?.error?.message || '通信に失敗しました。接続を確認して再試行してください。';
}
