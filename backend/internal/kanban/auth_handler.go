package kanban

import (
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
	user, err := h.repo.GetUserByLoginName(r.Context(), loginName)
	if err != nil || user.Disabled || !CheckPassword(user.PasswordHash, in.Password) {
		reply(w, 401, map[string]string{"message": msgLoginFailed})
		return
	}
	now := time.Now().UTC()
	sess, err := h.repo.CreateSession(r.Context(), user.ID, now)
	if err != nil {
		fail(w, err)
		return
	}
	setSessionCookie(w, r, sess.ID, sess.ExpiresAt)
	reply(w, 200, user.Public())
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
