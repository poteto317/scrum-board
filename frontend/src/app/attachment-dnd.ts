export const SCRUM_ATTACHMENT_MIME = 'application/x-scrum-attachment';

export type AttachmentDragPayload = {
  itemNumber: number;
  attachmentId: number;
  alt: string;
};

export function encodeAttachmentDragPayload(p: AttachmentDragPayload): string {
  return JSON.stringify({
    itemNumber: p.itemNumber,
    attachmentId: p.attachmentId,
    alt: p.alt ?? '',
  });
}

export function decodeAttachmentDragPayload(raw: string): AttachmentDragPayload | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<AttachmentDragPayload>;
    const itemNumber = Number(v.itemNumber);
    const attachmentId = Number(v.attachmentId);
    if (!Number.isInteger(itemNumber) || itemNumber <= 0) return null;
    if (!Number.isInteger(attachmentId) || attachmentId <= 0) return null;
    return { itemNumber, attachmentId, alt: typeof v.alt === 'string' ? v.alt : '' };
  } catch {
    return null;
  }
}

export function attachmentDragBelongsToItem(
  p: AttachmentDragPayload,
  currentItemNumber: number,
): boolean {
  return p.itemNumber === currentItemNumber && p.attachmentId > 0;
}

/** types にカスタム MIME が含まれるか（getData の空／非空は問わない）。 */
export function dataTransferHasAttachmentMime(types: readonly string[] | DOMStringList): boolean {
  return Array.from(types as ArrayLike<string>).includes(SCRUM_ATTACHMENT_MIME);
}
