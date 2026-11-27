export type ImageDisplaySize = 'sm' | 'md' | 'lg';

export type DescriptionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; label: string; url: string }
  /** Display-only; produced by `buildDescriptionView` promote, never by `parseDescriptionLinks`. */
  | { kind: 'bookmark'; label: string; url: string }
  | {
      kind: 'image';
      alt: string;
      src: string;
      attachmentId: number;
      displaySize: ImageDisplaySize;
    }
  | { kind: 'file'; label: string; src: string; attachmentId: number };

/** Allowed inline sizes; anything else → md (L-018: same fn for parse and build). */
export function normalizeImageDisplaySize(value: string | null | undefined): ImageDisplaySize {
  if (value === 'sm' || value === 'md' || value === 'lg') return value;
  return 'md';
}

/** True when markdown label is the raw URL itself (bookmark candidate). */
export function isBookmarkLink(label: string, url: string): boolean {
  return label === url && normalizeDescriptionLinkUrl(url) !== null;
}

/** Hostname for display fallback when a link preview title is missing. */
export function hostnameFallback(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

const MAX_URL_LEN = 2048;
/** Max Unicode length for description after link insert (matches form textLimit). */
export const DESCRIPTION_LINK_MAX_LEN = 10000;

/** Trimmed allowed URL, or null. Use only this return value for insert/href (L-018). */
export function normalizeDescriptionLinkUrl(value: string): string | null {
  const text = value.trim();
  // Reject C0/C1 controls and `()` so the `)`-terminated markdown parser cannot truncate href (L-018).
  if (
    !text ||
    text.length > MAX_URL_LEN ||
    /[\u0000-\u001F\u007F-\u009F\u2028\u2029()]/.test(text)
  ) {
    return null;
  }
  if (!/^https:\/\//.test(text)) return null;
  try {
    const u = new URL(text);
    if (u.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return text;
}

/** Trimmed label, or null when empty, contains `]`, or contains a newline (breaks block split). */
export function normalizeDescriptionLinkLabel(value: string): string | null {
  const text = value.trim();
  if (!text || text.includes(']') || text.includes('\n')) return null;
  return text;
}

export function sanitizeAttachmentName(name: string, fallback: string): string {
  let text = name.replace(/]/g, '').replace(/[\r\n]/g, '').trim();
  if (!text) text = fallback || 'file';
  if ([...text].length > 200) text = [...text].slice(0, 200).join('');
  return text;
}

export function sanitizeAttachmentAlt(name: string): string {
  return sanitizeAttachmentName(name, 'image');
}

export function attachmentContentPath(itemNumber: number, attachmentId: number): string {
  return `/api/items/by-number/${itemNumber}/attachments/${attachmentId}/content`;
}

export function isAttachmentContentPath(
  path: string,
  itemNumber: number,
): number | null {
  const m = path.match(
    new RegExp(`^/api/items/by-number/${itemNumber}/attachments/(\\d+)/content$`),
  );
  if (!m) return null;
  const id = Number(m[1]);
  return id > 0 ? id : null;
}

export function buildAttachmentMarkup(
  itemNumber: number,
  attachmentId: number,
  alt: string,
  displaySize: ImageDisplaySize | string = 'md',
): string {
  const path = attachmentContentPath(itemNumber, attachmentId);
  const size = normalizeImageDisplaySize(displaySize);
  const title = size === 'md' ? '' : ` "${size}"`;
  return `![${sanitizeAttachmentName(alt, 'image')}](${path}${title})`;
}

/**
 * Rewrite every same-item image markup for `attachmentId` to the given display size.
 * Uses normalize + buildAttachmentMarkup (L-018); does not hand-concatenate titles.
 */
export function setAttachmentImageDisplaySize(
  text: string,
  itemNumber: number,
  attachmentId: number,
  displaySize: ImageDisplaySize | string,
): string {
  if (itemNumber <= 0 || attachmentId <= 0) return text;
  const size = normalizeImageDisplaySize(displaySize);
  const path = attachmentContentPath(itemNumber, attachmentId);
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `!\\[([^\\]\\n\\r]*)]\\(${escaped}(?:\\s+"[^"]*")?\\)`,
    'g',
  );
  return text.replace(re, (_m, alt: string) =>
    buildAttachmentMarkup(itemNumber, attachmentId, alt || 'image', size),
  );
}

/** Split `path` or `path "title"` inside markdown parens (space before quotes required). */
export function splitMarkdownLinkDestination(inside: string): {
  path: string;
  title: string | null;
} {
  const m = inside.match(/^(\S+)(?:\s+"([^"]*)")?\s*$/);
  if (!m) return { path: inside, title: null };
  return { path: m[1], title: m[2] ?? null };
}

export function buildFileAttachmentMarkup(
  itemNumber: number,
  attachmentId: number,
  name: string,
): string {
  return `[${sanitizeAttachmentName(name, 'file')}](${attachmentContentPath(itemNumber, attachmentId)})`;
}

/** 画像記法とファイル記法の選択（許可 MIME の判定は呼び出し側）。 */
export function buildAttachmentMarkupForKind(
  kind: 'image' | 'file',
  itemNumber: number,
  attachmentId: number,
  name: string,
): string {
  return kind === 'image'
    ? buildAttachmentMarkup(itemNumber, attachmentId, name)
    : buildFileAttachmentMarkup(itemNumber, attachmentId, name);
}

export function formatDescriptionLink(label: string, url: string): string | null {
  const normalizedLabel = normalizeDescriptionLinkLabel(label);
  const normalizedUrl = normalizeDescriptionLinkUrl(url);
  if (!normalizedLabel || !normalizedUrl) return null;
  return `[${normalizedLabel}](${normalizedUrl})`;
}

export function insertDescriptionLink(
  text: string,
  start: number,
  end: number,
  label: string,
  url: string,
  maxLen: number = DESCRIPTION_LINK_MAX_LEN,
): { text: string; caret: number } | null {
  const markdown = formatDescriptionLink(label, url);
  if (!markdown) return null;
  return insertMarkupAt(text, start, end, markdown, maxLen);
}

export function insertMarkupAt(
  text: string,
  start: number,
  end: number,
  markdown: string,
  maxLen: number = DESCRIPTION_LINK_MAX_LEN,
): { text: string; caret: number } | null {
  const from = Math.max(0, Math.min(start, end, text.length));
  const to = Math.max(0, Math.min(Math.max(start, end), text.length));
  const next = text.slice(0, from) + markdown + text.slice(to);
  if ([...next].length > maxLen) return null;
  return { text: next, caret: from + markdown.length };
}

/**
 * Parse description/solution/comment text into display segments.
 * Same-item `![alt](path)` → image; same-item `[label](path)` → file download link;
 * `https://` links → link. External image URLs and other-item paths stay as text.
 */
export function parseDescriptionLinks(
  text: string,
  itemNumber?: number,
): DescriptionSegment[] {
  const segments: DescriptionSegment[] = [];
  let i = 0;
  let textStart = 0;

  const pushText = (end: number) => {
    if (end > textStart) {
      segments.push({ kind: 'text', text: text.slice(textStart, end) });
    }
  };

  while (i < text.length) {
    // Prefer ![alt](path) over [label](url)
    if (text[i] === '!' && text[i + 1] === '[') {
      const labelEnd = text.indexOf('](', i + 2);
      if (labelEnd < 0) {
        i += 1;
        continue;
      }
      const urlEnd = text.indexOf(')', labelEnd + 2);
      if (urlEnd < 0) {
        i += 1;
        continue;
      }
      const alt = text.slice(i + 2, labelEnd);
      const inside = text.slice(labelEnd + 2, urlEnd);
      const { path, title } = splitMarkdownLinkDestination(inside);
      const attachmentId =
        itemNumber != null && itemNumber > 0 ? isAttachmentContentPath(path, itemNumber) : null;
      if (
        attachmentId != null &&
        !alt.includes(']') &&
        !alt.includes('\n') &&
        !alt.includes('\r')
      ) {
        pushText(i);
        segments.push({
          kind: 'image',
          alt: alt || 'image',
          src: path,
          attachmentId,
          displaySize: normalizeImageDisplaySize(title),
        });
        i = urlEnd + 1;
        textStart = i;
        continue;
      }
      // Complete ![…](…) that is not a same-item attachment stays plain text
      // (do not fall through to link parsing on the `[`).
      i = urlEnd + 1;
      continue;
    }

    if (text[i] !== '[') {
      i += 1;
      continue;
    }
    const labelEnd = text.indexOf('](', i + 1);
    if (labelEnd < 0) {
      i += 1;
      continue;
    }
    const urlEnd = text.indexOf(')', labelEnd + 2);
    if (urlEnd < 0) {
      i += 1;
      continue;
    }
    const label = text.slice(i + 1, labelEnd);
    const url = text.slice(labelEnd + 2, urlEnd);
    const attachmentId =
      itemNumber != null && itemNumber > 0 ? isAttachmentContentPath(url, itemNumber) : null;
    if (
      attachmentId != null &&
      !label.includes(']') &&
      !label.includes('\n') &&
      !label.includes('\r')
    ) {
      pushText(i);
      segments.push({
        kind: 'file',
        label: label || 'file',
        src: url,
        attachmentId,
      });
      i = urlEnd + 1;
      textStart = i;
      continue;
    }
    const normalizedUrl = normalizeDescriptionLinkUrl(url);
    const normalizedLabel = normalizeDescriptionLinkLabel(label);
    if (normalizedUrl && normalizedLabel && label === normalizedLabel && url === normalizedUrl) {
      pushText(i);
      segments.push({ kind: 'link', label: normalizedLabel, url: normalizedUrl });
      i = urlEnd + 1;
      textStart = i;
      continue;
    }
    i += 1;
  }

  pushText(text.length);
  if (segments.length === 0) {
    return [{ kind: 'text', text }];
  }
  return segments;
}
