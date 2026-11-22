package kanban

import (
	"bytes"
	"context"
	"io"
	"strings"
	"time"
)

type memoryAttachment struct {
	Attachment
	objectKey string
}

func sumProjectAttachmentBytes(m *memoryRepo, projectID int64) int64 {
	var sum int64
	for _, a := range m.attachments {
		card, ok := m.cards[a.ItemID]
		if !ok || !m.living(card) || m.cardProjectID(card) != projectID {
			continue
		}
		sum += a.ByteSize
	}
	return sum
}

func (m *memoryRepo) ensureAttachments() {
	if m.attachments == nil {
		m.attachments = map[int64]memoryAttachment{}
	}
	if m.nextAttachmentID == 0 {
		m.nextAttachmentID = 1
	}
}

func (m *memoryRepo) ListAttachments(_ context.Context, itemID int64) ([]Attachment, error) {
	m.ensureAttachments()
	var out []Attachment
	for _, a := range m.attachments {
		if a.ItemID == itemID {
			out = append(out, a.Attachment)
		}
	}
	return out, nil
}

func (m *memoryRepo) CreateAttachment(
	ctx context.Context,
	blobs BlobStorage,
	itemID int64,
	field string,
	commentID *int64,
	name, contentType string,
	_ int64,
	body io.Reader,
	_ *int64,
) (Attachment, error) {
	if blobs == nil {
		return Attachment{}, ErrBlobStorageUnavailable
	}
	field, err := normalizeAttachmentField(field)
	if err != nil {
		return Attachment{}, err
	}
	data, err := io.ReadAll(io.LimitReader(body, attachmentMaxBytes+1))
	if err != nil {
		return Attachment{}, err
	}
	if len(data) == 0 || int64(len(data)) > attachmentMaxBytes {
		return Attachment{}, ErrAttachmentInvalid
	}
	contentType = strings.ToLower(strings.TrimSpace(contentType))
	if i := strings.Index(contentType, ";"); i >= 0 {
		contentType = strings.TrimSpace(contentType[:i])
	}
	if err := validateAttachmentMIME(contentType, data); err != nil {
		return Attachment{}, err
	}
	m.ensureAttachments()
	count := 0
	for _, a := range m.attachments {
		if a.ItemID == itemID {
			count++
		}
	}
	if count >= attachmentMaxCount {
		return Attachment{}, ErrAttachmentLimit
	}
	card, ok := m.cards[itemID]
	if !ok {
		return Attachment{}, ErrNotFound
	}
	projectID := m.cardProjectID(card)
	if sumProjectAttachmentBytes(m, projectID)+int64(len(data)) > attachmentMaxProjectBytes {
		return Attachment{}, ErrAttachmentQuota
	}
	if commentID != nil {
		c, ok := m.comments[*commentID]
		if !ok || c.ItemID != itemID {
			return Attachment{}, ErrAttachmentInvalid
		}
	}
	id := m.nextAttachmentID
	m.nextAttachmentID++
	key := attachmentObjectKey(itemID, id)
	if err := blobs.Put(ctx, key, bytes.NewReader(data), int64(len(data)), contentType); err != nil {
		return Attachment{}, err
	}
	a := Attachment{
		ID:           id,
		ItemID:       itemID,
		CommentID:    commentID,
		Field:        field,
		ContentType:  contentType,
		ByteSize:     int64(len(data)),
		OriginalName: sanitizeAttachmentAlt(name),
		CreatedAt:    time.Now().UTC(),
	}
	m.attachments[id] = memoryAttachment{Attachment: a, objectKey: key}
	return a, nil
}

func (m *memoryRepo) OpenAttachmentContent(ctx context.Context, blobs BlobStorage, itemID, id int64) (io.ReadCloser, string, error) {
	m.ensureAttachments()
	a, ok := m.attachments[id]
	if !ok || a.ItemID != itemID {
		return nil, "", ErrNotFound
	}
	if blobs == nil {
		return nil, "", ErrBlobStorageUnavailable
	}
	return blobs.Get(ctx, a.objectKey)
}

func (m *memoryRepo) DeleteAttachment(ctx context.Context, blobs BlobStorage, itemID, attachmentID, itemNumber int64) error {
	m.ensureAttachments()
	a, ok := m.attachments[attachmentID]
	if !ok || a.ItemID != itemID {
		return ErrNotFound
	}
	card, ok := m.cards[itemID]
	if ok {
		card.Description = stripAttachmentMarkup(card.Description, itemNumber, attachmentID)
		card.Solution = stripAttachmentMarkup(card.Solution, itemNumber, attachmentID)
		m.cards[itemID] = card
	}
	for cid, c := range m.comments {
		if c.ItemID == itemID {
			c.Body = stripAttachmentMarkup(c.Body, itemNumber, attachmentID)
			m.comments[cid] = c
		}
	}
	delete(m.attachments, attachmentID)
	if blobs != nil {
		_ = blobs.Delete(ctx, a.objectKey)
	}
	return nil
}

func (m *memoryRepo) ListAttachmentObjectKeysByItemID(_ context.Context, itemID int64) ([]string, error) {
	m.ensureAttachments()
	var keys []string
	for _, a := range m.attachments {
		if a.ItemID == itemID {
			keys = append(keys, a.objectKey)
		}
	}
	return keys, nil
}

func (m *memoryRepo) ListAttachmentObjectKeysByCommentID(_ context.Context, commentID int64) ([]string, error) {
	m.ensureAttachments()
	var keys []string
	for _, a := range m.attachments {
		if a.CommentID != nil && *a.CommentID == commentID {
			keys = append(keys, a.objectKey)
		}
	}
	return keys, nil
}

func (m *memoryRepo) AttachmentObjectKeyExists(_ context.Context, objectKey string) (bool, error) {
	m.ensureAttachments()
	for _, a := range m.attachments {
		if a.objectKey == objectKey {
			return true, nil
		}
	}
	return false, nil
}

func (m *memoryRepo) ListAttachmentObjectKeysForExpiredTrash(_ context.Context, projectID int64) ([]string, error) {
	m.ensureAttachments()
	cutoff := trashCutoff(time.Now().UTC())
	var keys []string
	for _, a := range m.attachments {
		card, ok := m.cards[a.ItemID]
		if !ok || card.DeletedAt == nil {
			continue
		}
		if projectID > 0 && card.ProjectID != projectID {
			continue
		}
		if !card.DeletedAt.After(cutoff) {
			keys = append(keys, a.objectKey)
		}
	}
	return keys, nil
}
