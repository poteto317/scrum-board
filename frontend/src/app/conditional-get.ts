import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of, throwError } from 'rxjs';

export type ConditionalGetResult<T> =
  | { status: 'ok'; etag: string; body: T }
  | { status: 'notModified'; etag: string };

/** Maps optional projectId query to ETag map key (unset / all → 0). */
export function etagFetchKey(projectId?: number): number {
  return projectId && projectId > 0 ? projectId : 0;
}

export function getJSONConditional<T>(
  http: HttpClient,
  url: string,
  opts: { projectId?: number; etag?: string | null },
): Observable<ConditionalGetResult<T>> {
  let headers = new HttpHeaders();
  if (opts.etag) {
    headers = headers.set('If-None-Match', opts.etag);
  }
  let params: HttpParams | undefined;
  if (opts.projectId && opts.projectId > 0) {
    params = new HttpParams().set('projectId', String(opts.projectId));
  }
  return http.get<T>(url, { headers, params, observe: 'response' }).pipe(
    map((res) => ({
      status: 'ok' as const,
      etag: res.headers.get('ETag') ?? '',
      body: res.body as T,
    })),
    catchError((err: HttpErrorResponse) => {
      if (err.status === 304) {
        return of({
          status: 'notModified' as const,
          etag: err.headers.get('ETag') ?? opts.etag ?? '',
        });
      }
      return throwError(() => err);
    }),
  );
}

/** Prefer *Conditional on Api mocks; fall back to plain GET → ok (partial test doubles). */
export function resolveBoardConditional<T>(
  api: {
    board: (projectId?: number) => Observable<T>;
    boardConditional?: (
      projectId?: number,
      etag?: string | null,
    ) => Observable<ConditionalGetResult<T>>;
  },
  projectId?: number,
  etag?: string | null,
): Observable<ConditionalGetResult<T>> {
  if (typeof api.boardConditional === 'function') {
    return api.boardConditional(projectId, etag);
  }
  return api.board(projectId).pipe(map((body) => ({ status: 'ok' as const, etag: '', body })));
}

export function resolveBacklogConditional<T>(
  api: {
    backlog: (projectId?: number) => Observable<T>;
    backlogConditional?: (
      projectId?: number,
      etag?: string | null,
    ) => Observable<ConditionalGetResult<T>>;
  },
  projectId?: number,
  etag?: string | null,
): Observable<ConditionalGetResult<T>> {
  if (typeof api.backlogConditional === 'function') {
    return api.backlogConditional(projectId, etag);
  }
  return api.backlog(projectId).pipe(map((body) => ({ status: 'ok' as const, etag: '', body })));
}
