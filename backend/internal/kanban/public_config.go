package kanban

import (
	"net/http"
	"strings"
)

// NormalizePublicOrigin trims space and any trailing slashes. Empty input stays empty.
func NormalizePublicOrigin(raw string) string {
	return strings.TrimRight(strings.TrimSpace(raw), "/")
}

func (h handler) publicConfig(w http.ResponseWriter, _ *http.Request) {
	reply(w, 200, map[string]string{"publicOrigin": h.publicOrigin})
}
