package kanban

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	attachmentMaxBytes      = 5 << 20 // 5 MiB
	attachmentMaxCount      = 20
	attachmentMaxName       = 200
	attachmentMaxConcurrent = 4
)

// attachmentMaxProjectBytes is the total stored bytes allowed per project (tests may adjust).
var attachmentMaxProjectBytes int64 = 100 << 20 // 100 MiB

var (
	ErrAttachmentLimit   = errors.New("attachment limit")
	ErrAttachmentInvalid = errors.New("attachment invalid")
	ErrAttachmentQuota   = errors.New("attachment project quota")
)

// Attachment is the JSON meta for an uploaded image.
type Attachment struct {
	ID           int64     `json:"id"`
	ItemID       int64     `json:"itemId"`
	CommentID    *int64    `json:"commentId,omitempty"`
	Field        string    `json:"field"`
	ContentType  string    `json:"contentType"`
	ByteSize     int64     `json:"byteSize"`
	OriginalName string    `json:"originalName"`
	CreatedAt    time.Time `json:"createdAt"`
}

var allowedAttachmentMIME = map[string]struct{}{
	"image/jpeg": {},
	"image/png":  {},
	"image/gif":  {},
	"image/webp": {},
}

func sanitizeAttachmentAlt(name string) string {
	name = strings.ReplaceAll(name, "]", "")
	name = strings.ReplaceAll(name, "\n", "")
	name = strings.ReplaceAll(name, "\r", "")
	name = strings.TrimSpace(name)
	if name == "" {
		return "image"
	}
	if utf8.RuneCountInString(name) > attachmentMaxName {
		runes := []rune(name)
		name = string(runes[:attachmentMaxName])
	}
	return name
}

func attachmentObjectKey(itemID, attachmentID int64) string {
	return fmt.Sprintf("items/%d/attachments/%d", itemID, attachmentID)
}

func pendingObjectKey() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return "pending/" + hex.EncodeToString(b[:])
}

func stripAttachmentMarkup(text string, itemNumber, attachmentID int64) string {
	path := AttachmentContentPath(itemNumber, attachmentID)
	// Replace only markups that reference this attachment id (path is unique per id).
	needle := "](" + path + ")"
	var b strings.Builder
	rest := text
	for {
		idx := strings.Index(rest, needle)
		if idx < 0 {
			b.WriteString(rest)
			break
		}
		// Walk back to '![' for this image markdown.
		start := strings.LastIndex(rest[:idx], "![")
		if start < 0 || strings.Contains(rest[start:idx], "\n") {
			b.WriteString(rest[:idx+len(needle)])
			rest = rest[idx+len(needle):]
			continue
		}
		b.WriteString(rest[:start])
		rest = rest[idx+len(needle):]
	}
	return b.String()
}

func detectImageMIME(header []byte) string {
	if len(header) >= 3 && header[0] == 0xff && header[1] == 0xd8 && header[2] == 0xff {
		return "image/jpeg"
	}
	if len(header) >= 8 && bytes.Equal(header[:8], []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}) {
		return "image/png"
	}
	if len(header) >= 6 && (bytes.Equal(header[:6], []byte("GIF87a")) || bytes.Equal(header[:6], []byte("GIF89a"))) {
		return "image/gif"
	}
	if len(header) >= 12 && bytes.Equal(header[:4], []byte("RIFF")) && bytes.Equal(header[8:12], []byte("WEBP")) {
		return "image/webp"
	}
	return ""
}

func validateAttachmentMIME(declared string, magic []byte) error {
	declared = strings.TrimSpace(strings.ToLower(declared))
	if _, ok := allowedAttachmentMIME[declared]; !ok {
		return ErrAttachmentInvalid
	}
	got := detectImageMIME(magic)
	if got == "" || got != declared {
		return ErrAttachmentInvalid
	}
	return nil
}

func normalizeAttachmentField(field string) (string, error) {
	switch field {
	case "description", "solution", "comment":
		return field, nil
	default:
		return "", ErrAttachmentInvalid
	}
}

// CreateAttachment inserts a row, puts the blob, and compensates on Put failure.
func (r MySQLRepository) CreateAttachment(
	ctx context.Context,
	blobs BlobStorage,
	itemID int64,
	field string,
	commentID *int64,
	name, contentType string,
	size int64,
	body io.Reader,
	userID *int64,
) (Attachment, error) {
	if blobs == nil {
		return Attachment{}, ErrBlobStorageUnavailable
	}
	field, err := normalizeAttachmentField(field)
	if err != nil {
		return Attachment{}, err
	}
	name = sanitizeAttachmentAlt(name)
	contentType = strings.TrimSpace(strings.ToLower(contentType))

	// Ignore client-declared size; enforce max by reading at most max+1 bytes.
	data, err := io.ReadAll(io.LimitReader(body, attachmentMaxBytes+1))
	if err != nil {
		return Attachment{}, err
	}
	if len(data) == 0 || int64(len(data)) > attachmentMaxBytes {
		return Attachment{}, ErrAttachmentInvalid
	}
	size = int64(len(data))
	if err := validateAttachmentMIME(contentType, data); err != nil {
		return Attachment{}, err
	}

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Attachment{}, err
	}
	defer tx.Rollback()

	// Serialize attachment inserts per item (count check vs concurrent POSTs).
	var lockedItem, projectID int64
	if err = tx.QueryRowContext(ctx, `SELECT id, project_id FROM items
WHERE id=? AND deleted_at IS NULL AND archived_at IS NULL FOR UPDATE`, itemID).Scan(&lockedItem, &projectID); err != nil {
		return Attachment{}, dbError(err)
	}
	var projectBytes int64
	if err = tx.QueryRowContext(ctx, `
SELECT COALESCE(SUM(a.byte_size), 0)
  FROM item_attachments a
  INNER JOIN items i ON i.id = a.item_id
 WHERE i.project_id = ? AND i.deleted_at IS NULL`, projectID).Scan(&projectBytes); err != nil {
		return Attachment{}, err
	}
	if projectBytes+size > attachmentMaxProjectBytes {
		return Attachment{}, ErrAttachmentQuota
	}
	if commentID != nil {
		var commentItem int64
		err = tx.QueryRowContext(ctx, `SELECT item_id FROM item_comments WHERE id=? FOR UPDATE`, *commentID).Scan(&commentItem)
		if err != nil {
			return Attachment{}, dbError(err)
		}
		if commentItem != itemID {
			return Attachment{}, ErrAttachmentInvalid
		}
	}

	var count int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM item_attachments WHERE item_id=?`, itemID).Scan(&count); err != nil {
		return Attachment{}, err
	}
	if count >= attachmentMaxCount {
		return Attachment{}, ErrAttachmentLimit
	}

	pending := pendingObjectKey()
	res, err := tx.ExecContext(ctx, `
INSERT INTO item_attachments(item_id, comment_id, field, object_key, content_type, byte_size, original_name, created_by_user_id)
VALUES (?,?,?,?,?,?,?,?)`,
		itemID, commentID, field, pending, contentType, size, name, userID)
	if err != nil {
		return Attachment{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Attachment{}, err
	}
	finalKey := attachmentObjectKey(itemID, id)
	if _, err = tx.ExecContext(ctx, `UPDATE item_attachments SET object_key=? WHERE id=?`, finalKey, id); err != nil {
		return Attachment{}, err
	}
	if err = tx.Commit(); err != nil {
		return Attachment{}, err
	}

	if err = blobs.Put(ctx, finalKey, bytes.NewReader(data), size, contentType); err != nil {
		_, _ = r.DB.ExecContext(ctx, `DELETE FROM item_attachments WHERE id=?`, id)
		if errors.Is(err, ErrBlobStorageUnavailable) {
			return Attachment{}, err
		}
		return Attachment{}, fmt.Errorf("put blob: %w", err)
	}

	return r.getAttachment(ctx, itemID, id)
}

func (r MySQLRepository) getAttachment(ctx context.Context, itemID, id int64) (Attachment, error) {
	var a Attachment
	var commentID sql.NullInt64
	var created time.Time
	err := r.DB.QueryRowContext(ctx, `
SELECT id, item_id, comment_id, field, content_type, byte_size, original_name, created_at
  FROM item_attachments WHERE id=? AND item_id=?`, id, itemID).
		Scan(&a.ID, &a.ItemID, &commentID, &a.Field, &a.ContentType, &a.ByteSize, &a.OriginalName, &created)
	if err != nil {
		return Attachment{}, dbError(err)
	}
	if commentID.Valid {
		v := commentID.Int64
		a.CommentID = &v
	}
	a.CreatedAt = created.UTC()
	return a, nil
}

func (r MySQLRepository) ListAttachments(ctx context.Context, itemID int64) ([]Attachment, error) {
	rows, err := r.DB.QueryContext(ctx, `
SELECT id, item_id, comment_id, field, content_type, byte_size, original_name, created_at
  FROM item_attachments WHERE item_id=? ORDER BY id`, itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Attachment
	for rows.Next() {
		var a Attachment
		var commentID sql.NullInt64
		var created time.Time
		if err = rows.Scan(&a.ID, &a.ItemID, &commentID, &a.Field, &a.ContentType, &a.ByteSize, &a.OriginalName, &created); err != nil {
			return nil, err
		}
		if commentID.Valid {
			v := commentID.Int64
			a.CommentID = &v
		}
		a.CreatedAt = created.UTC()
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r MySQLRepository) attachmentObjectKey(ctx context.Context, itemID, id int64) (string, string, error) {
	var key, contentType string
	err := r.DB.QueryRowContext(ctx, `
SELECT object_key, content_type FROM item_attachments WHERE id=? AND item_id=?`, id, itemID).
		Scan(&key, &contentType)
	if err != nil {
		return "", "", dbError(err)
	}
	return key, contentType, nil
}

func (r MySQLRepository) OpenAttachmentContent(ctx context.Context, blobs BlobStorage, itemID, id int64) (io.ReadCloser, string, error) {
	if blobs == nil {
		return nil, "", ErrBlobStorageUnavailable
	}
	key, contentType, err := r.attachmentObjectKey(ctx, itemID, id)
	if err != nil {
		return nil, "", err
	}
	rc, ct, err := blobs.Get(ctx, key)
	if err != nil {
		return nil, "", err
	}
	if ct == "" {
		ct = contentType
	}
	return rc, ct, nil
}

func (r MySQLRepository) ListAttachmentObjectKeysByItemID(ctx context.Context, itemID int64) ([]string, error) {
	return r.listAttachmentKeys(ctx, `SELECT object_key FROM item_attachments WHERE item_id=?`, itemID)
}

func (r MySQLRepository) ListAttachmentObjectKeysByCommentID(ctx context.Context, commentID int64) ([]string, error) {
	return r.listAttachmentKeys(ctx, `SELECT object_key FROM item_attachments WHERE comment_id=?`, commentID)
}

func (r MySQLRepository) AttachmentObjectKeyExists(ctx context.Context, objectKey string) (bool, error) {
	var n int
	err := r.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM item_attachments WHERE object_key=?`, objectKey).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

func (r MySQLRepository) listAttachmentKeys(ctx context.Context, query string, args ...any) ([]string, error) {
	rows, err := r.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var key string
		if err = rows.Scan(&key); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

// ListAttachmentObjectKeysForExpiredTrash matches purgeExpired candidate items.
func (r MySQLRepository) ListAttachmentObjectKeysForExpiredTrash(ctx context.Context, projectID int64) ([]string, error) {
	cutoff := trashCutoff(time.Now().UTC())
	var rows *sql.Rows
	var err error
	if projectID > 0 {
		rows, err = r.DB.QueryContext(ctx, `
SELECT a.object_key FROM item_attachments a
 INNER JOIN items i ON i.id=a.item_id
 WHERE i.project_id=? AND i.deleted_at IS NOT NULL AND i.deleted_at<=?`, projectID, cutoff)
	} else {
		rows, err = r.DB.QueryContext(ctx, `
SELECT a.object_key FROM item_attachments a
 INNER JOIN items i ON i.id=a.item_id
 WHERE i.deleted_at IS NOT NULL AND i.deleted_at<=?`, cutoff)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var key string
		if err = rows.Scan(&key); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

// DeleteAttachment strips markup, removes the DB row (one TX), then best-effort deletes the blob.
func (r MySQLRepository) DeleteAttachment(ctx context.Context, blobs BlobStorage, itemID, attachmentID, itemNumber int64) error {
	key, _, err := r.attachmentObjectKey(ctx, itemID, attachmentID)
	if err != nil {
		return err
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = ensureActiveItemForWrite(ctx, tx, itemID); err != nil {
		return err
	}
	if err = r.stripAttachmentFromBodiesTx(ctx, tx, itemID, itemNumber, attachmentID); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM item_attachments WHERE id=? AND item_id=?`, attachmentID, itemID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	if blobs != nil {
		if delErr := blobs.Delete(ctx, key); delErr != nil {
			slog.Error("attachment blob delete after DB remove", "key", key, "error", delErr)
		}
	}
	return nil
}

type dbQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func (r MySQLRepository) stripAttachmentFromBodiesTx(ctx context.Context, db dbQuerier, itemID, itemNumber, attachmentID int64) error {
	var description, solution string
	err := db.QueryRowContext(ctx, `SELECT description, COALESCE(solution,'') FROM items WHERE id=? FOR UPDATE`, itemID).
		Scan(&description, &solution)
	if err != nil {
		return dbError(err)
	}
	nextDesc := stripAttachmentMarkup(description, itemNumber, attachmentID)
	nextSol := stripAttachmentMarkup(solution, itemNumber, attachmentID)
	if nextDesc != description || nextSol != solution {
		if _, err = db.ExecContext(ctx, `UPDATE items SET description=?, solution=? WHERE id=?`, nextDesc, nextSol, itemID); err != nil {
			return err
		}
	}
	rows, err := db.QueryContext(ctx, `SELECT id, body FROM item_comments WHERE item_id=? FOR UPDATE`, itemID)
	if err != nil {
		return err
	}
	defer rows.Close()
	type row struct {
		id   int64
		body string
	}
	var list []row
	for rows.Next() {
		var rr row
		if err = rows.Scan(&rr.id, &rr.body); err != nil {
			return err
		}
		list = append(list, rr)
	}
	if err = rows.Err(); err != nil {
		return err
	}
	for _, rr := range list {
		next := stripAttachmentMarkup(rr.body, itemNumber, attachmentID)
		if next == rr.body {
			continue
		}
		if _, err = db.ExecContext(ctx, `UPDATE item_comments SET body=? WHERE id=?`, next, rr.id); err != nil {
			return err
		}
	}
	return nil
}

// Attachment path helpers for tests / FE contract.
func AttachmentContentPath(itemNumber, attachmentID int64) string {
	return "/api/items/by-number/" + strconv.FormatInt(itemNumber, 10) + "/attachments/" + strconv.FormatInt(attachmentID, 10) + "/content"
}

func BuildAttachmentMarkup(itemNumber, attachmentID int64, alt string) string {
	return "![" + sanitizeAttachmentAlt(alt) + "](" + AttachmentContentPath(itemNumber, attachmentID) + ")"
}
