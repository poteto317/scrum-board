import { describe, expect, it } from 'vitest';
import {
  isBoardPath,
  shouldSyncProjectQuery,
  urlPathOf,
  parseProjectQueryParam,
  PROJECT_QUERY_NOT_FOUND,
  resolveProjectDeepLinkAction,
  withProjectQueryParam,
} from './project-query';

describe('parseProjectQueryParam', () => {
  it('returns absent for missing values', () => {
    expect(parseProjectQueryParam(null)).toEqual({ kind: 'absent' });
    expect(parseProjectQueryParam(undefined)).toEqual({ kind: 'absent' });
    expect(parseProjectQueryParam([])).toEqual({ kind: 'absent' });
  });

  it('returns ok for positive integer strings', () => {
    expect(parseProjectQueryParam('2')).toEqual({ kind: 'ok', id: 2 });
    expect(parseProjectQueryParam(' 3 ')).toEqual({ kind: 'ok', id: 3 });
  });

  it('returns invalid for malformed or non-canonical numbers', () => {
    for (const v of [
      'abc',
      '01',
      '+1',
      '1.0',
      '0',
      '-1',
      '',
      '   ',
      '1e2',
      '9007199254740993', // > Number.MAX_SAFE_INTEGER
    ]) {
      expect(parseProjectQueryParam(v), v).toEqual({ kind: 'invalid' });
    }
  });

  it('returns invalid for duplicate query values', () => {
    expect(parseProjectQueryParam(['1', '2'])).toEqual({ kind: 'invalid' });
  });

  it('parses a single-element array like a scalar', () => {
    expect(parseProjectQueryParam(['4'])).toEqual({ kind: 'ok', id: 4 });
  });
});

describe('resolveProjectDeepLinkAction', () => {
  const base = {
    projectIds: [1, 2],
    activeId: 1 as number | null,
  };

  it('skips non-board paths', () => {
    expect(
      resolveProjectDeepLinkAction({
        ...base,
        path: '/backlog',
        projectValues: ['2'],
      }),
    ).toEqual({ kind: 'skip' });
  });

  it('skips absent query on board', () => {
    expect(
      resolveProjectDeepLinkAction({ ...base, path: '/', projectValues: [] }),
    ).toEqual({ kind: 'skip' });
  });

  it('errors on invalid or unknown id', () => {
    expect(
      resolveProjectDeepLinkAction({ ...base, path: '/', projectValues: ['abc'] }),
    ).toEqual({ kind: 'error', message: PROJECT_QUERY_NOT_FOUND });
    expect(
      resolveProjectDeepLinkAction({ ...base, path: '/', projectValues: ['999'] }),
    ).toEqual({ kind: 'error', message: PROJECT_QUERY_NOT_FOUND });
  });

  it('skips when already active', () => {
    expect(
      resolveProjectDeepLinkAction({ ...base, path: '/', projectValues: ['1'] }),
    ).toEqual({ kind: 'skip' });
  });

  it('requests view when board + known different id', () => {
    expect(
      resolveProjectDeepLinkAction({ ...base, path: '/', projectValues: ['2'] }),
    ).toEqual({ kind: 'view', id: 2 });
    expect(isBoardPath('')).toBe(true);
  });
});

describe('withProjectQueryParam', () => {
  it('merges project id as string', () => {
    expect(withProjectQueryParam({ foo: '1' }, 2)).toEqual({ foo: '1', project: '2' });
  });
});

describe('urlPathOf', () => {
  it('drops query and fragment', () => {
    expect(urlPathOf('/backlog?project=2#x')).toBe('/backlog');
    expect(urlPathOf('/?project=1')).toBe('/');
    expect(urlPathOf('/items/3#c')).toBe('/items/3');
  });
});

describe('shouldSyncProjectQuery', () => {
  it('syncs when the path is unchanged even if the query differs', () => {
    expect(shouldSyncProjectQuery('/backlog?project=1', '/backlog?project=1&q=a')).toBe(true);
    expect(shouldSyncProjectQuery('/', '/?project=2')).toBe(true);
  });

  it('does not sync after moving to another page before completion', () => {
    expect(shouldSyncProjectQuery('/backlog', '/sprints')).toBe(false);
    expect(shouldSyncProjectQuery('/', '/ai-chat?project=1')).toBe(false);
  });
});
