import {
  formatDescriptionLink,
  insertMarkupAt,
  normalizeDescriptionLinkUrl,
} from './description-link';

/** DataTransfer（貼り付け・ドロップ）に入っているファイル。無ければ空。 */
export function filesFromDataTransfer(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  const files = Array.from(dt.files ?? []);
  if (files.length) return files;
  const fromItems: File[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) fromItems.push(file);
  }
  return fromItems;
}

/**
 * 貼り付けを添付の追加として扱うなら、そのファイルを返す（種類は見ない。選別は `planImageUpload`）。
 * ファイルと一緒に、テキストと HTML の両方が入っている（表計算・文書ソフトのコピー）ときは、
 * テキストの貼り付けを優先する。ファイル名や画像の URL だけがテキストに入っている
 * （ファイルのコピー、ブラウザの「画像をコピー」）ときは、画像として扱う。
 */
export function clipboardFilesToAttach(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  const files = filesFromDataTransfer(dt);
  if (!files.length) return [];
  const hasText = dt.getData('text/plain').trim() !== '';
  const hasHtml = Array.from((dt.types ?? []) as ArrayLike<string>).includes('text/html');
  if (hasText && hasHtml) return [];
  return files;
}

export type PasteLinkResult =
  | { kind: 'default' }
  | { kind: 'error' }
  | { kind: 'ok'; text: string; caret: number };

/**
 * 選択した文字に https の URL を貼り付けたとき、選択を `[選択](URL)` に置き換える。
 * 選択が無い・URL でない・表示名にできない選択のときは `default`（通常の貼り付け）。
 * 置き換えで上限を超えるときは `error`。
 */
export function pasteLinkOverSelection(
  body: string,
  start: number,
  end: number,
  pasted: string,
  maxLen: number,
): PasteLinkResult {
  const from = Math.max(0, Math.min(start, end, body.length));
  const to = Math.max(0, Math.min(Math.max(start, end), body.length));
  if (from === to) return { kind: 'default' };
  const selected = body.slice(from, to);
  // URL を選んで URL を貼るのは「置き換え」。既存のリンク・画像の記法に重なる選択も、記法を壊すので触らない。
  if (normalizeDescriptionLinkUrl(selected)) return { kind: 'default' };
  if (overlapsLinkMarkup(body, from, to)) return { kind: 'default' };
  const markup = formatDescriptionLink(selected, pasted);
  if (!markup) return { kind: 'default' };
  // 表示名は前後の空白を落とすので、選択に含まれていた空白はリンクの外に残す。
  const lead = selected.slice(0, selected.length - selected.trimStart().length);
  const trail = selected.slice(selected.trimEnd().length);
  const inserted = insertMarkupAt(body, from, to, lead + markup + trail, maxLen);
  if (!inserted) return { kind: 'error' };
  return { kind: 'ok', text: inserted.text, caret: inserted.caret - trail.length };
}

/** `start..end` が、既存の `[..](..)` / `![..](..)` に重なる、または `!` の直後から始まるか。 */
function overlapsLinkMarkup(body: string, start: number, end: number): boolean {
  if (start > 0 && body[start - 1] === '!') return true;
  for (const m of body.matchAll(/!?\[[^\]\n]*\]\([^)\n]*\)/g)) {
    const from = m.index;
    const to = from + m[0].length;
    if (start < to && end > from) return true;
  }
  return false;
}
