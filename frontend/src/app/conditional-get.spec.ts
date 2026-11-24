import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { of } from 'rxjs';
import { Api } from './api';
import {
  etagFetchKey,
  fetchBoardMeta,
  getJSONConditional,
  resolveBoardMetaConditional,
} from './conditional-get';
import { mergeBacklogBoardPoll } from './backlog-board-poll';

describe('conditional-get', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });
  afterEach(() => httpMock.verify());

  it('etagFetchKey maps unset to 0', () => {
    expect(etagFetchKey(undefined)).toBe(0);
    expect(etagFetchKey(0)).toBe(0);
    expect(etagFetchKey(3)).toBe(3);
  });

  it('returns ok with body and ETag on 200', () => {
    let result: unknown;
    getJSONConditional<{ n: number }>(http, '/api/board', {}).subscribe((r) => (result = r));
    const req = httpMock.expectOne('/api/board');
    expect(req.request.headers.has('If-None-Match')).toBe(false);
    req.flush({ n: 1 }, { status: 200, statusText: 'OK', headers: { ETag: '"abc"' } });
    expect(result).toEqual({ status: 'ok', etag: '"abc"', body: { n: 1 } });
  });

  it('sends If-None-Match and maps 304 to notModified', () => {
    let result: unknown;
    getJSONConditional(http, '/api/board', { etag: '"abc"' }).subscribe((r) => (result = r));
    const req = httpMock.expectOne('/api/board');
    expect(req.request.headers.get('If-None-Match')).toBe('"abc"');
    req.flush(null, { status: 304, statusText: 'Not Modified', headers: { ETag: '"abc"' } });
    expect(result).toEqual({ status: 'notModified', etag: '"abc"' });
  });

  it('passes projectId query', () => {
    getJSONConditional(http, '/api/board', { projectId: 2 }).subscribe();
    const req = httpMock.expectOne('/api/board?projectId=2');
    req.flush({}, { headers: { ETag: '"x"' } });
  });

  it('mergeBacklogBoardPoll skips when both notModified', () => {
    expect(
      mergeBacklogBoardPoll(
        { items: [1], columns: ['a'] },
        { status: 'notModified', etag: '"b"' },
        { status: 'notModified', etag: '"c"' },
      ),
    ).toBeNull();
  });

  it('mergeBacklogBoardPoll merges one-sided ok', () => {
    expect(
      mergeBacklogBoardPoll(
        { items: [1], columns: ['old'] },
        { status: 'notModified', etag: '"b"' },
        { status: 'ok', etag: '"c"', body: { columns: ['new'] } },
      ),
    ).toEqual({ items: [1], columns: ['new'] });
    expect(
      mergeBacklogBoardPoll(
        { items: [1], columns: ['old'] },
        { status: 'ok', etag: '"b"', body: { items: [9] } },
        { status: 'notModified', etag: '"c"' },
      ),
    ).toEqual({ items: [9], columns: ['old'] });
  });

  it('mergeBacklogBoardPoll uses both bodies when both ok', () => {
    expect(
      mergeBacklogBoardPoll(
        { items: [1], columns: ['old'] },
        { status: 'ok', etag: '"b"', body: { items: [2] } },
        { status: 'ok', etag: '"c"', body: { columns: ['new'] } },
      ),
    ).toEqual({ items: [2], columns: ['new'] });
  });

  describe('board meta helpers', () => {
    const boardBody = {
      columns: [{ id: 1, name: 'Todo' }],
      items: [{ id: 9 }],
      settings: { cardLayout: 'pack' as const, activeProjectId: 2 },
    };

    it('the real Api provides boardMeta and boardMetaConditional (helpers hide a missing method)', () => {
      const api = TestBed.inject(Api);
      const required: Required<Pick<Api, 'boardMeta' | 'boardMetaConditional'>> = api;
      expect(typeof required.boardMeta).toBe('function');
      expect(typeof required.boardMetaConditional).toBe('function');
    });

    it('resolveBoardMetaConditional prefers boardMetaConditional and never calls board', () => {
      const result = { status: 'notModified' as const, etag: '"e"' };
      const boardMetaConditional = vi.fn(() => of(result));
      const board = vi.fn();
      let got: unknown;
      resolveBoardMetaConditional({ board, boardMetaConditional } as never, '"e"').subscribe((r) => (got = r));
      expect(boardMetaConditional).toHaveBeenCalledWith('"e"');
      expect(board).not.toHaveBeenCalled();
      expect(got).toBe(result);
    });

    it('resolveBoardMetaConditional falls back to board() and drops items', () => {
      const board = vi.fn(() => of(boardBody));
      let got: unknown;
      resolveBoardMetaConditional({ board } as never, null).subscribe((r) => (got = r));
      expect(got).toEqual({
        status: 'ok',
        etag: '',
        body: { columns: boardBody.columns, settings: boardBody.settings },
      });
    });

    it('fetchBoardMeta prefers boardMeta and never calls board', () => {
      const meta = { columns: [], settings: { cardLayout: 'pack' as const } };
      const boardMeta = vi.fn(() => of(meta));
      const board = vi.fn();
      let got: unknown;
      fetchBoardMeta({ board, boardMeta } as never).subscribe((r) => (got = r));
      expect(boardMeta).toHaveBeenCalledTimes(1);
      expect(board).not.toHaveBeenCalled();
      expect(got).toBe(meta);
    });

    it('fetchBoardMeta falls back to board() and drops items', () => {
      const board = vi.fn(() => of(boardBody));
      let got: unknown;
      fetchBoardMeta({ board } as never).subscribe((r) => (got = r));
      expect(got).toEqual({ columns: boardBody.columns, settings: boardBody.settings });
    });
  });
});
