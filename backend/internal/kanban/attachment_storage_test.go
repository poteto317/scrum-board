package kanban

import (
	"bytes"
	"context"
	"errors"
	"io"
	"testing"
)

func TestMemoryBlobStoragePutGetDelete(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryBlobStorage()
	body := []byte("hello-png-bytes")
	if err := store.Put(ctx, "items/1/attachments/2", bytes.NewReader(body), int64(len(body)), "image/png"); err != nil {
		t.Fatal(err)
	}
	rc, ct, err := store.Get(ctx, "items/1/attachments/2")
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	got, err := io.ReadAll(rc)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(body) || ct != "image/png" {
		t.Fatalf("got %q ct=%q", got, ct)
	}
	if err := store.Delete(ctx, "items/1/attachments/2"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.Get(ctx, "items/1/attachments/2"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound got %v", err)
	}
}

func TestUnavailableBlobStoragePut(t *testing.T) {
	err := UnavailableBlobStorage{}.Put(context.Background(), "k", bytes.NewReader(nil), 0, "image/png")
	if !errors.Is(err, ErrBlobStorageUnavailable) {
		t.Fatalf("got %v", err)
	}
}

// The GCS writer buffers one chunk in memory; the default is 16 MiB for a 5 MiB limit (#129).
func TestAttachmentUploadChunkSizeIsSmallAndAligned(t *testing.T) {
	const gcsChunkMultiple = 256 * 1024
	if attachmentUploadChunkSize%gcsChunkMultiple != 0 {
		t.Fatalf("chunk size %d must be a multiple of 256 KiB", attachmentUploadChunkSize)
	}
	if attachmentUploadChunkSize <= 0 || attachmentUploadChunkSize >= 16*1024*1024 {
		t.Fatalf("chunk size %d must be below the 16 MiB default", attachmentUploadChunkSize)
	}
}
