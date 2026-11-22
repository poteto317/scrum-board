package kanban

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
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
	if w.Code != 401 || !strings.Contains(w.Body.String(), msgLoginFailed) {
		t.Fatalf("disabled login=%d %s", w.Code, w.Body)
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

func TestSessionCookieSecureFollowsForwardedProto(t *testing.T) {
	h := NewHandler(fresh())
	loginWithProto := func(proto string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"loginName":"admin","password":"test-password"}`))
		r.Header.Set("Content-Type", "application/json")
		if proto != "" {
			r.Header.Set("X-Forwarded-Proto", proto)
		}
		h.ServeHTTP(w, r)
		return w
	}

	t.Run("https login and logout set Secure", func(t *testing.T) {
		loginHTTPS := loginWithProto("https")
		if loginHTTPS.Code != 200 {
			t.Fatalf("login status=%d body=%s", loginHTTPS.Code, loginHTTPS.Body)
		}
		secureCookie := findSessionCookie(loginHTTPS)
		if secureCookie == nil || !secureCookie.Secure {
			t.Fatalf("login cookie Secure want true: %#v", secureCookie)
		}
		logoutHTTPS := httptest.NewRecorder()
		rLogout := httptest.NewRequest("POST", "/api/auth/logout", nil)
		rLogout.Header.Set("Content-Type", "application/json")
		rLogout.Header.Set("X-Forwarded-Proto", "https")
		rLogout.AddCookie(&http.Cookie{Name: SessionCookieName, Value: secureCookie.Value})
		h.ServeHTTP(logoutHTTPS, rLogout)
		if logoutHTTPS.Code != 204 {
			t.Fatalf("logout status=%d", logoutHTTPS.Code)
		}
		cleared := findSessionCookie(logoutHTTPS)
		if cleared == nil || !cleared.Secure {
			t.Fatalf("logout clear cookie Secure want true: %#v", cleared)
		}
	})

	t.Run("http forwarded proto leaves Secure unset", func(t *testing.T) {
		w := loginWithProto("http")
		if w.Code != 200 {
			t.Fatalf("login status=%d", w.Code)
		}
		c := findSessionCookie(w)
		if c == nil || c.Secure {
			t.Fatalf("Secure want false: %#v", c)
		}
	})
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

	// browser-like: nginx/proxy Basic is resent but must not become app login
	browserBasic := httptest.NewRecorder()
	rBrowser := httptest.NewRequest("GET", "/api/board", nil)
	rBrowser.Header.Set("Sec-Fetch-Site", "same-origin")
	rBrowser.SetBasicAuth("admin", "test-password")
	h.ServeHTTP(browserBasic, rBrowser)
	if browserBasic.Code != 401 || !strings.Contains(browserBasic.Body.String(), msgLoginRequired) {
		t.Fatalf("basic with Sec-Fetch-Site=%d %s", browserBasic.Code, browserBasic.Body)
	}

	// valid cookie still wins with Sec-Fetch-Site (browser session)
	browserCookie := httptest.NewRecorder()
	rCookie := httptest.NewRequest("GET", "/api/board", nil)
	rCookie.Header.Set("Sec-Fetch-Site", "same-origin")
	rCookie.AddCookie(&http.Cookie{Name: SessionCookieName, Value: HandlerTestSessionID})
	h.ServeHTTP(browserCookie, rCookie)
	if browserCookie.Code != 200 {
		t.Fatalf("cookie with Sec-Fetch-Site=%d %s", browserCookie.Code, browserCookie.Body)
	}

	for _, site := range []string{"none", "cross-site"} {
		t.Run("Sec-Fetch-Site="+site, func(t *testing.T) {
			basic := httptest.NewRecorder()
			rBasic := httptest.NewRequest("GET", "/api/board", nil)
			rBasic.Header.Set("Sec-Fetch-Site", site)
			rBasic.SetBasicAuth("admin", "test-password")
			h.ServeHTTP(basic, rBasic)
			if basic.Code != 401 || !strings.Contains(basic.Body.String(), msgLoginRequired) {
				t.Fatalf("basic with Sec-Fetch-Site %q=%d %s", site, basic.Code, basic.Body)
			}
			cookie := httptest.NewRecorder()
			rSess := httptest.NewRequest("GET", "/api/board", nil)
			rSess.Header.Set("Sec-Fetch-Site", site)
			rSess.AddCookie(&http.Cookie{Name: SessionCookieName, Value: HandlerTestSessionID})
			h.ServeHTTP(cookie, rSess)
			if cookie.Code != 200 {
				t.Fatalf("cookie with Sec-Fetch-Site %q=%d %s", site, cookie.Code, cookie.Body)
			}
		})
	}

	// cookie identity wins over valid Basic (different users)
	repo := fresh()
	member, err := repo.CreateUser(t.Context(), UserCreateInput{
		LoginName: "member-me", Password: "password1", DisplayName: "Member", Role: RoleMember,
	})
	if err != nil {
		t.Fatal(err)
	}
	memberSess, err := repo.CreateSession(t.Context(), member.ID, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	meBoth := httptest.NewRecorder()
	rMe := httptest.NewRequest("GET", "/api/auth/me", nil)
	rMe.AddCookie(&http.Cookie{Name: SessionCookieName, Value: memberSess.ID})
	rMe.SetBasicAuth("admin", "test-password")
	NewHandler(repo).ServeHTTP(meBoth, rMe)
	if meBoth.Code != 200 {
		t.Fatalf("me cookie+basic=%d %s", meBoth.Code, meBoth.Body)
	}
	var mePub UserPublic
	if err := json.Unmarshal(meBoth.Body.Bytes(), &mePub); err != nil {
		t.Fatal(err)
	}
	if mePub.LoginName != "member-me" || mePub.ID != member.ID {
		t.Fatalf("cookie must win over basic: %#v", mePub)
	}
}

func TestSessionOptionalBasicAuth(t *testing.T) {
	repo := fresh()
	pub, err := repo.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "pub", Description: "d"})
	if err != nil {
		t.Fatal(err)
	}
	pub.ViewAccess = ViewAccessPublic
	repo.cards[pub.ID] = pub
	secret, err := repo.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "secret", Description: "d"})
	if err != nil {
		t.Fatal(err)
	}
	secret.ViewAccess = ViewAccessRestricted
	secret.EditAccess = EditAccessRestricted
	repo.cards[secret.ID] = secret
	repo.aclEntries[secret.ID] = ItemACL{ViewUserIDs: []int64{1}}

	h := NewHandler(repo)
	pubPath := "/api/items/by-number/" + strconv.FormatInt(pub.Number, 10)
	secPath := "/api/items/by-number/" + strconv.FormatInt(secret.Number, 10)

	if w := requestAnon(h, "GET", pubPath, ""); w.Code != 200 {
		t.Fatalf("anon public=%d %s", w.Code, w.Body)
	}
	if w := requestAnon(h, "GET", secPath, ""); w.Code != 401 {
		t.Fatalf("anon restricted=%d %s", w.Code, w.Body)
	}

	if w := requestWithBasic(h, "GET", secPath, "", "admin", "test-password"); w.Code != 200 {
		t.Fatalf("basic restricted=%d %s", w.Code, w.Body)
	}

	bad := httptest.NewRecorder()
	rBad := httptest.NewRequest("GET", secPath, nil)
	rBad.SetBasicAuth("admin", "wrong")
	h.ServeHTTP(bad, rBad)
	if bad.Code != 401 {
		t.Fatalf("bad basic restricted=%d %s", bad.Code, bad.Body)
	}

	skip := httptest.NewRecorder()
	rSkip := httptest.NewRequest("GET", pubPath, nil)
	rSkip.Header.Set("Sec-Fetch-Site", "same-origin")
	rSkip.SetBasicAuth("admin", "test-password")
	h.ServeHTTP(skip, rSkip)
	if skip.Code != 200 {
		t.Fatalf("basic+Sec-Fetch public=%d %s", skip.Code, skip.Body)
	}
	var anonPub Item
	if err := json.Unmarshal(skip.Body.Bytes(), &anonPub); err != nil {
		t.Fatal(err)
	}
	if anonPub.ViewerCanEdit || anonPub.ViewerCanManage {
		t.Fatal("Sec-Fetch basic must not attach CurrentUser on sessionOptional")
	}

	skipSec := httptest.NewRecorder()
	rSkipSec := httptest.NewRequest("GET", secPath, nil)
	rSkipSec.Header.Set("Sec-Fetch-Site", "cross-site")
	rSkipSec.SetBasicAuth("admin", "test-password")
	h.ServeHTTP(skipSec, rSkipSec)
	if skipSec.Code != 401 {
		t.Fatalf("basic+Sec-Fetch restricted=%d %s", skipSec.Code, skipSec.Body)
	}
}

func TestClientIP(t *testing.T) {
	cases := []struct {
		name   string
		realIP string
		xff    string
		remote string
		want   string
	}{
		{name: "real-ip wins", realIP: "10.0.0.5", xff: "1.1.1.1, 2.2.2.2", remote: "127.0.0.1:1234", want: "10.0.0.5"},
		{name: "xff first hop", xff: "1.1.1.1, 2.2.2.2", remote: "127.0.0.1:1234", want: "1.1.1.1"},
		{name: "remote host", remote: "192.0.2.1:9999", want: "192.0.2.1"},
		{name: "remote bare", remote: "192.0.2.1", want: "192.0.2.1"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/", nil)
			if tc.realIP != "" {
				r.Header.Set("X-Real-IP", tc.realIP)
			}
			if tc.xff != "" {
				r.Header.Set("X-Forwarded-For", tc.xff)
			}
			r.RemoteAddr = tc.remote
			if got := clientIP(r); got != tc.want {
				t.Fatalf("got %q want %q", got, tc.want)
			}
		})
	}
}

func TestAuthLoginIPRateLimitBlocksOtherLogin(t *testing.T) {
	h := NewHandler(fresh())
	body := func(name string) string {
		return `{"loginName":"` + name + `","password":"wrong-password"}`
	}
	for i := 0; i < loginFailureLimit; i++ {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(body("admin")))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-Real-IP", "203.0.113.9")
		h.ServeHTTP(w, r)
		if w.Code != 401 {
			t.Fatalf("fail %d: %d", i+1, w.Code)
		}
	}
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(body("other")))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Real-IP", "203.0.113.9")
	h.ServeHTTP(w, r)
	if w.Code != 429 {
		t.Fatalf("same IP other login want 429 got %d %s", w.Code, w.Body)
	}
}

func TestLoginPasswordHash(t *testing.T) {
	u := User{PasswordHash: "real-hash", Disabled: false}
	if got := loginPasswordHash(u, nil); got != "real-hash" {
		t.Fatalf("enabled=%q", got)
	}
	u.Disabled = true
	if got := loginPasswordHash(u, nil); got != loginDummyHash {
		t.Fatal("disabled should use dummy")
	}
	if got := loginPasswordHash(User{}, ErrNotFound); got != loginDummyHash {
		t.Fatal("missing should use dummy")
	}
}

func TestAuthLoginUnknownUserMessage(t *testing.T) {
	h := NewHandler(fresh())
	w := requestAnon(h, "POST", "/api/auth/login", `{"loginName":"no-such-user","password":"anything1"}`)
	if w.Code != 401 || !strings.Contains(w.Body.String(), msgLoginFailed) {
		t.Fatalf("unknown=%d %s", w.Code, w.Body)
	}
}

func TestAuthLoginRateLimited(t *testing.T) {
	h := NewHandler(fresh())
	body := `{"loginName":"admin","password":"wrong-password"}`
	for i := 0; i < loginFailureLimit; i++ {
		w := requestAnon(h, "POST", "/api/auth/login", body)
		if w.Code != 401 {
			t.Fatalf("fail %d: status=%d %s", i+1, w.Code, w.Body)
		}
	}
	locked := requestAnon(h, "POST", "/api/auth/login", body)
	if locked.Code != 429 || !strings.Contains(locked.Body.String(), msgLoginRateLimited) {
		t.Fatalf("locked=%d %s", locked.Code, locked.Body)
	}
	ok := requestAnon(h, "POST", "/api/auth/login", `{"loginName":"admin","password":"test-password"}`)
	if ok.Code != 429 {
		t.Fatalf("correct password while locked should still 429, got %d", ok.Code)
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
