package kanban

import (
	"crypto/subtle"
	"net/http"
	"strings"
	"time"
)

func (h handler) schedulerTokenOK(r *http.Request) bool {
	want := h.schedulerJobToken
	if want == "" {
		return false
	}
	got := strings.TrimSpace(r.Header.Get(SchedulerTokenHeader))
	if got == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

// requireJobRunnerAuth guards scheduler-triggered POSTs: JSON + origin, then token or admin session.
func (h handler) requireJobRunnerAuth(w http.ResponseWriter, r *http.Request) bool {
	if !requireJSONContentType(w, r) || !h.requireAllowedOrigin(w, r) {
		return false
	}
	if h.schedulerTokenOK(r) {
		return true
	}
	if _, ok := h.jobRunnerAdminFromSession(r); ok {
		return true
	}
	reply(w, http.StatusForbidden, map[string]string{"message": msgForbidden})
	return false
}

// jobRunnerAdminFromSession resolves an admin on session-exempt job routes (middleware skips session).
func (h handler) jobRunnerAdminFromSession(r *http.Request) (User, bool) {
	c, err := r.Cookie(SessionCookieName)
	if err != nil || c.Value == "" {
		return User{}, false
	}
	user, err := h.repo.UserBySessionID(r.Context(), c.Value, time.Now().UTC())
	if err != nil || user.Disabled || user.Role != RoleAdmin {
		return User{}, false
	}
	return user, true
}