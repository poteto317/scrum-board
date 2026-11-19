package kanban

import (
	"context"
	"net/http"
	"strings"
	"time"
)

type ctxKey int

const currentUserKey ctxKey = 1

// CurrentUser returns the authenticated user from request context.
func CurrentUser(ctx context.Context) (User, bool) {
	u, ok := ctx.Value(currentUserKey).(User)
	return u, ok
}

func withUser(ctx context.Context, u User) context.Context {
	return context.WithValue(ctx, currentUserKey, u)
}

func sessionExempt(r *http.Request) bool {
	path := r.URL.Path
	switch {
	case r.Method == http.MethodPost && path == "/api/auth/login":
		return true
	case r.Method == http.MethodPost && path == "/api/auth/logout":
		return true
	case r.Method == http.MethodPost && path == "/api/trash/purge":
		return true
	case r.Method == http.MethodGet && path == "/api/public-config":
		return true
	case r.Method == http.MethodGet && path == "/api/health":
		return true
	default:
		return false
	}
}

func (h handler) withSessionAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if sessionExempt(r) {
			next.ServeHTTP(w, r)
			return
		}
		c, err := r.Cookie(SessionCookieName)
		if err != nil || c.Value == "" {
			reply(w, 401, map[string]string{"message": msgLoginRequired})
			return
		}
		user, err := h.repo.UserBySessionID(r.Context(), c.Value, time.Now().UTC())
		if err != nil {
			reply(w, 401, map[string]string{"message": msgLoginRequired})
			return
		}
		next.ServeHTTP(w, r.WithContext(withUser(r.Context(), user)))
	})
}

const (
	msgLoginRequired = "ログインが必要です。"
	msgLoginFailed   = "ログインに失敗しました。"
	msgForbidden     = "権限がありません。"
	msgLastAdmin     = "最後の有効な管理者は無効化または降格できません。"
	msgSelfDisable   = "自分自身を無効化できません。"
	msgUserInvalid   = "入力内容を確認してください。"
	msgLoginTaken    = "そのログイン名は既に使われています。"
)

func setSessionCookie(w http.ResponseWriter, r *http.Request, sessionID string, expires time.Time) {
	c := &http.Cookie{
		Name:     SessionCookieName,
		Value:    sessionID,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  expires,
	}
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		c.Secure = true
	}
	http.SetCookie(w, c)
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	c := &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0).UTC(),
	}
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		c.Secure = true
	}
	http.SetCookie(w, c)
}
