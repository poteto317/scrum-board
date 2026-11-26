/** 添付ファイルの規則（種類・サイズ・件数）と、利用者に出す文言。貼り付け・ドロップ・ファイル選択で共有する。 */

import type { ImageUploadOutcome } from './upload-images-in-order';

/** 画像としてインライン表示する種類（サーバーの画像許可集合と同じ）。 */
const ATTACHMENT_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

/** アップロード許可（画像 + PDF）。画像集合から導出する。 */
const ATTACHMENT_FILE_TYPES: ReadonlySet<string> = new Set([
  ...ATTACHMENT_IMAGE_TYPES,
  'application/pdf',
]);

/** ファイル選択の `accept` に渡す並び。 */
export const ATTACHMENT_IMAGE_ACCEPT = [...ATTACHMENT_FILE_TYPES].join(',');
export const ATTACHMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** 1 回の貼り付け・ドロップ・選択で追加できる添付の数。 */
const ATTACHMENT_IMAGE_BATCH_MAX = 10;

export const ATTACHMENT_IMAGE_HINT = 'JPEG / PNG / GIF / WebP / PDF（5MiB以下）を選んでください。';
export const ATTACHMENT_IMAGE_BATCH_HINT = `一度に追加できる添付は${ATTACHMENT_IMAGE_BATCH_MAX}件までです。`;
/** アップロード・削除のどちらかが進んでいる間に、次の添付が来たとき。 */
export const ATTACHMENT_IMAGE_BUSY_HINT = '添付の処理中です。終わってから追加してください。';

export function isImageAttachmentType(contentType: string): boolean {
  return ATTACHMENT_IMAGE_TYPES.has(contentType);
}

/** アップロード結果の Content-Type から本文記法の種別を決める。 */
export function attachmentMarkupKind(contentType: string): 'image' | 'file' {
  return isImageAttachmentType(contentType) ? 'image' : 'file';
}

/** 添付として許可するファイルか（関数名は互換のため image のまま）。 */
export function isAllowedImageFile(file: File): boolean {
  return (
    ATTACHMENT_FILE_TYPES.has(file.type) &&
    file.size > 0 &&
    file.size <= ATTACHMENT_IMAGE_MAX_BYTES
  );
}

export type ImageUploadPlan = {
  /** アップロードする添付（先頭から上限まで）。 */
  accepted: File[];
  /** 種類・サイズが合わずに外した数。 */
  rejected: number;
  /** 上限を超えたために外した数。 */
  overflow: number;
};

export function planImageUpload(
  files: readonly File[],
  max: number = ATTACHMENT_IMAGE_BATCH_MAX,
): ImageUploadPlan {
  const allowed = files.filter(isAllowedImageFile);
  const accepted = allowed.slice(0, Math.max(0, max));
  return {
    accepted,
    rejected: files.length - allowed.length,
    overflow: allowed.length - accepted.length,
  };
}

/** 外したファイルがあるときに出す文言。無ければ空文字。 */
export function imageUploadPlanNotice(plan: ImageUploadPlan): string {
  if (plan.rejected > 0) return ATTACHMENT_IMAGE_HINT;
  if (plan.overflow > 0) return ATTACHMENT_IMAGE_BATCH_HINT;
  return '';
}

/**
 * 失敗したときの文言。サーバーが理由（枚数・容量の上限など）を返していればそれを使い、
 * 途中まで入っていれば、その件数も伝える。
 */
export function imageUploadFailureMessage(added: number, total: number, error?: unknown): string {
  const reason = (error as { error?: { message?: unknown } } | null | undefined)?.error?.message;
  const base =
    typeof reason === 'string' && reason.trim() !== ''
      ? reason.trim().replace(/。$/, '')
      : '添付のアップロードに失敗しました';
  return added > 0 ? `${base}（${total}件中${added}件を追加）。` : `${base}。`;
}

/**
 * アップロードが終わったときに出す文言（無ければ空文字）。
 * 失敗 → 途中で止めた理由（上限など）→ 外したファイルの案内、の順に選ぶ。
 */
export function imageUploadDoneMessage(
  outcome: ImageUploadOutcome,
  plan: ImageUploadPlan,
  stopReason = '',
): string {
  if (outcome.failed) return imageUploadFailureMessage(outcome.added, outcome.total, outcome.error);
  return stopReason || imageUploadPlanNotice(plan);
}
