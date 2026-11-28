package kanban

import (
	"net"
	"net/http"
	"strings"
	"time"
)

func (h handler) login(w http.ResponseWriter, r *http.Request) {
	if !requireJSONContentType(w, r) || !h.requireAllowedOrigin(w, r) {
		return
	}
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
	now := time.Now().UTC()
	// verifyCredentials clears login-key failures once credentials are accepted (before session I/O),
	// so a transient CreateSession failure does not push a valid user toward 429.
	user, result := h.verifyCredentials(r, h.loginAttempts, loginName, in.Password, now)
	switch result {
	case credentialLocked:
		reply(w, 429, map[string]string{"message": msgLoginRateLimited})
		return
	case credentialRejected:
		reply(w, 401, map[string]string{"message": msgLoginFailed})
		return
	}
	sess, err := h.repo.CreateSession(r.Context(), user.ID, now)
	if err != nil {
		fail(w, err)
		return
	}
	setSessionCookie(w, r, sess.ID, sess.ExpiresAt)
	reply(w, 200, user.Public())
}

// credentialResult is the outcome of verifyCredentials.
type credentialResult int

const (
	credentialAccepted credentialResult = iota
	credentialRejected                  // unknown/disabled user, lookup error, or wrong password (failure recorded)
	credentialLocked                    // limiter refused: no lookup, no compare, nothing recorded
)

// verifyCredentials is the rate-limited password check shared by POST /api/auth/login and
// Authorization: Basic. loginName must already be trimmed and non-empty; callers decide how
// to reply. Order: Allow → lookup → always one compare (dummy hash when missing/disabled/lookup
// error — do not short-circuit, L-085) → RecordFailure or RecordSuccess on the given limiter.
func (h handler) verifyCredentials(r *http.Request, limiter LoginAttemptLimiter, loginName, password string, now time.Time) (User, credentialResult) {
	loginKey := strings.ToLower(loginName)
	ip := clientIP(r)
	if !limiter.Allow(loginKey, ip, now) {
		return User{}, credentialLocked
	}
	user, err := h.repo.GetUserByLoginName(r.Context(), loginName)
	okUser := err == nil && !user.Disabled
	match := h.checkPassword(loginPasswordHash(user, err), password)
	if !okUser || !match {
		limiter.RecordFailure(loginKey, ip, now)
		return User{}, credentialRejected
	}
	limiter.RecordSuccess(loginKey, ip)
	return user, credentialAccepted
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
