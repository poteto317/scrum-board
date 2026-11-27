import {
  type DescriptionSegment,
  isBookmarkLink,
  parseDescriptionLinks,
} from './description-link';
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

export type BuildDescriptionViewOptions = {
  /** When true, promote a sole bookmark-shaped link in a paragraph to `bookmark`. */
  promoteBookmarks?: boolean;
};

const TASK_LABEL_FALLBACK = 'チェック項目';

/** Readable name for a task checkbox: plain text, link/file labels, image alts. */
function taskLabel(segments: DescriptionSegment[]): string {
  const label = segments
    .map((seg) => {
      switch (seg.kind) {
        case 'text':
          return seg.text;
        case 'link':
        case 'bookmark':
        case 'file':
          return seg.label;
        case 'image':
          return seg.alt;
      }
    })
    .join('')
    .trim();
  return label || TASK_LABEL_FALLBACK;
}

/** Bookmark URLs from paragraph blocks only (for link-preview batching). */
export function collectBookmarkUrls(blocks: DescriptionViewBlock[]): string[] {
  const urls: string[] = [];
  for (const block of blocks) {
    if (block.kind !== 'paragraph') continue;
    for (const seg of block.segments) {
      if (seg.kind === 'bookmark') urls.push(seg.url);
    }
  }
  return urls;
}

function promoteParagraphBookmarks(segments: DescriptionSegment[]): DescriptionSegment[] {
  const meaningful = segments.filter((seg) => !(seg.kind === 'text' && seg.text.trim() === ''));
  if (meaningful.length !== 1 || meaningful[0].kind !== 'link') return segments;
  const link = meaningful[0];
  if (!isBookmarkLink(link.label, link.url)) return segments;
  return segments.map((seg) =>
    seg === link ? { kind: 'bookmark' as const, label: link.label, url: link.url } : seg,
  );
}

/**
 * Display blocks for `DescriptionRichText`. With `blockSyntax` off the whole text is one
 * paragraph. Pass `promoteBookmarks` for description/solution bookmark cards; leave it off for comments.
 */
export function buildDescriptionView(
  text: string,
  itemNumber: number,
  blockSyntax: boolean,
  options?: BuildDescriptionViewOptions,
): DescriptionViewBlock[] {
  const promote = options?.promoteBookmarks === true;
  const inline = (s: string) => parseDescriptionLinks(s, itemNumber);
  const paragraphSegments = (s: string) => {
    const segs = inline(s);
    return promote ? promoteParagraphBookmarks(segs) : segs;
  };
  if (!blockSyntax) return [{ kind: 'paragraph', segments: paragraphSegments(text) }];
  return parseDescriptionMarkdown(text).map((block): DescriptionViewBlock => {
    switch (block.kind) {
      case 'paragraph':
        return { kind: 'paragraph', segments: paragraphSegments(block.text) };
      case 'quote':
        return { kind: 'quote', segments: inline(block.text) };
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
