import { DESCRIPTION_LINK_MAX_LEN } from './description-link';
import {
  DESCRIPTION_MAX_LEN,
  descriptionLength,
  insertEmptyBlockAt,
  insertLinkInDescriptionBlocks,
  mergeDescriptionBlockWithPrevious,
  normalizeDescriptionBlocks,
  parseDescriptionBlocks,
  serializeDescriptionBlocks,
  splitDescriptionBlock,
} from './description-blocks';

describe('description-blocks', () => {
  it('parses empty to a single empty block and serializes back', () => {
    expect(parseDescriptionBlocks('')).toEqual(['']);
    expect(serializeDescriptionBlocks([''])).toBe('');
  });

  it('round-trips newlines and trailing newline', () => {
    expect(parseDescriptionBlocks('a\nb')).toEqual(['a', 'b']);
    expect(serializeDescriptionBlocks(['a', 'b'])).toBe('a\nb');
    expect(parseDescriptionBlocks('a\n')).toEqual(['a', '']);
    expect(serializeDescriptionBlocks(['a', ''])).toBe('a\n');
  });

  it('round-trips markdown links', () => {
    const text = 'see [doc](https://example.com) please';
    expect(serializeDescriptionBlocks(parseDescriptionBlocks(text))).toBe(text);
  });

  it('uses code-point length like textLimit', () => {
    expect(DESCRIPTION_MAX_LEN).toBe(DESCRIPTION_LINK_MAX_LEN);
    expect(descriptionLength('あ')).toBe(1);
    expect(descriptionLength('🙂')).toBe(1);
  });

  it('normalizes embedded newlines inside a block', () => {
    expect(normalizeDescriptionBlocks(['a\nb', 'c'])).toEqual(['a', 'b', 'c']);
    expect(normalizeDescriptionBlocks([])).toEqual(['']);
  });

  it('splits a block at caret', () => {
    expect(splitDescriptionBlock(['hello'], 0, 2)).toEqual(['he', 'llo']);
  });

  it('rejects split that would exceed max length', () => {
    const almost = 'x'.repeat(DESCRIPTION_MAX_LEN);
    // splitting '' into ['', ''] serializes to '\n' (len 1) — use full-length single block
    expect(splitDescriptionBlock([almost], 0, 0)).toBeNull();
  });

  it('inserts an empty block at start, middle, and end', () => {
    expect(insertEmptyBlockAt(['a', 'b'], 0)).toEqual(['', 'a', 'b']);
    expect(insertEmptyBlockAt(['a', 'b'], 1)).toEqual(['a', '', 'b']);
    expect(insertEmptyBlockAt(['a', 'b'], 2)).toEqual(['a', 'b', '']);
  });

  it('rejects insertEmptyBlockAt out of range or over max length', () => {
    expect(insertEmptyBlockAt(['a'], -1)).toBeNull();
    expect(insertEmptyBlockAt(['a'], 2)).toBeNull();
    const almost = 'x'.repeat(DESCRIPTION_MAX_LEN);
    expect(insertEmptyBlockAt([almost], 1)).toBeNull();
  });

  it('merges with previous and returns caret at join', () => {
    expect(mergeDescriptionBlockWithPrevious(['ab', 'cd'], 1)).toEqual({
      blocks: ['abcd'],
      caret: 2,
    });
  });

  it('rejects merge on first or sole block', () => {
    expect(mergeDescriptionBlockWithPrevious(['only'], 0)).toBeNull();
    expect(mergeDescriptionBlockWithPrevious(['a', 'b'], 0)).toBeNull();
  });

  it('inserts a link in the second block without shifting offsets to absolute', () => {
    const result = insertLinkInDescriptionBlocks(
      ['first', 'hello'],
      1,
      0,
      5,
      'doc',
      'https://example.com',
    );
    expect(result).not.toBeNull();
    expect(serializeDescriptionBlocks(result!.blocks)).toBe(
      'first\n[doc](https://example.com)',
    );
    expect(result!.blockIndex).toBe(1);
  });

  it('rejects link insert that would exceed max length', () => {
    const block = 'x'.repeat(DESCRIPTION_MAX_LEN - 1);
    expect(
      insertLinkInDescriptionBlocks([block], 0, 0, 0, 'a', 'https://example.com'),
    ).toBeNull();
  });

  it('rejects labels that contain newlines so normalize cannot split the markdown', () => {
    expect(
      insertLinkInDescriptionBlocks(['hello'], 0, 0, 5, 'a\nb', 'https://example.com'),
    ).toBeNull();
  });
});
