# カード 170: Basic 認証の経路の試行回数制限 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `userFromBasicAuth` にログインと同じしきい値の試行回数制限（別カウンタ）とダミー照合を入れ、ロック中は DB も bcrypt も触らずに未認証として扱う。

**Architecture:** `handler` に `basicAttempts LoginAttemptLimiter`（既存の `memoryLoginAttemptLimiter`）と `checkPassword func(hash, password string) bool`（既定 `CheckPassword`）を足す。`userFromBasicAuth` は `Allow` → `GetUserByLoginName` → `h.checkPassword(loginPasswordHash(user, err), pass)` → `RecordFailure` / `RecordSuccess` の順にし、`login` ハンドラも `h.checkPassword` を使う。`withSessionAuth` の流れは変えない。

**Tech Stack:** Go（`backend/internal/kanban`、標準 `net/http`、`httptest`）

**設計書:** `docs/superpowers/specs/2026-11-28-card170-basic-auth-rate-limit-design.md`

**気をつける知見:** L-085（不在・無効でもダミー照合し、短絡に戻らないことをテストで固定）、L-1028（成功時は login キーだけ消す）、L-1029（`clientIP` を使い回す）、L-1027（既存リミッタの prune を使い回す）、L-1001（エッジ Basic と admin の分離が別カウンタの理由）、L-986（TOCTOU は範囲外として文書化）、L-213（制限の前提を文書に書く）、L-095（経路間の非対称: ログインへ波及しないことをテスト）。

**検証コマンド（各タスクの最後）:** main の時点で `internal/kanban` の約 37 ファイルが `gofmt -l` に出るため、整形と確認は本カードで変更するファイルだけに絞る。

```sh
cd backend
F="internal/kanban/handler.go internal/kanban/auth_middleware.go internal/kanban/auth_handler.go internal/kanban/basic_auth_rate_limit_test.go"
gofmt -w $(ls $F 2>/dev/null)
test -z "$(gofmt -l $(ls $F 2>/dev/null))"
go vet ./... && go test ./...
```

`handler.go` はもともと桁揃えが崩れているため、ファイル単位の `gofmt -w` で `handler` 構造体と `NewHandler` の既存行も桁揃えし直される。この差分は許容する（他のファイルは整形しない）。

---

## ファイル構成

- 変更: `backend/internal/kanban/handler.go` — フィールド 2 つ、`NewHandler` の既定値、`WithBasicAuthAttemptLimiter`、`withPasswordChecker`
- 変更: `backend/internal/kanban/auth_middleware.go` — `userFromBasicAuth` の書き換え
- 変更: `backend/internal/kanban/auth_handler.go` — `login` の照合を `h.checkPassword` に
- 新規: `backend/internal/kanban/basic_auth_rate_limit_test.go` — 本カードのテスト一式
- 変更: `SECURITY.md`、`docs/api.md` — 制限・既知の制限・回避策

---

### Task 1: handler に Basic 用リミッタと照合関数を足す

**Files:**
- Modify: `backend/internal/kanban/handler.go`（`handler` 構造体の `loginAttempts` の下、`WithLoginAttemptLimiter` の下、`NewHandler` の初期化）
- Modify: `backend/internal/kanban/auth_handler.go:36`

- [x] **Step 1: 構造体にフィールドを足す**

`handler` 構造体の `loginAttempts     LoginAttemptLimiter` の直後に:

```go
	// basicAttempts limits Authorization: Basic failures (same thresholds as login, separate counters
	// so edge Basic resent by browsers cannot lock the login form — L-1001).
	basicAttempts LoginAttemptLimiter
	// checkPassword compares a bcrypt hash; injectable so tests can pin "always compare once" (L-085).
	checkPassword func(hash, password string) bool
```

- [x] **Step 2: Option を足す**

`WithLoginAttemptLimiter` の直後に:

```go
// WithBasicAuthAttemptLimiter injects a custom Basic-auth failure limiter (tests). Nil keeps the current limiter.
func WithBasicAuthAttemptLimiter(l LoginAttemptLimiter) Option {
	return func(h *handler) {
		if l != nil {
			h.basicAttempts = l
		}
	}
}

// withPasswordChecker replaces the bcrypt comparison (package tests only). Nil keeps the current checker.
func withPasswordChecker(f func(hash, password string) bool) Option {
	return func(h *handler) {
		if f != nil {
			h.checkPassword = f
		}
	}
}
```

- [x] **Step 3: `NewHandler` の既定値**

`loginAttempts:     NewMemoryLoginAttemptLimiter(),` の直後に:

```go
		basicAttempts:     NewMemoryLoginAttemptLimiter(),
		checkPassword:     CheckPassword,
```

（`CheckPassword` のシグネチャが `func(hash, password string) bool` であることを `grep -n "func CheckPassword" backend/internal/kanban/*.go` で確かめる。異なれば、フィールドの型をそれに合わせる。）

- [x] **Step 4: `login` の照合を差し替える**

`auth_handler.go` の

```go
	match := CheckPassword(loginPasswordHash(user, err), in.Password)
```

を

```go
	match := h.checkPassword(loginPasswordHash(user, err), in.Password)
```

にする。

- [x] **Step 5: 検証コマンドを実行し、既存テストがすべて通ることを確かめる**

---

### Task 2: テストを先に書く（失敗を確認）

**Files:**
- Create: `backend/internal/kanban/basic_auth_rate_limit_test.go`

接続元は、特記が無ければ `httptest.NewRequest` の既定 `RemoteAddr`（`192.0.2.1:1234`）。IP を変えるときだけ `X-Real-IP` を付ける。`fresh()` の利用者は `admin` / `test-password`（`handler_test.go:71`）。

- [x] **Step 1: テストファイルを書く**

```go
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

// Fakes below are read by tests without locking only after ServeHTTP returns (sequential tests).

// recordingLimiter records calls; allow decides Allow's result.
type recordingLimiter struct {
	mu       sync.Mutex
	allow    bool
	allows   []string
	failures []string
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
```

（`handler` の `repo` フィールドの型が `Repository` インターフェースで、`*lookupRepo` が `*memoryRepo` の埋め込みでそれを満たすことを `go vet` で確かめる。`ViewAccessPublic`・`repo.cards`・`CreateItem` は `auth_handler_test.go` の `TestSessionOptionalBasicAuth` と同じ使い方。）

- [x] **Step 2: 失敗を確認する**

Run: `cd backend && go test ./internal/kanban -run 'TestBasicAuth' -count=1`
Expected: FAIL（ロックされない、照合が 0 回、`RecordFailure` が記録されない など）。`TestBasicAuthEmptyCredentialsNotCounted` と `TestBasicAuthLockedPublicItemStillAnonymous` は現状でも通ってよい。

---

### Task 3: `userFromBasicAuth` を書き換える

**Files:**
- Modify: `backend/internal/kanban/auth_middleware.go:84-99`

- [x] **Step 1: 実装**

```go
// userFromBasicAuth accepts Authorization Basic when it matches a users row.
// Browsers (Sec-Fetch-Site) are included: mobile Safari resends nginx Basic on
// XHR; ignoring it forced a second login form that many clients never POST.
// Edge Basic that differs from the app password still fails CheckPassword (L-1001).
// Failures are rate limited like POST /api/auth/login but on separate counters
// (h.basicAttempts) so resent edge Basic cannot lock the login form.
func (h handler) userFromBasicAuth(r *http.Request) (User, bool) {
	userName, pass, ok := r.BasicAuth()
	loginName := strings.TrimSpace(userName)
	if !ok || loginName == "" || pass == "" {
		return User{}, false
	}
	loginKey := strings.ToLower(loginName)
	ip := clientIP(r)
	now := time.Now().UTC()
	if !h.basicAttempts.Allow(loginKey, ip, now) {
		return User{}, false // locked: no DB lookup, no bcrypt
	}
	user, err := h.repo.GetUserByLoginName(r.Context(), loginName)
	okUser := err == nil && !user.Disabled
	// Always compare (dummy hash when missing/disabled/lookup error) before branching — do not short-circuit (L-085).
	match := h.checkPassword(loginPasswordHash(user, err), pass)
	if !okUser || !match {
		h.basicAttempts.RecordFailure(loginKey, ip, now)
		return User{}, false
	}
	h.basicAttempts.RecordSuccess(loginKey, ip)
	return user, true
}
```

`time` は既に import 済み（`withSessionAuth` で使用）。

- [x] **Step 2: Task 2 のテストが通ることを確かめる**

Run: `cd backend && go test ./internal/kanban -run 'TestBasicAuth' -count=1 -v`
Expected: PASS（全 7 関数）

- [x] **Step 3: 検証コマンドで既存テスト（`TestSessionMiddlewareBasicAuth`、`TestSessionOptionalBasicAuth`、ログイン系）を含めて全件通ることを確かめる**

---

### Task 4: 文書

**Files:**
- Modify: `SECURITY.md:21`（App HTTP Basic の行）と、同ファイルの既知の制限を書く箇所（無ければ表の直後に「Known limitations」小節を足す）
- Modify: `docs/api.md` の「## 非規範の curl 例」直下の段落（現在 41 行目）

- [x] **Step 1: `SECURITY.md`**

App HTTP Basic の行の説明の末尾に追記:

```text
; failures are rate limited like `POST /api/auth/login` (5 failures → 15 min lock per login name and per client IP) on **separate counters**, and a missing/disabled user still runs a dummy bcrypt compare
```

既知の制限として次の 2 点を英語で書く（既存の文体に合わせる）:

1. If browsers resend cached edge Basic to `/api/`, the client IP can get Basic-locked for 15 minutes; CLI users behind the same IP then get 401 with correct app credentials. Workaround: `POST /api/auth/login` and send the `sb_session` cookie (`-b`). The login form is not affected.
2. `Allow` and `RecordFailure` run in separate critical sections with DB + bcrypt in between, so concurrent requests can exceed 5 attempts before the lock (L-986). The effective ceiling per burst is nginx `api_login` (1r/s, burst 5) for login and `api_general` (10r/s, burst 20) for Basic.

- [x] **Step 2: `docs/api.md`**

「## 非規範の curl 例」直下の段落（「ローカル（`http://127.0.0.1:4200`）。本番では nginx の Basic が…」）の直後に追記:

```markdown
`-u` の Basic も、ログインと同じく 5 回失敗で 15 分ロックされます（ログイン名ごと・接続元 IP ごと。フォームのログインとは別のカウンタ）。ロック中は正しいパスワードでも 401 です。同じ接続元のブラウザがエッジ Basic を `/api/` に送り続けてロックされた場合は、`POST /api/auth/login` で得た `sb_session` Cookie を `-b` で送ってください。
```

- [x] **Step 3: 検証コマンドを実行する**

---

## 範囲外（設計書の「決めたこと」より）

- `Allow` と記録の TOCTOU の修正（L-986）: リミッタのインターフェースを変えてログインにも波及するため。`SECURITY.md` に既知の制限として書く。
- 複数インスタンス間のカウンタ共有。
- 応答時間の計測テスト（照合回数とハッシュの受け渡しで構造的に固定する）。

---

## 実装後の差分（SRP リファクタリング・ローカルレビュー・PR レビュー）

上の Architecture・Task 1 Step 4・Task 3 のコードは集約前の形。最終形は次のとおり。

- `auth_handler.go` に共通関数 `verifyCredentials(r, limiter, loginName, password, now) (User, credentialResult)` と `credentialAccepted` / `credentialRejected` / `credentialLocked` を追加し、「Allow → 照会 → ダミー照合 1 回 → RecordFailure / RecordSuccess」をここに集約した。
- `login` は取り出し・401 / 429・セッション発行だけ、`userFromBasicAuth` は Basic の取り出しと `result == credentialAccepted` の変換だけになった。
- テストを 2 件追加: `TestVerifyCredentialsOutcomes`（共通関数を直接呼び、ロック・不在・無効・DB エラー・誤パスワード・成功の各ケースで照会回数・照合回数・ダミーハッシュ・記録キーを確認）、`TestLoginUsesSharedCredentialCheck`（login のロック中 429 で照会・照合なし、失敗は `loginAttempts` にだけ記録）。
- `SECURITY.md` の既知の制限は、Cloud Run での共有 IP と、ログイン名キーと照合順序（`utf8mb4_0900_ai_ci`）の不一致を加えて 5 点にした。`docs/openapi.yaml` の `basicAuth` の説明にもロックを書いた。
- PR レビューでテストを 2 件追加: `TestBasicAuthNotEvaluatedWithValidSession`（有効な Cookie があれば失敗する Basic を評価せず、カウンタも進まない）、`TestBasicAuthLoginKeyLockAppliesAcrossIPs`（ログイン名のロックが接続元をまたぐ）。あわせて `SECURITY.md` と `docs/api.md` の既知の制限 1 に、エッジ Basic の再送で `AUTH_USER` のログイン名のカウンタも全接続元でロックされることと、回避策（Cookie、または `AUTH_USER` 以外の利用者）を書いた。`docs/openapi.yaml` の `sessionOptional` の経路と冒頭の `Sec-Fetch-Site` の記述も実装に合わせた。
