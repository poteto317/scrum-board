package kanban

import (
	"net"
	"net/http"
	"strings"
	"time"
)

func (h handler) login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		LoginName string `json:"loginName"`
		Password  string `json:"password"`
	}
	if !decode(w, r, &in) {
		return
	}
	loginName := strings.TrimSpace(in.LoginName)
	if loginName == "" || in.Password == "" {
		reply(w, 401, map[string]string{"message": msgLoginFailed})
		return
	}
	loginKey := strings.ToLower(loginName)
	ip := clientIP(r)
	now := time.Now().UTC()
	if !h.loginAttempts.Allow(loginKey, ip, now) {
		reply(w, 429, map[string]string{"message": msgLoginRateLimited})
		return
	}
	user, err := h.repo.GetUserByLoginName(r.Context(), loginName)
	okUser := err == nil && !user.Disabled
	// Always compare (dummy hash when missing/disabled) before branching — do not short-circuit.
	match := CheckPassword(loginPasswordHash(user, err), in.Password)
	if !okUser || !match {
		h.loginAttempts.RecordFailure(loginKey, ip, now)
		reply(w, 401, map[string]string{"message": msgLoginFailed})
		return
	}
	sess, err := h.repo.CreateSession(r.Context(), user.ID, now)
	if err != nil {
		fail(w, err)
		return
	}
	h.loginAttempts.RecordSuccess(loginKey, ip)
	setSessionCookie(w, r, sess.ID, sess.ExpiresAt)
	reply(w, 200, user.Public())
}

func clientIP(r *http.Request) string {
	// Prefer X-Real-IP from our nginx (set from $remote_addr), not client-supplied XFF.
	if rip := strings.TrimSpace(r.Header.Get("X-Real-IP")); rip != "" {
		return rip
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (h handler) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(SessionCookieName); err == nil && c.Value != "" {
		_ = h.repo.DeleteSession(r.Context(), c.Value)
	}
	clearSessionCookie(w, r)
	w.WriteHeader(204)
}

func (h handler) me(w http.ResponseWriter, r *http.Request) {
	user, ok := CurrentUser(r.Context())
	if !ok {
		reply(w, 401, map[string]string{"message": msgLoginRequired})
		return
	}
	reply(w, 200, user.Public())
}
