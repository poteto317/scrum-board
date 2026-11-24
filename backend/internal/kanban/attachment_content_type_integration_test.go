package kanban

import (
	"bytes"
	"context"
	"io"
	"testing"
)

// The type stored at upload (an allowlisted image type) wins over the blob's; the blob's type is
// only a fallback for an empty stored type (#129).
func TestMySQLOpenAttachmentContentPrefersTheStoredContentType(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	blobs := NewMemoryBlobStorage()
	item, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "with image"})
	if err != nil {
		t.Fatal(err)
	}
	att, err := r.CreateAttachment(ctx, blobs, item.ID, "description", nil, "a.png", "image/png", 0, bytes.NewReader(pngBytes()), nil)
	if err != nil {
		t.Fatal(err)
	}
	key, _, err := r.attachmentObjectKey(ctx, item.ID, att.ID)
	if err != nil {
		t.Fatal(err)
	}
	// The blob claims another type; the row's type wins.
	if err = blobs.Put(ctx, key, bytes.NewReader(pngBytes()), int64(len(pngBytes())), "application/octet-stream"); err != nil {
		t.Fatal(err)
	}
	rc, ct, err := r.OpenAttachmentContent(ctx, blobs, item.ID, att.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, rc)
	rc.Close()
	if ct != "image/png" {
		t.Fatalf("content type = %q; want the stored image/png", ct)
	}
	// An empty stored type falls back to the blob's.
	if _, err = db.ExecContext(ctx, "UPDATE item_attachments SET content_type='' WHERE id=?", att.ID); err != nil {
		t.Fatal(err)
	}
	rc, ct, err = r.OpenAttachmentContent(ctx, blobs, item.ID, att.ID)
	if err != nil {
		t.Fatal(err)
	}
	rc.Close()
	if ct != "application/octet-stream" {
		t.Fatalf("content type = %q; want the blob's fallback", ct)
	}
	// GetAttachment answers only for the attachment's own item.
	if _, err = r.GetAttachment(ctx, item.ID+1000, att.ID); err == nil {
		t.Fatal("GetAttachment for another item must fail")
	}
}
