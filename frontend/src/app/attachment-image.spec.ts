import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_IMAGE_BATCH_HINT,
  ATTACHMENT_IMAGE_HINT,
  ATTACHMENT_IMAGE_MAX_BYTES,
  imageUploadDoneMessage,
  imageUploadFailureMessage,
  imageUploadPlanNotice,
  isAllowedImageFile,
  planImageUpload,
} from './attachment-image';

function file(name: string, type: string, size = 3): File {
  const f = new File([new Uint8Array([1, 2, 3])], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('isAllowedImageFile', () => {
  it('accepts the four image types up to 5 MiB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
      expect(isAllowedImageFile(file('a', type))).toBe(true);
    }
    expect(isAllowedImageFile(file('a.png', 'image/png', ATTACHMENT_IMAGE_MAX_BYTES))).toBe(true);
  });

  it('rejects other types, empty files, and files over the limit', () => {
    expect(isAllowedImageFile(file('a.pdf', 'application/pdf'))).toBe(false);
    expect(isAllowedImageFile(file('a.svg', 'image/svg+xml'))).toBe(false);
    expect(isAllowedImageFile(file('a.png', 'image/png', 0))).toBe(false);
    expect(isAllowedImageFile(file('a.png', 'image/png', ATTACHMENT_IMAGE_MAX_BYTES + 1))).toBe(
      false,
    );
  });
});

describe('planImageUpload', () => {
  it('keeps allowed images in order and counts the rest', () => {
    const a = file('a.png', 'image/png');
    const b = file('b.pdf', 'application/pdf');
    const c = file('c.jpg', 'image/jpeg');
    const plan = planImageUpload([a, b, c]);
    expect(plan.accepted).toEqual([a, c]);
    expect(plan.rejected).toBe(1);
    expect(plan.overflow).toBe(0);
    expect(imageUploadPlanNotice(plan)).toBe(ATTACHMENT_IMAGE_HINT);
  });

  it('cuts the batch at the limit', () => {
    const files = Array.from({ length: 12 }, (_, i) => file(`${i}.png`, 'image/png'));
    const plan = planImageUpload(files);
    expect(plan.accepted).toEqual(files.slice(0, 10));
    expect(plan.overflow).toBe(2);
    expect(imageUploadPlanNotice(plan)).toBe(ATTACHMENT_IMAGE_BATCH_HINT);
  });

  it('has no notice when every file is accepted', () => {
    expect(imageUploadPlanNotice(planImageUpload([file('a.png', 'image/png')]))).toBe('');
  });
});

describe('imageUploadFailureMessage', () => {
  it('mentions the count only when some images were added', () => {
    expect(imageUploadFailureMessage(0, 3)).toBe('画像のアップロードに失敗しました。');
    expect(imageUploadFailureMessage(2, 3)).toContain('3件中2件');
  });

  it('uses the reason from the server when there is one', () => {
    const error = { error: { message: '添付はアイテムあたり20枚までです。' } };
    expect(imageUploadFailureMessage(0, 3, error)).toBe('添付はアイテムあたり20枚までです。');
    expect(imageUploadFailureMessage(2, 3, error)).toBe(
      '添付はアイテムあたり20枚までです（3件中2件を追加）。',
    );
    expect(imageUploadFailureMessage(0, 1, { error: { message: ' ' } })).toBe(
      '画像のアップロードに失敗しました。',
    );
    expect(imageUploadFailureMessage(0, 1, new Error('x'))).toBe('画像のアップロードに失敗しました。');
  });
});

describe('imageUploadDoneMessage', () => {
  const clean = planImageUpload([file('a.png', 'image/png')]);
  const mixed = planImageUpload([file('a.png', 'image/png'), file('a.pdf', 'application/pdf')]);

  it('prefers the failure, then the stop reason, then the notice about skipped files', () => {
    expect(imageUploadDoneMessage({ added: 0, total: 1, failed: true }, mixed, 'limit')).toBe(
      '画像のアップロードに失敗しました。',
    );
    expect(imageUploadDoneMessage({ added: 0, total: 1, failed: false }, mixed, 'limit')).toBe(
      'limit',
    );
    expect(imageUploadDoneMessage({ added: 1, total: 1, failed: false }, mixed)).toBe(
      ATTACHMENT_IMAGE_HINT,
    );
    expect(imageUploadDoneMessage({ added: 1, total: 1, failed: false }, clean)).toBe('');
  });
});
