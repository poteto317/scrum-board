/**
 * Block-level structure of a description written in a small Markdown subset:
 * headings (`#`–`###`), `- ` bullets, `1. ` ordered items, `- [ ] ` / `- [x] ` tasks,
 * `> ` quotes, ``` fenced code and `---` rules. Everything else is a paragraph.
 */
export type DescriptionMarkdownBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'bullet-list'; items: string[] }
  | { kind: 'ordered-list'; start: number; items: string[] }
  | { kind: 'task-list'; items: { checked: boolean; text: string }[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'rule' };

const HEADING = /^(#{1,3}) (.*)$/;
const TASK = /^- \[([ xX])\](?: (.*))?$/;
const BULLET = /^- (.*)$/;
const ORDERED = /^(\d{1,9})\. (.*)$/;
const QUOTE = /^>(?: (.*))?$/;
const CODE_FENCE_OPEN = /^```[^`]*$/;
const CODE_FENCE = '```';
const RULE = '---';

/**
 * Block built from a single line. Consecutive lists, quotes and paragraphs of the same kind
 * are joined by `appendToPrevious`; headings never join.
 */
type LineBlock = Exclude<DescriptionMarkdownBlock, { kind: 'code' } | { kind: 'rule' }>;

function classifyLine(line: string): LineBlock | { kind: 'rule' } {
  if (line.trimEnd() === RULE) return { kind: 'rule' };
  const heading = HEADING.exec(line);
  if (heading && heading[2]!.trim() !== '') {
    return { kind: 'heading', level: heading[1]!.length as 1 | 2 | 3, text: heading[2]! };
  }
  const task = TASK.exec(line);
  if (task) {
    return { kind: 'task-list', items: [{ checked: task[1] !== ' ', text: task[2] ?? '' }] };
  }
  const bullet = BULLET.exec(line);
  if (bullet) return { kind: 'bullet-list', items: [bullet[1]!] };
  const ordered = ORDERED.exec(line);
  if (ordered) return { kind: 'ordered-list', start: Number(ordered[1]), items: [ordered[2]!] };
  const quote = QUOTE.exec(line);
  if (quote) return { kind: 'quote', text: quote[1] ?? '' };
  return { kind: 'paragraph', text: line };
}

/**
 * Extend the parser's own last block (`prev`, never shared) with a line of the same kind.
 * Returns false when the kinds differ, so the caller starts a new block.
 */
function appendToPrevious(prev: DescriptionMarkdownBlock, next: LineBlock): boolean {
  if (prev.kind === 'bullet-list' && next.kind === 'bullet-list') {
    prev.items.push(...next.items);
  } else if (prev.kind === 'ordered-list' && next.kind === 'ordered-list') {
    prev.items.push(...next.items);
  } else if (prev.kind === 'task-list' && next.kind === 'task-list') {
    prev.items.push(...next.items);
  } else if (
    (prev.kind === 'quote' && next.kind === 'quote') ||
    (prev.kind === 'paragraph' && next.kind === 'paragraph')
  ) {
    prev.text += '\n' + next.text;
  } else {
    return false;
  }
  return true;
}

function dropOuterBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === '') start += 1;
  while (end > start && lines[end - 1]!.trim() === '') end -= 1;
  return lines.slice(start, end);
}

/** Paragraphs lose leading/trailing blank lines; empty ones are removed. */
function finalizeParagraphs(blocks: DescriptionMarkdownBlock[]): DescriptionMarkdownBlock[] {
  const out: DescriptionMarkdownBlock[] = [];
  for (const block of blocks) {
    if (block.kind !== 'paragraph') {
      out.push(block);
      continue;
    }
    const lines = dropOuterBlankLines(block.text.split('\n'));
    if (lines.length > 0) out.push({ kind: 'paragraph', text: lines.join('\n') });
  }
  return out;
}

/**
 * Collect code lines from `start` up to the closing fence. Unclosed code runs to the end
 * without trailing blank lines. `next` is the index after the closing fence.
 */
function readCodeBlock(
  lines: string[],
  start: number,
): { block: { kind: 'code'; text: string }; next: number } {
  const body: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    if (lines[i]!.trimEnd() === CODE_FENCE) {
      return { block: { kind: 'code', text: body.join('\n') }, next: i + 1 };
    }
    body.push(lines[i]!);
  }
  while (body.length > 0 && body[body.length - 1] === '') body.pop();
  return { block: { kind: 'code', text: body.join('\n') }, next: lines.length };
}

export function parseDescriptionMarkdown(text: string): DescriptionMarkdownBlock[] {
  if (text === '') return [];
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''));
  const blocks: DescriptionMarkdownBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (CODE_FENCE_OPEN.test(line)) {
      const code = readCodeBlock(lines, i + 1);
      blocks.push(code.block);
      i = code.next;
      continue;
    }
    const block = classifyLine(line);
    const prev = blocks[blocks.length - 1];
    if (block.kind === 'rule' || !prev || !appendToPrevious(prev, block)) {
      blocks.push(block);
    }
    i += 1;
  }
  return finalizeParagraphs(blocks);
}

export function hasDescriptionBlockSyntax(text: string): boolean {
  return parseDescriptionMarkdown(text).some((block) => block.kind !== 'paragraph');
}

