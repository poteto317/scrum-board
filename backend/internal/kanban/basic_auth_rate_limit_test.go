package kanban

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// Tests for Basic-auth rate limiting, plus the verifyCredentials check it shares with POST /api/auth/login.

// Fakes below are read by tests without locking only after the call under test returns (sequential tests).

// recordingLimiter records calls; allow decides Allow's result.
type recordingLimiter struct {
	mu        sync.Mutex
	allow     bool
	allows    []string
	failures  []string
	successes []string
}

func (l *recordingLimiter) Allow(loginKey, ip string, _ time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.allows = append(l.allows, loginKey+"|"+ip)
	return l.allow
}

func (l *recordingLimiter) RecordFailure(loginKey, ip string, _ time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.failures = append(l.failures, loginKey+"|"+ip)
}

func (l *recordingLimiter) RecordSuccess(loginKey, ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.successes = append(l.successes, loginKey+"|"+ip)
}

// lookupRepo counts GetUserByLoginName calls and can force an error.
type lookupRepo struct {
	*memoryRepo
	mu    sync.Mutex
	calls int
	err   error
}

func (r *lookupRepo) GetUserByLoginName(ctx context.Context, loginName string) (User, error) {
	r.mu.Lock()
	r.calls++
	err := r.err
	r.mu.Unlock()
	if err != nil {
		return User{}, err
	}
	return r.memoryRepo.GetUserByLoginName(ctx, loginName)
}

// recordingChecker records each comparison and delegates to CheckPassword.
type recordingChecker struct {
	mu     sync.Mutex
	hashes []string
}

func (c *recordingChecker) check(hash, password string) bool {
	c.mu.Lock()
	c.hashes = append(c.hashes, hash)
	c.mu.Unlock()
	return CheckPassword(hash, password)
}

func basicReq(h http.Handler, path, user, pass, ip string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", path, nil)
	if ip != "" {
		r.Header.Set("X-Real-IP", ip)
	}
	r.SetBasicAuth(user, pass)
	h.ServeHTTP(w, r)
	return w
}

// テスト 1: 5 回失敗で正しいパスワードもロック。
func TestBasicAuthLocksAfterFailureLimit(t *testing.T) {
	h := NewHandler(fresh())
	for i := 0; i < loginFailureLimit; i++ {
		if w := basicReq(h, "/api/board", "admin", "wrong", ""); w.Code != 401 {
			t.Fatalf("fail %d: %d", i+1, w.Code)
		}
	}
	w := basicReq(h, "/api/board", "admin", "test-password", "")
	if w.Code != 401 || !strings.Contains(w.Body.String(), msgLoginRequired) {
		t.Fatalf("locked basic want 401 got %d %s", w.Code, w.Body)
	}
}

// テスト 2: ロック中は DB も照合も触らない。
func TestBasicAuthLockedSkipsLookupAndCompare(t *testing.T) {
	repo := &lookupRepo{memoryRepo: fresh()}
	lim := &recordingLimiter{allow: false}
	chk := &recordingChecker{}
	h := NewHandler(repo, WithBasicAuthAttemptLimiter(lim), withPasswordChecker(chk.check))
	if w := basicReq(h, "/api/board", "Admin", "test-password", ""); w.Code != 401 {
		t.Fatalf("locked want 401 got %d", w.Code)
	}
	if repo.calls != 0 || len(chk.hashes) != 0 {
		t.Fatalf("locked must skip lookup/compare: lookups=%d compares=%d", repo.calls, len(chk.hashes))
	}
	if len(lim.failures) != 0 {
		t.Fatalf("locked must not record failure: %v", lim.failures)
	}
	if len(lim.allows) != 1 || lim.allows[0] != "admin|192.0.2.1" {
		t.Fatalf("allow key %v", lim.allows)
	}
}

// テスト 3・4: どの失敗でも照合 1 回 + RecordFailure 1 回、不在・無効・DB エラーはダミーハッシュ。
func TestBasicAuthAlwaysComparesOnceAndRecords(t *testing.T) {
	cases := []struct {
		name      string
		user      string
		pass      string
		disable   bool
		lookupErr error
		wantCode  int
		wantDummy bool
		wantFail  bool
	}{
		{name: "missing user", user: "No-Such", pass: "x", wantCode: 401, wantDummy: true, wantFail: true},
		{name: "disabled user", user: "admin", pass: "test-password", disable: true, wantCode: 401, wantDummy: true, wantFail: true},
		{name: "db error", user: "admin", pass: "test-password", lookupErr: errors.New("db down"), wantCode: 401, wantDummy: true, wantFail: true},
		{name: "wrong password", user: "admin", pass: "wrong", wantCode: 401, wantFail: true},
		{name: "success", user: "admin", pass: "test-password", wantCode: 200},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mem := fresh()
			if tc.disable {
				for i := range mem.users {
					if mem.users[i].LoginName == "admin" {
						mem.users[i].Disabled = true
					}
				}
			}
			repo := &lookupRepo{memoryRepo: mem, err: tc.lookupErr}
			lim := &recordingLimiter{allow: true}
			chk := &recordingChecker{}
			h := NewHandler(repo, WithBasicAuthAttemptLimiter(lim), withPasswordChecker(chk.check))
			if w := basicReq(h, "/api/board", tc.user, tc.pass, ""); w.Code != tc.wantCode {
				t.Fatalf("code=%d want %d %s", w.Code, tc.wantCode, w.Body)
			}
			if len(chk.hashes) != 1 {
				t.Fatalf("compare count=%d want 1", len(chk.hashes))
			}
			if got := chk.hashes[0] == loginDummyHash; got != tc.wantDummy {
				t.Fatalf("dummy hash used=%v want %v", got, tc.wantDummy)
			}
			wantKey := strings.ToLower(strings.TrimSpace(tc.user)) + "|192.0.2.1"
			if tc.wantFail {
				if len(lim.failures) != 1 || lim.failures[0] != wantKey || len(lim.successes) != 0 {
					t.Fatalf("failures=%v successes=%v want %q", lim.failures, lim.successes, wantKey)
				}
			} else if len(lim.failures) != 0 || len(lim.successes) != 1 || lim.successes[0] != wantKey {
				t.Fatalf("failures=%v successes=%v", lim.failures, lim.successes)
			}
		})
	}
}

// テスト 5: Basic のロックはフォームのログインに波及しない。
func TestBasicAuthLockDoesNotAffectFormLogin(t *testing.T) {
	h := NewHandler(fresh())
	for i := 0; i < loginFailureLimit; i++ {
		basicReq(h, "/api/auth/me", "admin", "wrong", "")
	}
	if w := basicReq(h, "/api/board", "admin", "test-password", ""); w.Code != 401 {
		t.Fatalf("precondition: basic locked, got %d", w.Code)
	}
	w := requestAnon(h, "POST", "/api/auth/login", `{"loginName":"admin","password":"test-password"}`)
	if w.Code != 200 {
		t.Fatalf("form login after basic lock=%d %s", w.Code, w.Body)
	}
}

// テスト 6: 成功で login キーだけ消え、IP キーは残る（L-1028）。
func TestBasicAuthSuccessClearsLoginKeyNotIP(t *testing.T) {
	h := NewHandler(fresh())
	const ipA, ipB = "203.0.113.10", "203.0.113.20"
	for i := 0; i < loginFailureLimit-1; i++ {
		basicReq(h, "/api/board", "admin", "wrong", ipA)
	}
	if w := basicReq(h, "/api/board", "admin", "test-password", ipA); w.Code != 200 {
		t.Fatalf("A success=%d", w.Code)
	}
	for i := 0; i < loginFailureLimit-1; i++ {
		basicReq(h, "/api/board", "admin", "wrong", ipB)
	}
	if w := basicReq(h, "/api/board", "admin", "test-password", ipB); w.Code != 200 {
		t.Fatalf("login key should be cleared by success: B=%d", w.Code)
	}
	// ipA: 4 failures remain; one more (other login name) locks the IP.
	basicReq(h, "/api/board", "someone-else", "wrong", ipA)
	if w := basicReq(h, "/api/board", "admin", "test-password", ipA); w.Code != 401 {
		t.Fatalf("IP key must survive success: A=%d", w.Code)
	}
}

// テスト 8: ロック中でも公開アイテムは匿名として 200。
func TestBasicAuthLockedPublicItemStillAnonymous(t *testing.T) {
	repo := fresh()
	pub, err := repo.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "pub", Description: "d"})
	if err != nil {
		t.Fatal(err)
	}
	pub.ViewAccess = ViewAccessPublic
	repo.cards[pub.ID] = pub
	h := NewHandler(repo, WithBasicAuthAttemptLimiter(&recordingLimiter{allow: false}))
	path := "/api/items/by-number/" + strconv.FormatInt(pub.Number, 10)
	if w := basicReq(h, path, "admin", "test-password", ""); w.Code != 200 {
		t.Fatalf("locked basic public=%d %s", w.Code, w.Body)
	}
}

// テスト 9: 空・空白だけのログイン名、空パスワードはカウントしない。
func TestBasicAuthEmptyCredentialsNotCounted(t *testing.T) {
	for _, tc := range []struct{ user, pass string }{{"", "x"}, {"   ", "x"}, {"admin", ""}} {
		lim := &recordingLimiter{allow: true}
		h := NewHandler(fresh(), WithBasicAuthAttemptLimiter(lim))
		if w := basicReq(h, "/api/board", tc.user, tc.pass, ""); w.Code != 401 {
			t.Fatalf("%q/%q code=%d", tc.user, tc.pass, w.Code)
		}
		if len(lim.allows) != 0 || len(lim.failures) != 0 {
			t.Fatalf("%q/%q counted: allows=%v failures=%v", tc.user, tc.pass, lim.allows, lim.failures)
		}
	}
}

// verifyCredentials は login と Basic で共有する「Allow→照会→照合 1 回→記録」を 1 か所で固定する。
func TestVerifyCredentialsOutcomes(t *testing.T) {
	cases := []struct {
		name        string
		user        string
		pass        string
		locked      bool
		disable     bool
		lookupErr   error
		want        credentialResult
		wantLookups int
		wantHashes  int
		wantDummy   bool
		wantFail    bool
		wantSuccess bool
	}{
		{name: "locked", user: "admin", pass: "test-password", locked: true, want: credentialLocked},
		{name: "missing user", user: "No-Such", pass: "x", want: credentialRejected, wantLookups: 1, wantHashes: 1, wantDummy: true, wantFail: true},
		{name: "disabled user", user: "admin", pass: "test-password", disable: true, want: credentialRejected, wantLookups: 1, wantHashes: 1, wantDummy: true, wantFail: true},
		{name: "db error", user: "admin", pass: "test-password", lookupErr: errors.New("db down"), want: credentialRejected, wantLookups: 1, wantHashes: 1, wantDummy: true, wantFail: true},
		{name: "wrong password", user: "admin", pass: "wrong", want: credentialRejected, wantLookups: 1, wantHashes: 1, wantFail: true},
		{name: "success", user: "admin", pass: "test-password", want: credentialAccepted, wantLookups: 1, wantHashes: 1, wantSuccess: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mem := fresh()
			if tc.disable {
				for i := range mem.users {
					if mem.users[i].LoginName == "admin" {
						mem.users[i].Disabled = true
					}
				}
			}
			repo := &lookupRepo{memoryRepo: mem, err: tc.lookupErr}
			lim := &recordingLimiter{allow: !tc.locked}
			chk := &recordingChecker{}
			h := handler{repo: repo, checkPassword: chk.check}
			r := httptest.NewRequest("GET", "/", nil)
			user, got := h.verifyCredentials(r, lim, tc.user, tc.pass, time.Now().UTC())
			if got != tc.want {
				t.Fatalf("result=%d want %d", got, tc.want)
			}
			if (got == credentialAccepted) != (user.LoginName == "admin") {
				t.Fatalf("user=%+v for result %d", user, got)
			}
			if repo.calls != tc.wantLookups || len(chk.hashes) != tc.wantHashes {
				t.Fatalf("lookups=%d compares=%d want %d/%d", repo.calls, len(chk.hashes), tc.wantLookups, tc.wantHashes)
			}
			if tc.wantHashes == 1 && (chk.hashes[0] == loginDummyHash) != tc.wantDummy {
				t.Fatalf("dummy hash used=%v want %v", chk.hashes[0] == loginDummyHash, tc.wantDummy)
			}
			wantKey := strings.ToLower(tc.user) + "|192.0.2.1"
			if len(lim.allows) != 1 || lim.allows[0] != wantKey {
				t.Fatalf("allows=%v want %q", lim.allows, wantKey)
			}
			assertRecorded(t, "failures", lim.failures, tc.wantFail, wantKey)
			assertRecorded(t, "successes", lim.successes, tc.wantSuccess, wantKey)
		})
	}
}

// login も共有手順を通る: ロック中は 429 で照会・照合なし、失敗は loginAttempts にだけ記録。
func TestLoginUsesSharedCredentialCheck(t *testing.T) {
	t.Run("locked", func(t *testing.T) {
		repo := &lookupRepo{memoryRepo: fresh()}
		chk := &recordingChecker{}
		h := NewHandler(repo, WithLoginAttemptLimiter(&recordingLimiter{allow: false}), withPasswordChecker(chk.check))
		w := requestAnon(h, "POST", "/api/auth/login", `{"loginName":"admin","password":"test-password"}`)
		if w.Code != 429 || !strings.Contains(w.Body.String(), msgLoginRateLimited) {
			t.Fatalf("locked login want 429 got %d %s", w.Code, w.Body)
		}
		if repo.calls != 0 || len(chk.hashes) != 0 {
			t.Fatalf("locked must skip lookup/compare: lookups=%d compares=%d", repo.calls, len(chk.hashes))
		}
	})
	t.Run("missing user records on login limiter only", func(t *testing.T) {
		loginLim := &recordingLimiter{allow: true}
		basicLim := &recordingLimiter{allow: true}
		chk := &recordingChecker{}
		h := NewHandler(fresh(), WithLoginAttemptLimiter(loginLim), WithBasicAuthAttemptLimiter(basicLim), withPasswordChecker(chk.check))
		w := requestAnon(h, "POST", "/api/auth/login", `{"loginName":"No-Such","password":"x"}`)
		if w.Code != 401 || !strings.Contains(w.Body.String(), msgLoginFailed) {
			t.Fatalf("want 401 got %d %s", w.Code, w.Body)
		}
		if len(chk.hashes) != 1 || chk.hashes[0] != loginDummyHash {
			t.Fatalf("want one dummy compare, got %d", len(chk.hashes))
		}
		if len(loginLim.failures) != 1 || len(basicLim.allows)+len(basicLim.failures) != 0 {
			t.Fatalf("login failures=%v basic allows=%v failures=%v", loginLim.failures, basicLim.allows, basicLim.failures)
		}
	})
}

// assertRecorded checks got is exactly [key] when want, or empty otherwise.
func assertRecorded(t *testing.T, name string, got []string, want bool, key string) {
	t.Helper()
	if want {
		if len(got) != 1 || got[0] != key {
			t.Fatalf("%s=%v want [%q]", name, got, key)
		}
		return
	}
	if len(got) != 0 {
		t.Fatalf("%s=%v want none", name, got)
	}
}

// A valid session cookie wins: a failing Basic header is never evaluated, so counters do not move.
func TestBasicAuthNotEvaluatedWithValidSession(t *testing.T) {
	lim := &recordingLimiter{allow: true}
	chk := &recordingChecker{}
	h := NewHandler(fresh(), WithBasicAuthAttemptLimiter(lim), withPasswordChecker(chk.check))
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/api/board", nil)
	r.AddCookie(&http.Cookie{Name: SessionCookieName, Value: HandlerTestSessionID})
	r.SetBasicAuth("admin", "wrong")
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("cookie+bad basic=%d %s", w.Code, w.Body)
	}
	if n := len(lim.allows) + len(lim.failures) + len(lim.successes); n != 0 || len(chk.hashes) != 0 {
		t.Fatalf("basic evaluated despite valid session: limiter calls=%d compares=%d", n, len(chk.hashes))
	}
}

// The login-name key is shared across client IPs: 5 failures from A lock that name from B too.
func TestBasicAuthLoginKeyLockAppliesAcrossIPs(t *testing.T) {
	h := NewHandler(fresh())
	for i := 0; i < loginFailureLimit; i++ {
		basicReq(h, "/api/board", "admin", "wrong", "203.0.113.30")
	}
	if w := basicReq(h, "/api/board", "admin", "test-password", "203.0.113.40"); w.Code != 401 {
		t.Fatalf("login-name lock must apply from another IP, got %d", w.Code)
	}
	if w := basicReq(h, "/api/board", "admin", "test-password", ""); w.Code != 401 {
		t.Fatalf("login-name lock must apply from default IP, got %d", w.Code)
	}
}
