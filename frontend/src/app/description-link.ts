export type DescriptionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; label: string; url: string };

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
  const from = Math.max(0, Math.min(start, end, text.length));
  const to = Math.max(0, Math.min(Math.max(start, end), text.length));
  const next = text.slice(0, from) + markdown + text.slice(to);
  if ([...next].length > maxLen) return null;
  return { text: next, caret: from + markdown.length };
}

export function parseDescriptionLinks(text: string): DescriptionSegment[] {
  const segments: DescriptionSegment[] = [];
  let i = 0;
  let textStart = 0;

  const pushText = (end: number) => {
    if (end > textStart) {
      segments.push({ kind: 'text', text: text.slice(textStart, end) });
    }
  };

  while (i < text.length) {
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
