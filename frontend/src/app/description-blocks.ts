import {
  DESCRIPTION_LINK_MAX_LEN,
  formatDescriptionLink,
  insertDescriptionLink,
} from './description-link';

export const DESCRIPTION_MAX_LEN = DESCRIPTION_LINK_MAX_LEN;

/** Unicode code-point length (matches textLimit / insertDescriptionLink). */
export function descriptionLength(text: string): number {
  return [...text].length;
}

export function parseDescriptionBlocks(text: string): string[] {
  if (text === '') return [''];
  return text.split('\n');
}

export function serializeDescriptionBlocks(blocks: string[]): string {
  return blocks.join('\n');
}

export function normalizeDescriptionBlocks(blocks: string[]): string[] {
  if (blocks.length === 0) return [''];
  const next: string[] = [];
  for (const block of blocks) {
    if (block.includes('\n')) {
      next.push(...block.split('\n'));
    } else {
      next.push(block);
    }
  }
  return next.length === 0 ? [''] : next;
}

function withinLimit(blocks: string[]): boolean {
  return descriptionLength(serializeDescriptionBlocks(blocks)) <= DESCRIPTION_MAX_LEN;
}

export function splitDescriptionBlock(
  blocks: string[],
  index: number,
  caret: number,
): string[] | null {
  if (index < 0 || index >= blocks.length) return null;
  const block = blocks[index]!;
  const at = Math.max(0, Math.min(caret, block.length));
  const next = [
    ...blocks.slice(0, index),
    block.slice(0, at),
    block.slice(at),
    ...blocks.slice(index + 1),
  ];
  if (!withinLimit(next)) return null;
  return next;
}

/** Insert an empty text block at `index` (`0..=blocks.length`). Null if out of range or over max length. */
export function insertEmptyBlockAt(blocks: string[], index: number): string[] | null {
  if (index < 0 || index > blocks.length) return null;
  const next = [...blocks.slice(0, index), '', ...blocks.slice(index)];
  if (!withinLimit(next)) return null;
  return next;
}

export function mergeDescriptionBlockWithPrevious(
  blocks: string[],
  index: number,
): { blocks: string[]; caret: number } | null {
  if (index <= 0 || index >= blocks.length || blocks.length < 2) return null;
  const prev = blocks[index - 1]!;
  const cur = blocks[index]!;
  const merged = prev + cur;
  const next = [...blocks.slice(0, index - 1), merged, ...blocks.slice(index + 1)];
  if (!withinLimit(next)) return null;
  return { blocks: next, caret: prev.length };
}

export function insertLinkInDescriptionBlocks(
  blocks: string[],
  index: number,
  start: number,
  end: number,
  label: string,
  url: string,
): { blocks: string[]; blockIndex: number; caret: number } | null {
  if (index < 0 || index >= blocks.length) return null;
  // Reject before insert: newline labels would break block boundaries after normalize.
  if (!formatDescriptionLink(label, url)) return null;
  const block = blocks[index]!;
  const inserted = insertDescriptionLink(block, start, end, label, url, DESCRIPTION_MAX_LEN);
  if (!inserted) return null;
  const next = [...blocks.slice(0, index), inserted.text, ...blocks.slice(index + 1)];
  const normalized = normalizeDescriptionBlocks(next);
  if (!withinLimit(normalized)) return null;
  return { blocks: normalized, blockIndex: index, caret: inserted.caret };
}
