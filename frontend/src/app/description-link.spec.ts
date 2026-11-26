import {
  buildAttachmentMarkup,
  buildFileAttachmentMarkup,
  formatDescriptionLink,
  insertDescriptionLink,
  normalizeDescriptionLinkLabel,
  normalizeDescriptionLinkUrl,
  parseDescriptionLinks,
  sanitizeAttachmentAlt,
} from './description-link';

describe('normalizeDescriptionLinkUrl', () => {
  it('accepts https and returns the trimmed same string', () => {
    expect(normalizeDescriptionLinkUrl('  https://Example.COM/path  ')).toBe(
      'https://Example.COM/path',
    );
  });

  it.each([
    ['http://example.com'],
    ['javascript:alert(1)'],
    ['data:text/html,hi'],
    ['/relative'],
    [''],
    ['https://' + 'a'.repeat(2041)],
    ['https://example.com/\npath'],
    ['https://example.com/\tpath'],
    ['https://example.com/\u0001x'],
    ['https://example.com/\u2028x'],
    ['https://example.com/\u2029x'],
    ['https://en.wikipedia.org/wiki/Foo_(bar)'],
  ])('rejects %j', (value) => {
    expect(normalizeDescriptionLinkUrl(value)).toBeNull();
  });
});

describe('normalizeDescriptionLinkLabel', () => {
  it('trims a valid label', () => {
    expect(normalizeDescriptionLinkLabel('  Docs  ')).toBe('Docs');
  });

  it('rejects empty or bracket-containing labels', () => {
    expect(normalizeDescriptionLinkLabel('   ')).toBeNull();
    expect(normalizeDescriptionLinkLabel('a]b')).toBeNull();
  });

  it('rejects labels that contain newlines', () => {
    expect(normalizeDescriptionLinkLabel('a\nb')).toBeNull();
  });
});

describe('formatDescriptionLink / insertDescriptionLink', () => {
  it('formats a markdown link', () => {
    expect(formatDescriptionLink('Docs', 'https://example.com')).toBe(
      '[Docs](https://example.com)',
    );
  });

  it('inserts at caret and replaces a selection', () => {
    const atCaret = insertDescriptionLink('hello', 5, 5, 'x', 'https://a.com');
    expect(atCaret).toEqual({ text: 'hello[x](https://a.com)', caret: 23 });

    const replaced = insertDescriptionLink('say hi there', 4, 6, 'hi', 'https://a.com');
    expect(replaced).toEqual({ text: 'say [hi](https://a.com) there', caret: 23 });
  });

  it('returns null when validation fails and leaves caller text unused', () => {
    expect(insertDescriptionLink('body', 0, 0, '', 'https://a.com')).toBeNull();
    expect(insertDescriptionLink('body', 0, 0, 'x', 'http://a.com')).toBeNull();
  });

  it('rejects inserts that would exceed 10000 characters', () => {
    const prefix = 'a'.repeat(9990);
    expect(insertDescriptionLink(prefix, 9990, 9990, 'lab', 'https://a.com')).toBeNull();
  });

  it('keeps the normalized url identical through insert and parse (L-018)', () => {
    const url = normalizeDescriptionLinkUrl('https://Example.COM/x')!;
    const inserted = insertDescriptionLink('', 0, 0, 'L', url)!;
    const segments = parseDescriptionLinks(inserted.text);
    expect(segments).toEqual([{ kind: 'link', label: 'L', url }]);
    expect(segments[0].kind === 'link' && segments[0].url).toBe(url);
  });
});

describe('parseDescriptionLinks', () => {
  it('returns plain text as a single text segment', () => {
    expect(parseDescriptionLinks('plain')).toEqual([{ kind: 'text', text: 'plain' }]);
  });

  it('parses a link with surrounding text', () => {
    expect(parseDescriptionLinks('see [Docs](https://example.com) now')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', label: 'Docs', url: 'https://example.com' },
      { kind: 'text', text: ' now' },
    ]);
  });

  it('keeps non-https markdown as text', () => {
    expect(parseDescriptionLinks('[x](javascript:alert(1))')).toEqual([
      { kind: 'text', text: '[x](javascript:alert(1))' },
    ]);
  });

  it('does not truncate parenthesized URLs into a shorter href', () => {
    const raw = '[W](https://en.wikipedia.org/wiki/Foo_(bar))';
    expect(parseDescriptionLinks(raw)).toEqual([{ kind: 'text', text: raw }]);
  });

  it('does not interpret HTML as markup', () => {
    expect(parseDescriptionLinks('<script>alert(1)</script>')).toEqual([
      { kind: 'text', text: '<script>alert(1)</script>' },
    ]);
  });

  it('parses same-item attachment images before links', () => {
    const src = '/api/items/by-number/7/attachments/3/content';
    expect(parseDescriptionLinks(`see ![pic](${src}) now`, 7)).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'image', alt: 'pic', src, attachmentId: 3 },
      { kind: 'text', text: ' now' },
    ]);
  });

  it('leaves external image markdown and other-item paths as text', () => {
    const external = '![x](https://evil.example/a.png)';
    expect(parseDescriptionLinks(external, 7)).toEqual([{ kind: 'text', text: external }]);
    const other = '![x](/api/items/by-number/8/attachments/3/content)';
    expect(parseDescriptionLinks(other, 7)).toEqual([{ kind: 'text', text: other }]);
  });

  it('sanitizes alt and builds markup', () => {
    expect(sanitizeAttachmentAlt('a]b\nc')).toBe('abc');
    expect(buildAttachmentMarkup(2, 9, 'a]b')).toBe(
      '![ab](/api/items/by-number/2/attachments/9/content)',
    );
  });

  it('builds and parses same-item file attachment links', () => {
    expect(buildFileAttachmentMarkup(2, 9, 'a]b\nc')).toBe(
      '[abc](/api/items/by-number/2/attachments/9/content)',
    );
    expect(buildFileAttachmentMarkup(2, 9, '  ')).toBe(
      '[file](/api/items/by-number/2/attachments/9/content)',
    );
    const src = '/api/items/by-number/7/attachments/3/content';
    expect(parseDescriptionLinks(`see [doc.pdf](${src}) now`, 7)).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'file', label: 'doc.pdf', src, attachmentId: 3 },
      { kind: 'text', text: ' now' },
    ]);
  });
});
