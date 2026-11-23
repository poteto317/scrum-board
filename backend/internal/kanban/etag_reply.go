package kanban

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
)

// replyJSONWithETag marshals data, sets a strong ETag from SHA-256 of the bytes,
// and returns 304 with no body when If-None-Match is satisfied.
func replyJSONWithETag(w http.ResponseWriter, r *http.Request, data any) {
	body, err := json.Marshal(data)
	if err != nil {
		fail(w, err)
		return
	}
	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:]) + `"`
	w.Header().Set("ETag", etag)
	if ifNoneMatchSatisfied(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

// ifNoneMatchSatisfied implements the design comparison rule:
// comma-split tokens, trim; "*" matches; strip weak W/ prefix then exact match to strong etag.
func ifNoneMatchSatisfied(header, etag string) bool {
	if header == "" {
		return false
	}
	for _, part := range strings.Split(header, ",") {
		tok := strings.TrimSpace(part)
		if tok == "" {
			continue
		}
		if tok == "*" {
			return true
		}
		if strings.HasPrefix(tok, "W/") || strings.HasPrefix(tok, "w/") {
			tok = strings.TrimSpace(tok[2:])
		}
		if tok == etag {
			return true
		}
	}
	return false
}
