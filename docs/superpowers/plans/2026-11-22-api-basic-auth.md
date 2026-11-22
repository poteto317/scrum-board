# API Basic 認証（セッションと併用） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cookie 無しでも `Authorization: Basic`（users の login/password）でセッション必須 API を処理できるようにする。

**Architecture:** `withSessionAuth` で有効 Cookie を優先し、無ければ／無効なら `basicAuthEligible`（`Sec-Fetch-Site` ヘッダ無し）のときだけ Basic を `GetUserByLoginName` + `CheckPassword` で検証して `CurrentUser` を載せる。Basic 成功時はセッションを発行しない。nginx Basic ゲートは触らない。

**Tech Stack:** Go `net/http`（`BasicAuth`）、既存 bcrypt/`users`、httptest、OpenAPI 3.1

**Spec:** `docs/superpowers/specs/2026-11-22-api-basic-auth-design.md`

## Global Constraints

- 有効 Cookie があるときは Basic を見ない
- `Sec-Fetch-Site` ヘッダがあるリクエスト（ブラウザ）は Basic を無視（`basicAuthEligible`）
- Basic 成功時に `CreateSession` / `Set-Cookie` しない
- 必須経路の失敗は常に 401 + `msgLoginRequired`（`msgLoginFailed` に寄せない）
- `sessionExempt` / `sessionOptional` の集合は変えない
- 平文パスワード・`err.Error()` をログ／レスポンスに出さない
- OpenAPI／README を実装と同じ変更で更新（`update-api-doc`）

---

## File map

| File | Responsibility |
|------|----------------|
| `backend/internal/kanban/auth_middleware.go` | Basic フォールバック、`basicAuthEligible`、 `userFromBasicAuth` |
| `backend/internal/kanban/auth_handler_test.go` | Basic 認証の HTTP テスト（既存 auth テストと同ファイル） |
| `backend/internal/kanban/handler_test.go` | 任意: `requestWithBasic` ヘルパー |
| `docs/openapi.yaml` | `basicAuth` scheme と必須 operation の security OR |
| `README.md` | 認証説明・本番 curl 例を Basic のみ可に更新 |

---

### Task 1: Middleware — Basic で API 認証

**Files:**
- Modify: `backend/internal/kanban/auth_middleware.go`
- Modify: `backend/internal/kanban/handler_test.go`（`requestWithBasic`）
- Modify: `backend/internal/kanban/auth_handler_test.go`
- Test: `backend/internal/kanban/auth_handler_test.go`

**Interfaces:**
- Consumes: `GetUserByLoginName`, `CheckPassword`, `CurrentUser` / `withUser`, `msgLoginRequired`, `sessionExempt`, `sessionOptional`, `UserBySessionID`
- Produces: `withSessionAuth` が Basic 成功時に `CurrentUser` 付きで `next` を呼ぶ（Cookie 発行なし）

- [x] **Step 1: Write the failing tests**

`handler_test.go` にヘルパーを追加:

```go
func requestWithBasic(h http.Handler, method, path, body, user, pass string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.SetBasicAuth(user, pass)
	h.ServeHTTP(w, r)
	return w
}
```

`auth_handler_test.go` に追加:

```go
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
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test ./internal/kanban/ -run TestSessionMiddlewareBasicAuth -count=1`

Expected: FAIL（Basic 未実装のため board/me が 401）

- [x] **Step 3: Implement Basic fallback in `withSessionAuth`**

In `auth_middleware.go`, replace the cookie-only body of `withSessionAuth` with:

1. `sessionExempt` → `next`（変更なし）
2. Cookie があり `UserBySessionID` 成功 → `withUser` して `next`（Basic を見ない）
3. それ以外で `basicAuthEligible` かつ `userFromBasicAuth` 成功 → `withUser` して `next`（Cookie をセットしない）
4. `sessionOptional` → 匿名で `next`
5. それ以外 → 401 + `msgLoginRequired`

Add helper on `handler`:

```go
func basicAuthEligible(r *http.Request) bool {
	return r.Header.Get("Sec-Fetch-Site") == ""
}

func (h handler) userFromBasicAuth(r *http.Request) (User, bool) {
	if !basicAuthEligible(r) {
		return User{}, false
	}
	userName, pass, ok := r.BasicAuth()
	if !ok || strings.TrimSpace(userName) == "" || pass == "" {
		return User{}, false
	}
	user, err := h.repo.GetUserByLoginName(r.Context(), strings.TrimSpace(userName))
	if err != nil || user.Disabled || !CheckPassword(user.PasswordHash, pass) {
		return User{}, false
	}
	return user, true
}
```

Invalid cookie must fall through to Basic（有効 Cookie のときだけ Cookie 専用）。

- [x] **Step 4: Run tests to verify they pass**

Run: `cd backend && go test ./internal/kanban/ -run 'TestSessionMiddlewareBasicAuth|TestSessionMiddlewareExemptAndRequired|TestAuthLoginLogoutMe' -count=1`

Expected: PASS

Run: `cd backend && go test ./internal/kanban/ -count=1`

Expected: PASS（回帰なし）

- [x] **Step 5: Commit**

```bash
git add backend/internal/kanban/auth_middleware.go \
  backend/internal/kanban/auth_handler_test.go \
  backend/internal/kanban/handler_test.go
git commit -m "$(cat <<'EOF'
feat(auth): accept HTTP Basic for session-required APIs

Agents using curl -u / netrc can call the API without a login cookie.
EOF
)"
```

---

### Task 2: OpenAPI + README を契約に合わせる

**Files:**
- Modify: `docs/openapi.yaml`
- Modify: `README.md`（認証段落・本番 curl 例）
- Skill: `.cursor/skills/update-api-doc/SKILL.md` に従う（`EXEMPT`/`OPTIONAL` 集合は変更しない）

**Interfaces:**
- Consumes: Task 1 の「Cookie または Basic（`Sec-Fetch-Site` 無しの非ブラウザ）」
- Produces: OpenAPI 上の `basicAuth` + 必須 operation の OR security

- [x] **Step 1: Add `basicAuth` and OR it with `cookieAuth` on required operations**

In `components.securitySchemes`:

```yaml
    basicAuth:
      type: http
      scheme: basic
      description: users テーブルの login_name / password。Cookie が無いとき、`Sec-Fetch-Site` ヘッダ無しの非ブラウザ向けにミドルウェアが検証する（セッションは発行しない）。本番 nginx Basic（AUTH_*）とは別
```

For every path that currently has only:

```yaml
      security:
      - cookieAuth: []
```

change to:

```yaml
      security:
      - cookieAuth: []
      - basicAuth: []
```

Do **not** change `security: []` on exempt/optional operations. Keep nginx gateway Basic out of operation `security`（info/servers の説明のみ）。

Update `info.description` に一文: アプリ認証は Cookie `sb_session` または HTTP Basic（users、`Sec-Fetch-Site` 無しの非ブラウザ）のどちらか。

- [x] **Step 2: Update README auth copy**

`README.md` 冒頭の「認証について」を、一般 API が Cookie **または** users の Basic（`Sec-Fetch-Site` 無しの非ブラウザ）で通る旨に直す（「Basic に加えてセッション必須」を削除）。

本番「動作確認」の curl 例に、Cookie 無しの一行を足す:

```sh
# アプリ Basic（users）のみでも可（本番は手前に nginx Basic もある）
curl -sS -u "$AUTH_USER:$AUTH_PASSWORD" "$SERVICE_URL/api/board" | head
```

既存の login→Cookie 例は残してよい（ブラウザ本線の説明として）。

- [x] **Step 3: Verify openapi route check if present**

Run: `python3 scripts/check-openapi-routes.py`（リポジトリに存在するとき）

Expected: PASS（EXEMPT/OPTIONAL 未変更なら差分は security scheme のみでスクリプトが通る）

- [x] **Step 4: Commit**

```bash
git add docs/openapi.yaml README.md
git commit -m "$(cat <<'EOF'
docs(api): document Cookie or Basic for app auth

Keep OpenAPI and README aligned with middleware Basic fallback.
EOF
)"
```

---

## Self-review (plan vs spec)

| Spec AC | Task |
|---------|------|
| 1 Basic で board 200 | Task 1 tests + impl |
| 2 検証順・401 msgLoginRequired | Task 1 `basicAuthEligible` + `userFromBasicAuth` |
| 3 有効 Cookie 優先 | Task 1 cookie+wrong Basic test |
| 4 セッション非発行 | Task 1 Set-Cookie 断言 |
| 5 exempt/optional 不変 | Task 1 既存テスト再実行 |
| 6 nginx / login 不破壊 | コード非変更 + 既存 login テスト |
| 7 単体テスト一覧 | Task 1 |
| 8 OpenAPI / README | Task 2 |
