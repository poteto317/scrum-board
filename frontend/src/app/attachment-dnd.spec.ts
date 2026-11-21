import { describe, expect, it } from 'vitest';
import {
  SCRUM_ATTACHMENT_MIME,
  attachmentDragBelongsToItem,
  dataTransferHasAttachmentMime,
  decodeAttachmentDragPayload,
  encodeAttachmentDragPayload,
} from './attachment-dnd';

describe('attachment-dnd', () => {
  it('encodes and decodes round-trip', () => {
    const raw = encodeAttachmentDragPayload({ itemNumber: 7, attachmentId: 3, alt: 'a' });
    expect(decodeAttachmentDragPayload(raw)).toEqual({
      itemNumber: 7,
      attachmentId: 3,
      alt: 'a',
    });
  });

  it('rejects bad json / non-positive ids / wrong item', () => {
    expect(decodeAttachmentDragPayload('')).toBeNull();
    expect(decodeAttachmentDragPayload('{')).toBeNull();
    expect(
      attachmentDragBelongsToItem({ itemNumber: 1, attachmentId: 2, alt: 'x' }, 9),
    ).toBe(false);
    expect(
      attachmentDragBelongsToItem({ itemNumber: 9, attachmentId: 0, alt: 'x' }, 9),
    ).toBe(false);
    expect(
      attachmentDragBelongsToItem({ itemNumber: 9, attachmentId: 2, alt: 'x' }, 9),
    ).toBe(true);
  });

  it('exports MIME constant and detects types membership', () => {
    expect(SCRUM_ATTACHMENT_MIME).toBe('application/x-scrum-attachment');
    expect(dataTransferHasAttachmentMime([SCRUM_ATTACHMENT_MIME, 'Files'])).toBe(true);
    expect(dataTransferHasAttachmentMime(['Files'])).toBe(false);
  });
});
