package kanban

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAuthLoginLogoutMe(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)

	w := requestAnon(h, "POST", "/api/auth/login", `{"loginName":"admin","password":"test-password"}`)
	if w.Code != 200 {
		t.Fatalf("login status=%d body=%s", w.Code, w.Body)
	}
	var pub UserPublic
	if err := json.Unmarshal(w.Body.Bytes(), &pub); err != nil {
		t.Fatal(err)
	}
	if pub.LoginName != "admin" || pub.Role != RoleAdmin {
		t.Fatalf("unexpected user %#v", pub)
	}
	cookie := findSessionCookie(w)
	if cookie == nil || !cookie.HttpOnly || cookie.Path != "/" || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("bad cookie: %#v", cookie)
	}
	if cookie.Secure {
		t.Fatal("Secure must not be set on plain HTTP")
	}
	if strings.Contains(w.Body.String(), "test-password") || strings.Contains(w.Body.String(), "$2a$") {
		t.Fatal("response leaked secret")
	}

	me := requestWithCookie(h, "GET", "/api/auth/me", "", cookie.Value)
	if me.Code != 200 {
		t.Fatalf("me=%d %s", me.Code, me.Body)
	}

	fail := requestAnon(h, "POST", "/api/auth/login", `{"loginName":"admin","password":"wrong"}`)
	if fail.Code != 401 || !strings.Contains(fail.Body.String(), msgLoginFailed) {
		t.Fatalf("bad login: %d %s", fail.Code, fail.Body)
	}
	if strings.Contains(fail.Body.String(), "test-password") {
		t.Fatal("failure leaked password")
	}

	disabled := fresh()
	disabled.users[0].Disabled = true
	w = requestAnon(NewHandler(disabled), "POST", "/api/auth/login", `{"loginName":"admin","password":"test-password"}`)
	if w.Code != 401 {
		t.Fatalf("disabled login=%d", w.Code)
	}

	out := requestWithCookie(h, "POST", "/api/auth/logout", "", cookie.Value)
	if out.Code != 204 {
		t.Fatalf("logout=%d", out.Code)
	}
	me = requestWithCookie(h, "GET", "/api/auth/me", "", cookie.Value)
	if me.Code != 401 {
		t.Fatalf("me after logout=%d", me.Code)
	}
}

func TestSessionMiddlewareExemptAndRequired(t *testing.T) {
	h := NewHandler(fresh())
	if w := requestAnon(h, "GET", "/api/public-config", ""); w.Code != 200 {
		t.Fatalf("public-config=%d", w.Code)
	}
	if w := requestAnon(h, "GET", "/api/health", ""); w.Code != 200 {
		t.Fatalf("health=%d", w.Code)
	}
	if w := requestAnon(h, "POST", "/api/trash/purge", ""); w.Code != 200 {
		t.Fatalf("purge=%d body=%s", w.Code, w.Body)
	}
	if w := requestAnon(h, "POST", "/api/recurring/run", ""); w.Code != 200 {
		t.Fatalf("recurring run=%d body=%s", w.Code, w.Body)
	}
	if w := requestAnon(h, "GET", "/api/board", ""); w.Code != 401 {
		t.Fatalf("board anon=%d", w.Code)
	}
	if w := request(h, "GET", "/api/board", ""); w.Code != 200 {
		t.Fatalf("board auth=%d body=%s", w.Code, w.Body)
	}
}

func TestDisableUserDeletesSessions(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	member, err := repo.CreateUser(t.Context(), UserCreateInput{
		LoginName: "m1", Password: "password1", DisplayName: "Member", Role: RoleMember,
	})
	if err != nil {
		t.Fatal(err)
	}
	sess, err := repo.CreateSession(t.Context(), member.ID, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	dis := true
	if _, err := repo.UpdateUser(t.Context(), member.ID, UserPatch{Disabled: &dis}, 1); err != nil {
		t.Fatal(err)
	}
	if w := requestWithCookie(h, "GET", "/api/auth/me", "", sess.ID); w.Code != 401 {
		t.Fatalf("disabled session me=%d", w.Code)
	}
}

func TestSessionMiddlewareBasicAuth(t *testing.T) {
	h := NewHandler(fresh())

	ok := requestWithBasic(h, "GET", "/api/board", "", "admin", "test-password")
	if ok.Code != 200 {
		t.Fatalf("basic board=%d %s", ok.Code, ok.Body)
	}
	if findSessionCookie(ok) != nil {
		t.Fatal("basic auth must not Set-Cookie sb_session")
	}
	for _, c := range ok.Result().Cookies() {
		if c.Name == SessionCookieName {
			t.Fatal("unexpected session cookie")
		}
	}

	bad := requestWithBasic(h, "GET", "/api/board", "", "admin", "wrong")
	if bad.Code != 401 || !strings.Contains(bad.Body.String(), msgLoginRequired) {
		t.Fatalf("bad basic=%d %s", bad.Code, bad.Body)
	}
	if strings.Contains(bad.Body.String(), "wrong") || strings.Contains(bad.Body.String(), "test-password") {
		t.Fatal("failure leaked password")
	}

	// valid cookie wins even if Basic is wrong
	both := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/api/board", nil)
	r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: HandlerTestSessionID})
	r.SetBasicAuth("admin", "wrong")
	h.ServeHTTP(both, r)
	if both.Code != 200 {
		t.Fatalf("cookie preferred=%d %s", both.Code, both.Body)
	}

	// invalid session cookie falls through to valid Basic
	stale := httptest.NewRecorder()
	rStale := httptest.NewRequest("GET", "/api/board", nil)
	rStale.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "nonexistent-session"})
	rStale.SetBasicAuth("admin", "test-password")
	h.ServeHTTP(stale, rStale)
	if stale.Code != 200 {
		t.Fatalf("invalid cookie basic fallthrough=%d %s", stale.Code, stale.Body)
	}

	disabled := fresh()
	disabled.users[0].Disabled = true
	w := requestWithBasic(NewHandler(disabled), "GET", "/api/board", "", "admin", "test-password")
	if w.Code != 401 || !strings.Contains(w.Body.String(), msgLoginRequired) {
		t.Fatalf("disabled basic=%d %s", w.Code, w.Body)
	}

	me := requestWithBasic(h, "GET", "/api/auth/me", "", "admin", "test-password")
	if me.Code != 200 {
		t.Fatalf("me basic=%d %s", me.Code, me.Body)
	}
	var pub UserPublic
	if err := json.Unmarshal(me.Body.Bytes(), &pub); err != nil {
		t.Fatal(err)
	}
	if pub.LoginName != "admin" {
		t.Fatalf("me user %#v", pub)
	}
}

func findSessionCookie(w *httptest.ResponseRecorder) *http.Cookie {
	for _, c := range w.Result().Cookies() {
		if c.Name == SessionCookieName {
			return c
		}
	}
	return nil
}
