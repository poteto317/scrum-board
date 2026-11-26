import { describe, expect, it } from 'vitest';
import {
  clipboardFilesToAttach,
  filesFromDataTransfer,
  pasteLinkOverSelection,
} from './paste-content';

function file(name: string, type: string, size = 3): File {
  const f = new File([new Uint8Array([1, 2, 3])], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function transfer(opts: {
  text?: string;
  html?: boolean;
  files?: File[];
  items?: { kind: string; getAsFile: () => File | null }[];
}): DataTransfer {
  return {
    getData: (t: string) => (t === 'text/plain' ? (opts.text ?? '') : ''),
    files: opts.files ?? [],
    items: opts.items ?? [],
    types: [
      ...(opts.text ? ['text/plain'] : []),
      ...(opts.html ? ['text/html'] : []),
      ...(opts.files?.length ? ['Files'] : []),
    ],
  } as unknown as DataTransfer;
}

describe('filesFromDataTransfer', () => {
  it('returns nothing without a transfer', () => {
    expect(filesFromDataTransfer(null)).toEqual([]);
    expect(filesFromDataTransfer(undefined)).toEqual([]);
  });

  it('prefers files and falls back to file items', () => {
    const a = file('a.png', 'image/png');
    const b = file('b.png', 'image/png');
    expect(filesFromDataTransfer(transfer({ files: [a, b] }))).toEqual([a, b]);
    expect(
      filesFromDataTransfer(
        transfer({
          items: [
            { kind: 'string', getAsFile: () => null },
            { kind: 'file', getAsFile: () => a },
            { kind: 'file', getAsFile: () => null },
          ],
        }),
      ),
    ).toEqual([a]);
  });
});

describe('clipboardFilesToAttach', () => {
  const a = file('image.png', 'image/png');

  it('returns the files of a screenshot (no text)', () => {
    expect(clipboardFilesToAttach(transfer({ files: [a] }))).toEqual([a]);
    expect(clipboardFilesToAttach(transfer({ files: [a], text: '  \n' }))).toEqual([a]);
  });

  it('returns the files when the text is only a file name or an image URL', () => {
    expect(clipboardFilesToAttach(transfer({ files: [a], text: 'image.png' }))).toEqual([a]);
    expect(clipboardFilesToAttach(transfer({ files: [a], html: true }))).toEqual([a]);
  });

  it('prefers the text when the clipboard has text, HTML and an image (spreadsheet cells)', () => {
    expect(clipboardFilesToAttach(transfer({ files: [a], text: 'A1\tB1', html: true }))).toEqual([]);
  });

  it('returns nothing without files or without a clipboard', () => {
    expect(clipboardFilesToAttach(transfer({ text: 'hello', html: true }))).toEqual([]);
    expect(clipboardFilesToAttach(null)).toEqual([]);
  });
});

describe('pasteLinkOverSelection', () => {
  const url = 'https://example.com/a';

  it('wraps the selection in a link and puts the caret after it', () => {
    const r = pasteLinkOverSelection('see docs here', 4, 8, url, 100);
    expect(r).toEqual({
      kind: 'ok',
      text: `see [docs](${url}) here`,
      caret: `see [docs](${url})`.length,
    });
  });

  it('accepts a reversed selection', () => {
    const r = pasteLinkOverSelection('see docs', 8, 4, url, 100);
    expect(r.kind === 'ok' && r.text).toBe(`see [docs](${url})`);
  });

  it('keeps whitespace around the selection outside the link', () => {
    const r = pasteLinkOverSelection('a docs b', 1, 7, url, 100);
    expect(r).toEqual({
      kind: 'ok',
      text: `a [docs](${url}) b`,
      caret: `a [docs](${url})`.length,
    });
  });

  it('leaves the paste to the browser without a selection', () => {
    expect(pasteLinkOverSelection('docs', 2, 2, url, 100)).toEqual({ kind: 'default' });
  });

  it('leaves the paste to the browser when the text is not an https URL', () => {
    for (const pasted of ['hello', 'http://example.com', 'javascript:alert(1)', `${url} x(`, '']) {
      expect(pasteLinkOverSelection('docs', 0, 4, pasted, 100)).toEqual({ kind: 'default' });
    }
  });

  it('leaves the paste to the browser when the selection cannot be a label', () => {
    expect(pasteLinkOverSelection('a]b', 0, 3, url, 100)).toEqual({ kind: 'default' });
    expect(pasteLinkOverSelection('a\nb', 0, 3, url, 100)).toEqual({ kind: 'default' });
    expect(pasteLinkOverSelection('   ', 0, 3, url, 100)).toEqual({ kind: 'default' });
  });

  it('leaves the paste to the browser when the selection is itself a URL (a replacement)', () => {
    const body = 'see https://old.example/a now';
    expect(pasteLinkOverSelection(body, 4, 25, url, 200)).toEqual({ kind: 'default' });
  });

  it('leaves the paste to the browser when the selection touches existing link or image markup', () => {
    const link = '[foo](https://old.example/a)';
    expect(pasteLinkOverSelection(link, 6, link.length - 1, url, 200)).toEqual({ kind: 'default' });
    expect(pasteLinkOverSelection(link, 1, 4, url, 200)).toEqual({ kind: 'default' });
    const image = 'a ![shot](/api/items/by-number/3/attachments/9/content) b';
    expect(pasteLinkOverSelection(image, 4, 8, url, 200)).toEqual({ kind: 'default' });
    expect(pasteLinkOverSelection(image, 0, image.length, url, 300)).toEqual({ kind: 'default' });
  });

  it('still links text next to existing markup', () => {
    const body = '[foo](https://old.example/a) bar';
    const r = pasteLinkOverSelection(body, body.length - 3, body.length, url, 200);
    expect(r.kind === 'ok' && r.text).toBe(`[foo](https://old.example/a) [bar](${url})`);
  });

  it('leaves the paste to the browser right after "!" (it would read as an image)', () => {
    expect(pasteLinkOverSelection('!x', 1, 2, url, 100)).toEqual({ kind: 'default' });
  });

  it('reports an error when the link would exceed the limit', () => {
    expect(pasteLinkOverSelection('docs', 0, 4, url, 10)).toEqual({ kind: 'error' });
  });
});
