# カード 171: 試行制限の接続元 IP を Cloud Run の前段の背後でも利用者ごとに分ける 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** nginx の realip で Cloud Run の前段（169.254.0.0/16）だけを信頼して利用者の IP を復元し、ログイン名のキーを「ログイン名＋接続元 IP」の組にして、他人（別の IP の利用者）の失敗で自分のログインが止まらないようにする。

**Architecture:** `deploy/nginx.conf` の http コンテキストに `set_real_ip_from 169.254.0.0/16; real_ip_header X-Forwarded-For; real_ip_recursive on;` を足す。これで `$remote_addr`（`limit_req` のキーと API への `X-Real-IP`）が利用者の IP になる。`login_rate_limit.go` の `loginAttemptKey` を組のキーにする。ガードスクリプト `scripts/check-nginx-real-ip.sh` で nginx の 3 行を固定する。

**Tech Stack:** nginx 1.28（alpine）、Go（`backend/internal/kanban`）、bash（ガードスクリプト）、GitHub Actions

**設計書:** `docs/superpowers/specs/2026-11-28-card171-client-ip-behind-cloud-run-design.md`

**気をつける知見:** L-1029（信頼境界で確定した IP を使う。前段の背後では real_ip で復元し、実環境の値を確かめる）、L-1028（成功時に IP のキーを消さない）、L-1027（prune は変えない）、L-1354（自動で再送される資格情報によるロック）、L-1355（照合順序。IP のキーが上限を決める）、L-095（フォームと Basic の 2 経路を同じ厳しさでテスト）、L-213（制限の前提を文書に書く。解消していない点を解消済みと書かない）、L-986（並行時の不変条件の限定）。

**検証コマンド:**

```sh
cd backend && gofmt -l internal/kanban/login_rate_limit.go internal/kanban/login_rate_limit_test.go internal/kanban/basic_auth_rate_limit_test.go internal/kanban/auth_handler_test.go
cd backend && go vet ./... && go test ./...
./scripts/check-nginx-real-ip.sh && ./scripts/check-nginx-real-ip.sh --selftest
for s in scripts/check-nginx-*.sh; do bash -n "$s"; "$s" >/dev/null; done
```

`gofmt -l` の出力が空であること（Task 1 に着手する前に同じ `gofmt -l` を実行し、既に出るファイルがあれば、そのファイルは新しく足した関数だけを手で整形する）。

---

## ファイル構成

- 変更: `deploy/nginx.conf` — realip の 3 行
- 新規: `scripts/check-nginx-real-ip.sh` — ガード
- 変更: `.github/workflows/secret-scan.yml` — deploy-guards に追加
- 変更: `README.md` — ガードスクリプトの一覧に追加
- 変更: `backend/internal/kanban/login_rate_limit.go` — 組のキーとコメント
- 変更: `backend/internal/kanban/login_rate_limit_test.go`、`basic_auth_rate_limit_test.go`、`auth_handler_test.go`
- 変更: `SECURITY.md`、`docs/api.md`、`docs/openapi.yaml`

---

### Task 1: ログイン名のキーを「ログイン名＋接続元」の組にする

**Files:**
- Modify: `backend/internal/kanban/login_rate_limit.go`
- Modify: `backend/internal/kanban/login_rate_limit_test.go`

- [x] **Step 1: limiter 単体のテストを先に書き換える**

`TestLoginAttemptLimiterIndependentKeys` を次に置き換える。

```go
func TestLoginAttemptLimiterIndependentKeys(t *testing.T) {
	l := NewMemoryLoginAttemptLimiter()
	now := time.Now().UTC()
	for i := 0; i < loginFailureLimit; i++ {
		l.RecordFailure("alice", "10.0.0.1", now)
	}
	if !l.Allow("alice", "10.0.0.2", now) {
		t.Fatal("login-name lock must not block the same login from another IP")
	}
	if l.Allow("alice", "10.0.0.1", now) {
		t.Fatal("same login+ip should be locked")
	}
	if l.Allow("bob", "10.0.0.1", now) {
		t.Fatal("ip lock should block other logins from same IP")
	}
	if !l.Allow("bob", "10.0.0.2", now) {
		t.Fatal("different login+ip should still allow")
	}
}
```

`TestLoginAttemptLimiterSuccessClearsPairNotIP` を次に置き換える（組のキーの消去は今のしきい値では `Allow` から観測できないので、`byKey` を直接見る）。

```go
func TestLoginAttemptLimiterSuccessClearsPairNotIP(t *testing.T) {
	l := NewMemoryLoginAttemptLimiter().(*memoryLoginAttemptLimiter)
	now := time.Now().UTC()
	const ip = "9.9.9.9"
	for i := 0; i < loginFailureLimit-1; i++ {
		l.RecordFailure("a", ip, now)
	}
	l.RecordSuccess("a", ip)
	if _, ok := l.byKey[loginAttemptKey("a", ip)]; ok {
		t.Fatal("success must clear the login+ip pair key")
	}
	e := l.byKey[ipAttemptKey(ip)]
	if e == nil || e.failures != loginFailureLimit-1 {
		t.Fatalf("IP failures must survive success (L-1028): %+v", e)
	}
	l.RecordFailure("b", ip, now)
	if l.Allow("c", ip, now) {
		t.Fatal("IP should lock on the 5th failure counted across logins")
	}
}
```

- [x] **Step 2: 失敗を確認する**

Run: `cd backend && go test ./internal/kanban -run 'TestLoginAttemptLimiter' -count=1`
Expected: FAIL（`loginAttemptKey` が引数 1 つなのでコンパイルエラー）。

- [x] **Step 3: 実装**

`login_rate_limit.go`:

```go
// LoginAttemptLimiter tracks consecutive failed password attempts per client IP and per
// login-name + client-IP pair (form login and Basic auth use separate instances).
// Keying the login name with the IP means a third party cannot lock someone else's
// login from another address (card 171).
type LoginAttemptLimiter interface {
	Allow(loginKey, ip string, now time.Time) bool
	RecordFailure(loginKey, ip string, now time.Time)
	// RecordSuccess clears the login+IP pair counter only (IP counters stay for NAT shared exits).
	RecordSuccess(loginKey, ip string)
}
```

```go
func loginAttemptKey(loginKey, ip string) string { return "login:" + loginKey + "|" + ip }
```

`Allow` / `RecordFailure` / `RecordSuccess` の `loginAttemptKey(loginKey)` を `loginAttemptKey(loginKey, ip)` にする。`RecordSuccess` の `_ = ip` の行は削除する（ip を使うようになるため）。キーの関数が長くなり直後の `ipAttemptKey` の行の揃えが変わるので、`cd backend && gofmt -w internal/kanban/login_rate_limit.go` を実行する。

- [x] **Step 4: limiter のテストが通ることを確かめる**

Run: `cd backend && go test ./internal/kanban -run 'TestLoginAttemptLimiter' -count=1 -v`
Expected: PASS（この時点では 4 関数。最終形は「実装後の差分」を参照）

---

### Task 2: HTTP の層のテストを新しいキーに合わせる

**Files:**
- Modify: `backend/internal/kanban/basic_auth_rate_limit_test.go`
- Modify: `backend/internal/kanban/auth_handler_test.go`

- [x] **Step 1: Basic のテスト 2 本を置き換える**

`TestBasicAuthLoginKeyLockAppliesAcrossIPs`（とその直前のコメント行）を次に置き換える。

```go
// The login-name lock is keyed with the client IP: 5 failures from A do not lock that name from B (card 171).
func TestBasicAuthLoginNameLockDoesNotSpanIPs(t *testing.T) {
	h := NewHandler(fresh())
	const ipA, ipB = "203.0.113.30", "203.0.113.40"
	for i := 0; i < loginFailureLimit; i++ {
		basicReq(h, "/api/board", "admin", "wrong", ipA)
	}
	if w := basicReq(h, "/api/board", "admin", "test-password", ipB); w.Code != 200 {
		t.Fatalf("another IP must not be locked by A's failures, got %d", w.Code)
	}
	if w := basicReq(h, "/api/board", "admin", "test-password", ipA); w.Code != 401 {
		t.Fatalf("A itself stays locked, got %d", w.Code)
	}
}
```

`TestBasicAuthSuccessClearsLoginKeyNotIP`（とその直前のコメント行）を次に置き換える（IP B の手順は新しいキーでは成功しなくても通るので削る）。

```go
// テスト 6: 成功しても IP のカウンタは残る（L-1028）。組のキーの消去は limiter 単体のテストで確かめる。
// 変更前のキーでも通る回帰テストで、card 171 の新しい挙動を検証するものではない。
func TestBasicAuthSuccessKeepsIPFailures(t *testing.T) {
	h := NewHandler(fresh())
	const ipA = "203.0.113.10"
	for i := 0; i < loginFailureLimit-1; i++ {
		basicReq(h, "/api/board", "admin", "wrong", ipA)
	}
	if w := basicReq(h, "/api/board", "admin", "test-password", ipA); w.Code != 200 {
		t.Fatalf("A success=%d", w.Code)
	}
	basicReq(h, "/api/board", "someone-else", "wrong", ipA)
	if w := basicReq(h, "/api/board", "admin", "test-password", ipA); w.Code != 401 {
		t.Fatalf("IP key must survive success: A=%d", w.Code)
	}
}
```

- [x] **Step 2: フォームのログインのテストを足す**

`auth_handler_test.go` の `TestAuthLoginIPRateLimitBlocksOtherLogin` の直後に追加する。

```go
// 他人（別の IP）の失敗で自分のログインが止まらない（card 171）。Basic の TestBasicAuthLoginNameLockDoesNotSpanIPs と対（L-095）。
func TestAuthLoginLockDoesNotSpanIPs(t *testing.T) {
	h := NewHandler(fresh())
	post := func(ip, password string) int {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"loginName":"admin","password":"`+password+`"}`))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-Real-IP", ip)
		h.ServeHTTP(w, r)
		return w.Code
	}
	for i := 0; i < loginFailureLimit; i++ {
		if c := post("203.0.113.50", "wrong-password"); c != 401 {
			t.Fatalf("fail %d: %d", i+1, c)
		}
	}
	if c := post("203.0.113.60", "test-password"); c != 200 {
		t.Fatalf("another IP must log in, got %d", c)
	}
	if c := post("203.0.113.50", "test-password"); c != 429 {
		t.Fatalf("the failing IP stays locked, got %d", c)
	}
}
```

- [x] **Step 3: 変更前のキーで新しいテストが失敗することを確かめる（任意だが推奨）**

`git stash push -- backend/internal/kanban/login_rate_limit.go` で Task 1 の実装だけを戻すとコンパイルが通らないので、代わりに変異で確かめる:

```sh
cd backend && ~/Desktop/dev-flow-kit/scripts/git/mutation-test.sh K1 internal/kanban/login_rate_limit.go 's/return "login:" \+ loginKey \+ "\|" \+ ip/return "login:" + loginKey/' -- go test ./internal/kanban -run 'TestAuthLoginLockDoesNotSpanIPs|TestBasicAuthLoginNameLockDoesNotSpanIPs|TestLoginAttemptLimiterIndependentKeys' -count=1
```

Expected: `KILLED`

- [x] **Step 4: 検証コマンドの Go の部分を実行し、全件通ることを確かめる**

---

### Task 3: nginx の realip とガードスクリプト

**Files:**
- Modify: `deploy/nginx.conf`（`limit_req_status 429;` の直後）
- Create: `scripts/check-nginx-real-ip.sh`
- Modify: `.github/workflows/secret-scan.yml`、`README.md`

- [x] **Step 1: ガードスクリプトを先に書く（失敗を確認する）**

`scripts/check-nginx-real-ip.sh`（実行権限を付ける）:

```bash
#!/usr/bin/env bash
# Fail if deploy/nginx.conf stops restoring the client IP behind Cloud Run's front end (card 171).
# Usage: ./scripts/check-nginx-real-ip.sh [--selftest] [-h|--help]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

usage() {
  cat <<'EOF'
目的: deploy/nginx.conf が Cloud Run の前段（169.254.0.0/16）だけを信頼して
      X-Forwarded-For から利用者の IP を復元すること（realip の 3 行）を検証する。
使い方:
  ./scripts/check-nginx-real-ip.sh
  ./scripts/check-nginx-real-ip.sh --selftest
EOF
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  --selftest|"") ;;
  *) usage >&2; exit 1 ;;
esac

check_conf() {
  local conf="$1" label="$2"
  [ -f "$conf" ] || { echo "error: missing $label ($conf)" >&2; return 1; }
  local froms
  froms="$(grep -E '^[[:space:]]*set_real_ip_from[[:space:]]' "$conf" | sed -E 's/^[[:space:]]*set_real_ip_from[[:space:]]+([^;[:space:]]+).*/\1/' || true)"
  [ "$froms" = "169.254.0.0/16" ] || {
    echo "error: $label set_real_ip_from must be exactly 169.254.0.0/16 (got: ${froms:-none})" >&2; return 1
  }
  grep -qE '^[[:space:]]*real_ip_header[[:space:]]+X-Forwarded-For;' "$conf" || {
    echo "error: $label missing 'real_ip_header X-Forwarded-For;'" >&2; return 1
  }
  grep -qE '^[[:space:]]*real_ip_recursive[[:space:]]+on;' "$conf" || {
    echo "error: $label missing 'real_ip_recursive on;'" >&2; return 1
  }
  return 0
}

expect_fail() {
  local name="$1" body="$2" t
  t="$(mktemp)"
  printf '%s\n' "$body" >"$t"
  if check_conf "$t" "$name" 2>/dev/null; then
    rm -f "$t"; echo "error: --selftest expected failure: $name" >&2; exit 1
  fi
  rm -f "$t"
}

if [[ "${1:-}" == "--selftest" ]]; then
  ok='set_real_ip_from 169.254.0.0/16;
real_ip_header X-Forwarded-For;
real_ip_recursive on;'
  tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
  printf '%s\n' "$ok" >"$tmp"
  check_conf "$tmp" "selftest-complete" || { echo "error: --selftest expected success" >&2; exit 1; }
  expect_fail "missing-from" 'real_ip_header X-Forwarded-For;
real_ip_recursive on;'
  expect_fail "trust-all" 'set_real_ip_from 0.0.0.0/0;
real_ip_header X-Forwarded-For;
real_ip_recursive on;'
  expect_fail "extra-from" 'set_real_ip_from 169.254.0.0/16;
set_real_ip_from 10.0.0.0/8;
real_ip_header X-Forwarded-For;
real_ip_recursive on;'
  expect_fail "wrong-header" 'set_real_ip_from 169.254.0.0/16;
real_ip_header X-Real-IP;
real_ip_recursive on;'
  expect_fail "recursive-off" 'set_real_ip_from 169.254.0.0/16;
real_ip_header X-Forwarded-For;
real_ip_recursive off;'
  echo "ok: check-nginx-real-ip --selftest"
  exit 0
fi

check_conf "$ROOT/deploy/nginx.conf" "deploy/nginx.conf"
echo "ok: deploy/nginx.conf restores client IP via realip (169.254.0.0/16 only)"
```

Run: `chmod +x scripts/check-nginx-real-ip.sh && bash -n scripts/check-nginx-real-ip.sh && ./scripts/check-nginx-real-ip.sh --selftest && ./scripts/check-nginx-real-ip.sh`
Expected: `--selftest` は ok、本体は FAIL（まだ nginx.conf に 3 行が無い）。

- [x] **Step 2: nginx.conf に 3 行を足す**

`limit_req_status 429;` の直後:

```nginx

# Cloud Run's front end connects from 169.254.0.0/16 (observed: 169.254.169.126 for every
# client) and puts the client IP in X-Forwarded-For. Trust only that hop so $remote_addr
# (limit_req keys, X-Real-IP to the API) is the real client; spoofed left-hand XFF entries
# are skipped by real_ip_recursive. See card 171.
set_real_ip_from 169.254.0.0/16;
real_ip_header X-Forwarded-For;
real_ip_recursive on;
```

Run: `./scripts/check-nginx-real-ip.sh`
Expected: ok

- [x] **Step 3: nginx の構文を確かめる**

```sh
docker run --rm -e PORT=8080 -v "$PWD/deploy/nginx.conf:/etc/nginx/templates/default.conf.template:ro" \
  nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236 \
  sh -c 'envsubst "\$PORT" < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -t && nginx -V 2>&1 | tr " " "\n" | grep realip'
```

Expected: `syntax is ok`、`test is successful`、`--with-http_realip_module`。`/api/` の `proxy_pass` 先が解決できないなどで失敗した場合は、エラーが realip の行に関するものでないことを確かめる。Docker が使えない場合は「未確認」と報告する。

- [x] **Step 4: CI と README に追加する**

`.github/workflows/secret-scan.yml` の deploy-guards の `run:` に、既存の `check-nginx-cache.sh` の各行の直後へ:
- `bash -n scripts/check-nginx-real-ip.sh`
- `./scripts/check-nginx-real-ip.sh`
- `./scripts/check-nginx-real-ip.sh --selftest`

`README.md` 448 行の段落: `./scripts/check-nginx-cache.sh`・ の直後に `./scripts/check-nginx-real-ip.sh`・ を足し、`--selftest` の列挙の「キャッシュ指定は `./scripts/check-nginx-cache.sh --selftest`、」の直後に「接続元 IP の復元は `./scripts/check-nginx-real-ip.sh --selftest`、」を足す。

- [x] **Step 5: 検証コマンドの nginx ガードの部分を実行する**

---

### Task 4: 文書

**Files:**
- Modify: `SECURITY.md`、`docs/api.md`、`docs/openapi.yaml`

- [x] **Step 1: `SECURITY.md`**

- 21 行の表の `(5 failures → 15 min lock per login name and per client IP)` を `(5 failures → 15 min lock per client IP and per login-name + client-IP pair)` にする。
- 既知の制限 1: 次の文だけを削除する。
  `Because the edge Basic user name is \`AUTH_USER\` (the initial admin's login name), the login-name counter for that user is locked too; that key is shared across all client IPs, so that user's CLI Basic (\`-u\`) can get 401 from **any** IP, and a third party can trigger the same lock with 5 wrong Basic attempts.`
  あわせて回避策の `, or use a user other than \`AUTH_USER\` for \`-u\`` も削除する（同じ IP ではどの利用者でもロックされるため意味が無くなる）。
- 既知の制限 4（共有 IP。`- The per-IP key is whatever \`clientIP\` sees:` で始まる項目）を次に置き換える:
  `- The per-IP key comes from nginx: \`deploy/nginx.conf\` trusts only Cloud Run's front end (\`set_real_ip_from 169.254.0.0/16\`, \`real_ip_header X-Forwarded-For\`, \`real_ip_recursive on\`), so \`$remote_addr\` (nginx \`limit_req\` keys and \`X-Real-IP\` to the API) is the real client (production showed \`169.254.169.126\` for every client before this). Clients sharing one egress IP (NAT, office LAN, carrier-grade NAT) still share the lock and the \`limit_req\` budget. If Cloud Run's front-end address range changes, realip stops applying and every client shares one key again; \`scripts/check-nginx-real-ip.sh\` guards the config, and production access logs should be checked after deploying this change (including a request with a spoofed \`X-Forwarded-For\`) and again after platform changes.`
- 既知の制限 5（照合順序。`- The per-login-name key is` で始まる項目）を次に置き換える:
  `- The login-name part of the pair key is \`strings.ToLower(loginName)\`, while \`users.login_name\` uses \`utf8mb4_0900_ai_ci\` (also ignores accents and width). Spelling variants get separate pair counters, but every failure also counts toward the per-IP key, so variants give no extra attempts per IP.`
- 一覧の最後に 1 項目を足す:
  `- There is no per-account cap across IPs: an attacker with many IPs can try one account 5 times per IP per 15 minutes. This was chosen so that nobody can lock someone else's login from another address (card 171).`

- [x] **Step 2: `docs/api.md` 43 行**

- `（ログイン名ごと・接続元 IP ごと。フォームのログインとは別のカウンタ）` → `（接続元 IP ごと、およびログイン名と接続元の組ごと。フォームのログインとは別のカウンタ）`
- `本番では接続元 IP が全利用者で共通になる場合があります（[SECURITY.md](../SECURITY.md) の既知の制限）。` → `同じ出口 IP（NAT など）を共有する利用者どうしはロックを共有します（[SECURITY.md](../SECURITY.md) の既知の制限）。`
- `エッジ Basic のログイン名は \`AUTH_USER\`（初期 admin のログイン名）と同じなので、ロックは接続元 IP だけでなくそのログイン名のカウンタにもかかり、別の接続元からの \`-u\` も 401 になることがあります。その利用者の CLI では \`-b\` を使ってください。` を削除する。

- [x] **Step 3: `docs/openapi.yaml`**

- 3902 行付近の `basicAuth` の説明の `連続 5 回失敗でログイン名・接続元ごとに 15 分ロック（ログインとは別カウンタ）。` → `連続 5 回失敗で接続元 IP ごと（ログイン名と接続元の組を含む）に 15 分ロック（ログインとは別カウンタ）。`
- `/api/auth/login` の説明に「ログイン名ごと」に当たる記述があれば同様に直す（`grep -n "連続失敗" docs/openapi.yaml` で確かめる。無ければ変更しない）。
- `ruby -ryaml -e 'YAML.load_file("docs/openapi.yaml")'` で読み込めることを確かめる。

- [x] **Step 4: 文書に古い記述が残っていないことを確かめる**

Run: `grep -n "ログイン名ごと\|per login name\|from \*\*any\*\* IP\|全利用者で共通になる場合" SECURITY.md docs/api.md docs/openapi.yaml README.md`
Expected: 出力なし

---

## 範囲外（設計書の「決めたこと」より）

- 同じ出口 IP を共有する利用者どうしのロックと `limit_req` の共有。
- デプロイと、デプロイ後の確認（アクセスログの先頭が利用者の IP になったこと、偽の `X-Forwarded-For` を付けても実際の IP のままであること）。ユーザーが行う。
- API の `clientIP` の変更。

---

## 実装後の差分（SRP リファクタリング・ローカルレビュー）

上の Task 1〜4 のコードは初版。最終形は次のとおり。

- `login_rate_limit.go`: IPv6 を /64 に丸める `rateLimitIPBucket` を追加し、`loginAttemptKey(loginKey, ip)` と `ipAttemptKey(ip)` の両方で使う（利用者 1 人が普通は /64 を持つので、アドレスを変えるだけで IP のロックを抜けられないようにする）。IPv4 と IPv4 射影はそのまま、解析できない値は変えない。
- テストを追加: `TestLoginAttemptLimiterSuccessClearsOnlyOwnPair`（成功で消えるのは自分の組だけ）、`TestLoginAttemptLimiterBucketsIPv6By64`、`TestRateLimitIPBucket`。`TestLoginAttemptLimiterSuccessClearsLoginNotIP` は `TestLoginAttemptLimiterSuccessClearsPairNotIP` に改名した。
- `auth_handler_test.go`: フォームのログインのリクエストを組み立てるヘルパー `formLoginReq(h, loginName, password, ip)` を追加し、`TestAuthLoginLockDoesNotSpanIPs` と `TestAuthLoginIPRateLimitBlocksOtherLogin` をそれで書き直した（Task 2 Step 2 の `post` クロージャは使っていない）。
- `scripts/check-nginx-real-ip.sh`: `real_ip_header` / `real_ip_recursive` も「ちょうど 1 行」を検査し（location での上書きを検出）、3 つとも最初の `server {` より前（http レベル）にあることを検査する。`--selftest` に `location-override` と `inside-server` を追加した。エラー文は実際の行（`got:`）や行番号を出す。
- `SECURITY.md`: per-IP key の項目に「アプリのカウンタは IPv6 を /64 で数え、nginx の `limit_req` はアドレス単位のまま」「同じ IPv6 /64 の利用者もロックを共有する」を書いた。`docs/api.md` と `docs/openapi.yaml` にも「IPv6 は /64 ごと」を足した。
- コメントでのカードの参照は既存の慣習に合わせて `#171` とした。

