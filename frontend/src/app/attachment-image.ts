/** 添付画像の規則（種類・サイズ・件数）と、利用者に出す文言。貼り付け・ドロップ・ファイル選択で共有する。 */

import type { ImageUploadOutcome } from './upload-images-in-order';

/** 添付できる画像の種類（サーバーの許可リストと同じ）。 */
export const ATTACHMENT_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);
export const ATTACHMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** 1 回の貼り付け・ドロップ・選択で追加できる画像の数。 */
export const ATTACHMENT_IMAGE_BATCH_MAX = 10;

export const ATTACHMENT_IMAGE_HINT = 'JPEG / PNG / GIF / WebP（5MiB以下）を選んでください。';
export const ATTACHMENT_IMAGE_BATCH_HINT = `一度に追加できる画像は${ATTACHMENT_IMAGE_BATCH_MAX}件までです。`;
/** アップロード・削除のどちらかが進んでいる間に、次の画像が来たとき。 */
export const ATTACHMENT_IMAGE_BUSY_HINT = '画像の処理中です。終わってから追加してください。';

export function isAllowedImageFile(file: File): boolean {
  return (
    ATTACHMENT_IMAGE_TYPES.has(file.type) &&
    file.size > 0 &&
    file.size <= ATTACHMENT_IMAGE_MAX_BYTES
  );
}

export type ImageUploadPlan = {
  /** アップロードする画像（先頭から上限まで）。 */
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
      : '画像のアップロードに失敗しました';
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
