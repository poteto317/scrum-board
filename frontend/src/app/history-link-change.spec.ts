import { describe, expect, it } from 'vitest';
import {
  collectPrUrlsFromEvents,
  mergePrTitleMap,
  missingPrTitleUrls,
  renderLinkChange,
} from './history-link-change';

describe('renderLinkChange', () => {
  it('parses prUrls arrays and empty prUrl', () => {
    expect(renderLinkChange('prUrls', '[]')).toEqual({ kind: 'pr', urls: [] });
    expect(renderLinkChange('prUrl', '')).toEqual({ kind: 'pr', urls: [] });
    expect(renderLinkChange('prUrls', 'not-json')).toBeNull();
  });

  it('parses relatedItems snapshots', () => {
    const json = JSON.stringify([{ kind: 'item', number: 3, label: 'X' }]);
    expect(renderLinkChange('relatedItems', json)).toEqual({
      kind: 'related',
      items: [{ kind: 'item', number: 3, label: 'X' }],
    });
  });
});

describe('collectPrUrlsFromEvents', () => {
  it('collects unique valid PR urls from changes', () => {
    const url = 'https://github.com/a/b/pull/1';
    const urls = collectPrUrlsFromEvents([
      {
        changes: [
          { field: 'prUrls', before: '[]', after: JSON.stringify([url, url]) },
          { field: 'title', before: 'a', after: 'b' },
        ],
      },
    ]);
    expect(urls).toEqual([url]);
  });
});

describe('missingPrTitleUrls / mergePrTitleMap', () => {
  const url = 'https://github.com/a/b/pull/1';
  const events = [{ changes: [{ field: 'prUrls', before: '[]', after: JSON.stringify([url]) }] }];

  it('skips urls already in the map', () => {
    expect(missingPrTitleUrls(events, { [url]: 'Known' })).toEqual([]);
    expect(missingPrTitleUrls(events, {})).toEqual([url]);
  });

  it('merges titles without mutating previous', () => {
    const prev = { a: '1' };
    const next = mergePrTitleMap(prev, { [url]: 'Cool' });
    expect(next).toEqual({ a: '1', [url]: 'Cool' });
    expect(prev).toEqual({ a: '1' });
  });
});
