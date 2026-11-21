export type DescriptionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; label: string; url: string }
  | { kind: 'image'; alt: string; src: string; attachmentId: number };

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

export function sanitizeAttachmentAlt(name: string): string {
  let text = name.replace(/]/g, '').replace(/[\r\n]/g, '').trim();
  if (!text) text = 'image';
  if ([...text].length > 200) text = [...text].slice(0, 200).join('');
  return text;
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
): string {
  return `![${sanitizeAttachmentAlt(alt)}](${attachmentContentPath(itemNumber, attachmentId)})`;
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
 * Image markdown `![alt](path)` is recognized before normal links; only same-item
 * attachment content paths become images. External image URLs stay as text.
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
      const path = text.slice(labelEnd + 2, urlEnd);
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
