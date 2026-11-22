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
	attachmentMultipartSlack     = 64 * 1024
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
	r.Body = http.MaxBytesReader(w, r.Body, attachmentMaxBytes+attachmentMultipartMaxMemory+attachmentMultipartSlack)
	err := r.ParseMultipartForm(attachmentMultipartMaxMemory)
	if r.MultipartForm != nil {
		mf := r.MultipartForm
		defer func() { _ = mf.RemoveAll() }()
	}
	if err != nil {
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			invalid(w, "画像は5MiB以下にしてください。")
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
		invalid(w, "画像は5MiB以下にしてください。")
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
	created, err := h.repo.CreateAttachment(
		r.Context(), h.blobs, card.ID, field, commentID, header.Filename, contentType, header.Size, file, userID,
	)
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
	rc, contentType, err := h.repo.OpenAttachmentContent(r.Context(), h.blobs, card.ID, attachmentID)
	if err != nil {
		failAttachment(w, err)
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=60")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, rc)
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
		invalid(w, "添付はアイテムあたり20枚までです。")
	case errors.Is(err, ErrAttachmentInvalid):
		invalid(w, "画像の形式またはサイズを確認してください。")
	case errors.Is(err, ErrBlobStorageUnavailable):
		reply(w, http.StatusServiceUnavailable, map[string]string{"message": "画像ストレージが設定されていません。"})
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
