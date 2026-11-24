package kanban

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"sync"
	"time"

	"cloud.google.com/go/storage"
)

// ErrBlobStorageUnavailable means ATTACHMENT_GCS_BUCKET is unset or the client cannot store.
var ErrBlobStorageUnavailable = errors.New("attachment storage unavailable")

// BlobStorage stores attachment bytes (GCS in production, memory in tests).
type BlobStorage interface {
	Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error
	Get(ctx context.Context, key string) (io.ReadCloser, string, error)
	Delete(ctx context.Context, key string) error
}

// MemoryBlobStorage is an in-process fake for tests and local without GCS.
type MemoryBlobStorage struct {
	mu   sync.Mutex
	data map[string]memoryBlob
}

type memoryBlob struct {
	body        []byte
	contentType string
}

func NewMemoryBlobStorage() *MemoryBlobStorage {
	return &MemoryBlobStorage{data: map[string]memoryBlob{}}
}

func (m *MemoryBlobStorage) Put(_ context.Context, key string, r io.Reader, size int64, contentType string) error {
	if key == "" {
		return fmt.Errorf("empty object key")
	}
	body, err := io.ReadAll(io.LimitReader(r, size+1))
	if err != nil {
		return err
	}
	if int64(len(body)) != size {
		return fmt.Errorf("size mismatch: got %d want %d", len(body), size)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.data[key] = memoryBlob{body: append([]byte(nil), body...), contentType: contentType}
	return nil
}

func (m *MemoryBlobStorage) Get(_ context.Context, key string) (io.ReadCloser, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	b, ok := m.data[key]
	if !ok {
		return nil, "", ErrNotFound
	}
	return io.NopCloser(newBytesReader(b.body)), b.contentType, nil
}

func (m *MemoryBlobStorage) Delete(_ context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.data, key)
	return nil
}

type bytesReader struct {
	b []byte
	i int
}

func newBytesReader(b []byte) *bytesReader { return &bytesReader{b: b} }

func (r *bytesReader) Read(p []byte) (int, error) {
	if r.i >= len(r.b) {
		return 0, io.EOF
	}
	n := copy(p, r.b[r.i:])
	r.i += n
	return n, nil
}

// UnavailableBlobStorage rejects all Puts (used when ATTACHMENT_GCS_BUCKET is empty).
type UnavailableBlobStorage struct{}

func (UnavailableBlobStorage) Put(context.Context, string, io.Reader, int64, string) error {
	return ErrBlobStorageUnavailable
}
func (UnavailableBlobStorage) Get(context.Context, string) (io.ReadCloser, string, error) {
	return nil, "", ErrBlobStorageUnavailable
}
func (UnavailableBlobStorage) Delete(context.Context, string) error { return nil }

// attachmentUploadChunkSize is the GCS writer's buffer (a multiple of 256 KiB). The default is
// 16 MiB, far above the 5 MiB attachment limit.
const attachmentUploadChunkSize = 1 << 20

// GCSBlobStorage stores objects in a GCS bucket.
type GCSBlobStorage struct {
	client *storage.Client
	bucket string
}

// NewGCSBlobStorage builds a client for bucket. Caller should Close the underlying client on shutdown if needed.
func NewGCSBlobStorage(ctx context.Context, bucket string) (*GCSBlobStorage, error) {
	if bucket == "" {
		return nil, ErrBlobStorageUnavailable
	}
	client, err := storage.NewClient(ctx)
	if err != nil {
		return nil, err
	}
	return &GCSBlobStorage{client: client, bucket: bucket}, nil
}

func (g *GCSBlobStorage) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	w := g.client.Bucket(g.bucket).Object(key).NewWriter(ctx)
	w.ContentType = contentType
	w.ChunkSize = attachmentUploadChunkSize
	if size > 0 {
		w.Size = size
	}
	if _, err := io.Copy(w, r); err != nil {
		_ = w.Close()
		return err
	}
	return w.Close()
}

func (g *GCSBlobStorage) Get(ctx context.Context, key string) (io.ReadCloser, string, error) {
	r, err := g.client.Bucket(g.bucket).Object(key).NewReader(ctx)
	if err != nil {
		if errors.Is(err, storage.ErrObjectNotExist) {
			return nil, "", ErrNotFound
		}
		return nil, "", err
	}
	ct := r.Attrs.ContentType
	if ct == "" {
		ct = "application/octet-stream"
	}
	return r, ct, nil
}

func (g *GCSBlobStorage) Delete(ctx context.Context, key string) error {
	err := g.client.Bucket(g.bucket).Object(key).Delete(ctx)
	if errors.Is(err, storage.ErrObjectNotExist) {
		return nil
	}
	return err
}

// NewBlobStorageFromEnv returns GCS when ATTACHMENT_GCS_BUCKET is set, otherwise UnavailableBlobStorage.
func NewBlobStorageFromEnv(ctx context.Context, getenv func(string) string) BlobStorage {
	bucket := ""
	if getenv != nil {
		bucket = getenv("ATTACHMENT_GCS_BUCKET")
	}
	if bucket == "" {
		return UnavailableBlobStorage{}
	}
	gcs, err := NewGCSBlobStorage(ctx, bucket)
	if err != nil {
		slog.Error("attachment GCS client failed; uploads disabled", "error", err)
		return UnavailableBlobStorage{}
	}
	return gcs
}

func purgeAttachmentBlobs(ctx context.Context, store BlobStorage, keys []string) {
	if store == nil || len(keys) == 0 {
		return
	}
	for _, key := range keys {
		if key == "" {
			continue
		}
		cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		err := store.Delete(cctx, key)
		cancel()
		if err != nil {
			slog.Error("attachment blob purge failed", "key", key, "error", err)
		}
	}
}
