import { describe, expect, it } from 'vitest';
import { hasDescriptionBlockSyntax, parseDescriptionMarkdown } from './description-markdown';

const p = (text: string) => ({ kind: 'paragraph', text });

describe('parseDescriptionMarkdown', () => {
  it('returns no blocks for empty text', () => {
    expect(parseDescriptionMarkdown('')).toEqual([]);
  });

  it('parses headings of three levels without trimming the text', () => {
    expect(parseDescriptionMarkdown('# a\n## b\n### c ')).toEqual([
      { kind: 'heading', level: 1, text: 'a' },
      { kind: 'heading', level: 2, text: 'b' },
      { kind: 'heading', level: 3, text: 'c ' },
    ]);
  });

  it.each(['#### a', '#a', '# ', '#   '])('treats %j as a paragraph', (line) => {
    expect(parseDescriptionMarkdown(line)).toEqual([p(line)]);
  });

  it('parses bullet lists, including empty items', () => {
    expect(parseDescriptionMarkdown('- a\n- b\n- ')).toEqual([
      { kind: 'bullet-list', items: ['a', 'b', ''] },
    ]);
    expect(parseDescriptionMarkdown('-a')).toEqual([p('-a')]);
  });

  it('parses ordered lists with the first number as start', () => {
    expect(parseDescriptionMarkdown('3. a\n1. b\n1. ')).toEqual([
      { kind: 'ordered-list', start: 3, items: ['a', 'b', ''] },
    ]);
  });

  it.each(['1.foo', '1234567890. a'])('treats %j as a paragraph', (line) => {
    expect(parseDescriptionMarkdown(line)).toEqual([p(line)]);
  });

  it('parses task lists with unchecked and checked states', () => {
    expect(parseDescriptionMarkdown('- [ ] a\n- [x] b\n- [X] c\n- [x]')).toEqual([
      {
        kind: 'task-list',
        items: [
          { checked: false, text: 'a' },
          { checked: true, text: 'b' },
          { checked: true, text: 'c' },
          { checked: true, text: '' },
        ],
      },
    ]);
  });

  it('treats "- [ ]foo" as a bullet item', () => {
    expect(parseDescriptionMarkdown('- [ ]foo')).toEqual([
      { kind: 'bullet-list', items: ['[ ]foo'] },
    ]);
  });

  it('parses quotes, including bare ">" lines', () => {
    expect(parseDescriptionMarkdown('> a\n>\n> b')).toEqual([{ kind: 'quote', text: 'a\n\nb' }]);
    expect(parseDescriptionMarkdown('>a')).toEqual([p('>a')]);
  });

  it('parses fenced code without interpreting its content', () => {
    expect(parseDescriptionMarkdown('```ts\n# x\n[l](https://e.com)\n```')).toEqual([
      { kind: 'code', text: '# x\n[l](https://e.com)' },
    ]);
    expect(parseDescriptionMarkdown('```\na\n``` ')).toEqual([{ kind: 'code', text: 'a' }]);
    expect(parseDescriptionMarkdown('```\n```')).toEqual([{ kind: 'code', text: '' }]);
  });

  it('runs unclosed code to the end and drops trailing blank lines', () => {
    expect(parseDescriptionMarkdown('```\na\nb')).toEqual([{ kind: 'code', text: 'a\nb' }]);
    expect(parseDescriptionMarkdown('```\na\n\n')).toEqual([{ kind: 'code', text: 'a' }]);
  });

  it.each(['```a```', '````'])('treats %j as a paragraph', (line) => {
    expect(parseDescriptionMarkdown(line)).toEqual([p(line)]);
  });

  it('closes the previous block when code starts', () => {
    expect(parseDescriptionMarkdown('a\n```\nx\n```\nb')).toEqual([
      p('a'),
      { kind: 'code', text: 'x' },
      p('b'),
    ]);
    expect(parseDescriptionMarkdown('- a\n```\nx\n```')).toEqual([
      { kind: 'bullet-list', items: ['a'] },
      { kind: 'code', text: 'x' },
    ]);
  });

  it('parses horizontal rules only for "---" lines', () => {
    expect(parseDescriptionMarkdown('---\n--- ')).toEqual([{ kind: 'rule' }, { kind: 'rule' }]);
    expect(parseDescriptionMarkdown('----')).toEqual([p('----')]);
    expect(parseDescriptionMarkdown('--- x')).toEqual([p('--- x')]);
  });

  it('keeps inner blank lines of a paragraph but drops leading and trailing ones', () => {
    expect(parseDescriptionMarkdown('a\n\nb')).toEqual([p('a\n\nb')]);
    expect(parseDescriptionMarkdown('\n\na\n\n# H\n\n')).toEqual([
      p('a'),
      { kind: 'heading', level: 1, text: 'H' },
    ]);
  });

  it('splits lists on blank lines and on a change of list kind', () => {
    expect(parseDescriptionMarkdown('- a\n\n- b')).toEqual([
      { kind: 'bullet-list', items: ['a'] },
      { kind: 'bullet-list', items: ['b'] },
    ]);
    expect(parseDescriptionMarkdown('- a\n1. b\n- [ ] c')).toEqual([
      { kind: 'bullet-list', items: ['a'] },
      { kind: 'ordered-list', start: 1, items: ['b'] },
      { kind: 'task-list', items: [{ checked: false, text: 'c' }] },
    ]);
  });

  it('does not treat indented lines as syntax', () => {
    expect(parseDescriptionMarkdown('  - a\n # a')).toEqual([p('  - a\n # a')]);
  });

  it('strips carriage returns before matching', () => {
    expect(parseDescriptionMarkdown('# a\r\n- b\r\nc\r\n')).toEqual([
      { kind: 'heading', level: 1, text: 'a' },
      { kind: 'bullet-list', items: ['b'] },
      p('c'),
    ]);
  });

  it('treats whitespace-only lines as blank around paragraphs', () => {
    expect(parseDescriptionMarkdown('a\n  \n# H')).toEqual([
      p('a'),
      { kind: 'heading', level: 1, text: 'H' },
    ]);
    expect(parseDescriptionMarkdown('a\n \nb')).toEqual([p('a\n \nb')]);
    expect(parseDescriptionMarkdown('   ')).toEqual([]);
  });

  it('separates a quote from a following paragraph', () => {
    expect(parseDescriptionMarkdown('> q\nb')).toEqual([{ kind: 'quote', text: 'q' }, p('b')]);
  });
});

describe('hasDescriptionBlockSyntax', () => {
  it('is true only when a non-paragraph block exists', () => {
    expect(hasDescriptionBlockSyntax('')).toBe(false);
    expect(hasDescriptionBlockSyntax('a\nb')).toBe(false);
    expect(hasDescriptionBlockSyntax('a\n---')).toBe(true);
  });
});
