import { type DescriptionSegment, parseDescriptionLinks } from './description-link';
import { parseDescriptionMarkdown } from './description-markdown';

/** Display form: inline links/images already parsed; code stays raw text. */
export type DescriptionViewBlock =
  | { kind: 'paragraph'; segments: DescriptionSegment[] }
  | { kind: 'heading'; level: 1 | 2 | 3; segments: DescriptionSegment[] }
  | { kind: 'bullet-list'; items: DescriptionSegment[][] }
  | { kind: 'ordered-list'; start: number; items: DescriptionSegment[][] }
  | {
      kind: 'task-list';
      items: { checked: boolean; label: string; segments: DescriptionSegment[] }[];
    }
  | { kind: 'quote'; segments: DescriptionSegment[] }
  | { kind: 'code'; text: string }
  | { kind: 'rule' };

const TASK_LABEL_FALLBACK = 'チェック項目';

/** Readable name for a task checkbox: text, link labels and image alts, without markup. */
function taskLabel(segments: DescriptionSegment[]): string {
  const label = segments
    .map((seg) => (seg.kind === 'text' ? seg.text : seg.kind === 'link' ? seg.label : seg.alt))
    .join('')
    .trim();
  return label || TASK_LABEL_FALLBACK;
}

/**
 * Display blocks for `DescriptionRichText`. With `blockSyntax` off the whole text is one
 * paragraph (unchanged legacy rendering for comments and solutions).
 */
export function buildDescriptionView(
  text: string,
  itemNumber: number,
  blockSyntax: boolean,
): DescriptionViewBlock[] {
  const inline = (s: string) => parseDescriptionLinks(s, itemNumber);
  if (!blockSyntax) return [{ kind: 'paragraph', segments: inline(text) }];
  return parseDescriptionMarkdown(text).map((block): DescriptionViewBlock => {
    switch (block.kind) {
      case 'paragraph':
      case 'quote':
        return { kind: block.kind, segments: inline(block.text) };
      case 'heading':
        return { kind: 'heading', level: block.level, segments: inline(block.text) };
      case 'bullet-list':
        return { kind: 'bullet-list', items: block.items.map(inline) };
      case 'ordered-list':
        return { kind: 'ordered-list', start: block.start, items: block.items.map(inline) };
      case 'task-list':
        return {
          kind: 'task-list',
          items: block.items.map((item) => {
            const segments = inline(item.text);
            return { checked: item.checked, label: taskLabel(segments), segments };
          }),
        };
      case 'code':
      case 'rule':
        return block;
    }
  });
}
