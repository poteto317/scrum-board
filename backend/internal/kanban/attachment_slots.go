package kanban

import (
	"net/http"
)

func (h handler) withAttachmentSlot(w http.ResponseWriter, r *http.Request, fn func()) {
	if h.attachmentSlots == nil {
		fn()
		return
	}
	select {
	case h.attachmentSlots <- struct{}{}:
		defer func() { <-h.attachmentSlots }()
		fn()
	case <-r.Context().Done():
		reply(w, http.StatusServiceUnavailable, map[string]string{"message": "リクエストがキャンセルされました。"})
	default:
		reply(w, http.StatusServiceUnavailable, map[string]string{"message": "添付処理が混雑しています。しばらくしてから再度お試しください。"})
	}
}