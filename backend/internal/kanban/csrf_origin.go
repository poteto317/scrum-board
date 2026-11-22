package kanban

import (
	"mime"
	"net/http"
	"strings"
)

const (
	SchedulerTokenHeader        = "X-Scheduler-Token"
	HandlerTestSchedulerToken   = "handler-test-scheduler-token"
	msgUnsupportedContentType   = "Content-Typeはapplication/jsonにしてください。"
	msgForbiddenOrigin          = "リクエスト元が不正です。"
)

func requireJSONContentType(w http.ResponseWriter, r *http.Request) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		reply(w, http.StatusUnsupportedMediaType, map[string]string{"message": msgUnsupportedContentType})
		return false
	}
	return true
}

// requestOriginURL is the canonical browser origin for this request (scheme + host).
func requestOriginURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	host := r.Host
	if host == "" {
		host = "localhost"
	}
	return scheme + "://" + host
}

func (h handler) originAllowed(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	want := h.publicOrigin
	if want == "" {
		want = requestOriginURL(r)
	}
	return strings.EqualFold(origin, want)
}

func (h handler) requireAllowedOrigin(w http.ResponseWriter, r *http.Request) bool {
	if h.originAllowed(r) {
		return true
	}
	reply(w, http.StatusForbidden, map[string]string{"message": msgForbiddenOrigin})
	return false
}