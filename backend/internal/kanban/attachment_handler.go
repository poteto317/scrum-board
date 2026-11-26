package kanban

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
)

const (
	attachmentMultipartMaxMemory = 1 << 20 // 1 MiB in memory; rest to temp
	// Overhead for multipart boundaries / headers beyond the file payload.
	attachmentMultipartOverhead = 64 * 1024
	attachmentMaxMultipartRequestBytes = attachmentMaxBytes + attachmentMultipartMaxMemory + attachmentMultipartOverhead
)

func (h handler) listAttachments(w http.ResponseWriter, r *http.Request) {
	card, ok := h.commentParentItem(w, r, false)
	if !ok {
		return
	}
	list, err := h.repo.ListAttachments(r.Context(), card.ID)
	if err != nil {
		fail(w, err)
		return
	}
	if list == nil {
		list = []Attachment{}
	}
	reply(w, http.StatusOK, map[string][]Attachment{"attachments": list})
}

func (h handler) createAttachment(w http.ResponseWriter, r *http.Request) {
	card, ok := h.commentParentItem(w, r, true)
	if !ok {
		return
	}
	h.withAttachmentSlot(w, r, func() { h.createAttachmentBody(w, r, card) })
}

func (h handler) createAttachmentBody(w http.ResponseWriter, r *http.Request, card Item) {
	r.Body = http.MaxBytesReader(w, r.Body, attachmentMaxMultipartRequestBytes)
	err := r.ParseMultipartForm(attachmentMultipartMaxMemory)
	if r.MultipartForm != nil {
		mf := r.MultipartForm
		defer func() { _ = mf.RemoveAll() }()
	}
	if err != nil {
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			invalid(w, "添付は5MiB以下にしてください。")
			return
		}
		invalid(w, "multipart の形式を確認してください。")
		return
	}
	if errMsg := attachmentUnknownMultipartFields(r); errMsg != "" {
		invalid(w, errMsg)
		return
	}
	field := strings.TrimSpace(r.FormValue("field"))
	if field == "" {
		invalid(w, "field を指定してください。")
		return
	}
	if _, err := normalizeAttachmentField(field); err != nil {
		invalid(w, "field は description / solution / comment のいずれかです。")
		return
	}
	var commentID *int64
	if raw := strings.TrimSpace(r.FormValue("commentId")); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n <= 0 {
			invalid(w, "commentId が不正です。")
			return
		}
		commentID = &n
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		invalid(w, "file を指定してください。")
		return
	}
	defer file.Close()
	if header.Size > attachmentMaxBytes {
		invalid(w, "添付は5MiB以下にしてください。")
		return
	}
	contentType := header.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	// Strip parameters (e.g. charset) — still must be exact allowlist base type.
	if i := strings.Index(contentType, ";"); i >= 0 {
		contentType = strings.TrimSpace(contentType[:i])
	}
	var userID *int64
	if u := requestUserPtr(r); u != nil {
		id := u.ID
		userID = &id
	}
	created, err := h.repo.CreateAttachment(r.Context(), h.blobs, card.ID, field, commentID, header.Filename, contentType, header.Size, file, userID)
	if err != nil {
		failAttachment(w, err)
		return
	}
	reply(w, http.StatusCreated, created)
}

func (h handler) getAttachmentContent(w http.ResponseWriter, r *http.Request) {
	card, ok := h.commentParentItem(w, r, false)
	if !ok {
		return
	}
	attachmentID, ok := attachmentPathID(w, r)
	if !ok {
		return
	}
	// The row is read first: it must exist for this item before a 304 (a deleted or foreign
	// attachment is a 404), and it gives the ETag without opening the blob.
	attachment, err := h.repo.GetAttachment(r.Context(), card.ID, attachmentID)
	if err != nil {
		failAttachment(w, err)
		return
	}
	etag := attachmentETag(attachment)
	if etagMatches(r.Header.Get("If-None-Match"), etag) {
		setAttachmentCacheHeaders(w, etag)
		w.WriteHeader(http.StatusNotModified)
		return
	}
	h.withAttachmentSlot(w, r, func() {
		h.serveAttachmentContent(w, r, card.ID, attachmentID, etag, attachment.ContentType, attachment.OriginalName)
	})
}

// attachmentCacheControl: an attachment's bytes never change for its id, so the browser may keep
// them for an hour; after that it revalidates with the ETag, and every request is still
// permission-checked.
const attachmentCacheControl = "private, max-age=3600"

// The cache headers are set only on a 200 or 304, so an error response is never cached.
func setAttachmentCacheHeaders(w http.ResponseWriter, etag string) {
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", attachmentCacheControl)
	// A different session (another user on the same browser; the session may also come from an
	// Authorization header) must not reuse the cached copy.
	w.Header().Add("Vary", "Cookie, Authorization")
}

func attachmentETag(a Attachment) string {
	return `"` + strconv.FormatInt(a.ID, 10) + "-" + strconv.FormatInt(a.ByteSize, 10) + `"`
}

// etagMatches reports whether an If-None-Match header lists etag (or *), comparing weakly.
func etagMatches(header, etag string) bool {
	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimPrefix(strings.TrimSpace(candidate), "W/")
		if candidate == "*" || candidate == etag {
			return true
		}
	}
	return false
}

func (h handler) serveAttachmentContent(w http.ResponseWriter, r *http.Request, itemID, attachmentID int64, etag, contentType, originalName string) {
	rc, storedType, err := h.repo.OpenAttachmentContent(r.Context(), h.blobs, itemID, attachmentID)
	if err != nil {
		failAttachment(w, err)
		return
	}
	defer rc.Close()
	if storedType != "" {
		contentType = storedType
	}
	w.Header().Set("Content-Type", contentType)
	if !isImageAttachmentMIME(contentType) {
		w.Header().Set("Content-Disposition", contentDispositionAttachment(originalName, contentType))
	}
	setAttachmentCacheHeaders(w, etag)
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, rc)
}

// contentDispositionAttachment builds a header-safe Content-Disposition for downloads.
// Header encoding is local to HTTP responses (not markdown label sanitization).
// For PDF, the download name always ends with .pdf so a spoofed .html suffix cannot stick.
func contentDispositionAttachment(name, contentType string) string {
	name = scrubAttachmentDisplayName(name)
	if name == "" {
		name = "file"
	}
	if strings.EqualFold(contentType, "application/pdf") && !strings.HasSuffix(strings.ToLower(name), ".pdf") {
		name = name + ".pdf"
	}
	ascii := make([]rune, 0, len(name))
	for _, r := range name {
		switch {
		case r == '"' || r == '\\' || r < 0x20 || r == 0x7f:
			ascii = append(ascii, '_')
		case r > 0x7e:
			ascii = append(ascii, '_')
		default:
			ascii = append(ascii, r)
		}
	}
	fallback := string(ascii)
	if strings.Trim(fallback, "_") == "" {
		fallback = "file"
	}
	var encoded strings.Builder
	for _, b := range []byte(name) {
		if (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') ||
			b == '.' || b == '_' || b == '-' {
			encoded.WriteByte(b)
			continue
		}
		encoded.WriteByte('%')
		encoded.WriteByte("0123456789ABCDEF"[b>>4])
		encoded.WriteByte("0123456789ABCDEF"[b&0x0f])
	}
	return `attachment; filename="` + fallback + `"; filename*=UTF-8''` + encoded.String()
}

func (h handler) deleteAttachment(w http.ResponseWriter, r *http.Request) {
	card, ok := h.commentParentItem(w, r, true)
	if !ok {
		return
	}
	attachmentID, ok := attachmentPathID(w, r)
	if !ok {
		return
	}
	if err := h.repo.DeleteAttachment(r.Context(), h.blobs, card.ID, attachmentID, card.Number); err != nil {
		failAttachment(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func attachmentPathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		invalid(w, "添付IDが不正です。")
		return 0, false
	}
	return id, true
}

func attachmentUnknownMultipartFields(r *http.Request) string {
	allowed := map[string]struct{}{"file": {}, "field": {}, "commentId": {}}
	if r.MultipartForm == nil {
		return ""
	}
	for key := range r.MultipartForm.Value {
		if _, ok := allowed[key]; !ok {
			return "不明なフィールドがあります。"
		}
	}
	for key := range r.MultipartForm.File {
		if _, ok := allowed[key]; !ok {
			return "不明なフィールドがあります。"
		}
	}
	return ""
}

func failAttachment(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		reply(w, http.StatusNotFound, map[string]string{"message": "添付が見つかりません。"})
	case errors.Is(err, ErrAttachmentLimit):
		invalid(w, "添付はアイテムあたり20件までです。")
	case errors.Is(err, ErrAttachmentQuota):
		invalid(w, "このプロジェクトの添付容量の上限に達しています。")
	case errors.Is(err, ErrAttachmentInvalid):
		invalid(w, "添付の形式またはサイズを確認してください。")
	case errors.Is(err, ErrBlobStorageUnavailable):
		reply(w, http.StatusServiceUnavailable, map[string]string{"message": "添付ストレージが設定されていません。"})
	default:
		fail(w, err)
	}
}

func (h handler) purgeBlobsBestEffort(r *http.Request, keys []string) {
	purgeAttachmentBlobs(r.Context(), h.blobs, keys)
}

// purgeOrphanAttachmentBlobs deletes blobs only when the object_key row is already gone
// (avoids deleting a restored item's blob after a race with trash purge).
func (h handler) purgeOrphanAttachmentBlobs(r *http.Request, keys []string) {
	if h.blobs == nil || len(keys) == 0 {
		return
	}
	ctx := r.Context()
	orphans := make([]string, 0, len(keys))
	for _, key := range keys {
		if key == "" {
			continue
		}
		exists, err := h.repo.AttachmentObjectKeyExists(ctx, key)
		if err != nil || exists {
			continue
		}
		orphans = append(orphans, key)
	}
	purgeAttachmentBlobs(ctx, h.blobs, orphans)
}
