# ログイン／Basic 試行制限 実装プラン

> **For agentic workers:** タスクは順に実施。各タスクの Steps / 完了条件を満たしてから次へ。コミットはしない（feature 手順）。

**Goal:** #95 — ログイン連続失敗のロック、失敗応答のタイミング均一化、最低パスワード長 8、nginx `limit_req`、`production-deploy-status.md` の秘匿スクラブ、OpenAPI 同期。

**Architecture:** プロセス内 `LoginAttemptLimiter` を `handler` に保持。`handler.login` で空入力は従来どおり即 401、それ以外は Allow → 常に bcrypt（不在／無効はダミーハッシュ）→ 失敗 RecordFailure / 成功 RecordSuccess。nginx は同一 `deploy/nginx.conf` に zone＋limit_req。

**Tech Stack:** Go 1.26、bcrypt、nginx 1.28（コンテナ）、OpenAPI 3.1

**設計書:** `docs/superpowers/specs/2026-11-22-login-rate-limit-design.md`

**知見:** L-085（列挙手がかり）、L-974（OpenAPI に 429／パスワード長）

**Global Constraints:**

- feature では git commit しない
- 空 login/password はカウント・bcrypt 対象外（即 401 `msgLoginFailed`）
- 401 メッセージは `msgLoginFailed` のまま変更しない
- 429 は `{"message": msgLoginRateLimited}`
- DB 照会は trim のみ（大小文字区別）。ロックキーだけ ToLower
- ロック発火時 failures=0、解除後は再び 5 回で再ロック
- SeedAdminFromEnv も MinPasswordLength を適用（短すぎれば ErrAuthSeed）

---

### Task 1: LoginAttemptLimiter

**Files:**
- Create: `backend/internal/kanban/login_rate_limit.go`
- Create: `backend/internal/kanban/login_rate_limit_test.go`

**Steps:**
1. インターフェースとメモリ実装（5 回 / 15 分、login+ip キー、RecordSuccess で削除、ロック時 failures=0）
2. 単体テスト: 閾値・時間経過復帰・**解除後に再び 5 回失敗で再ロック**・Success クリア・キー独立

**完了条件:** `go test ./internal/kanban/ -run LoginAttempt -count=1` 成功（再ロックケース含む）

---

### Task 2: handler.login 改修

**Files:**
- Modify: `backend/internal/kanban/handler.go`（`loginAttempts` フィールド、`NewHandler` でデフォルト生成）
- Modify: `backend/internal/kanban/auth_handler.go`（フロー改修、`clientIP`、ダミーハッシュ）
- Modify: `backend/internal/kanban/auth_middleware.go`（`msgLoginRateLimited` 定数）
- Modify: `backend/internal/kanban/auth_handler_test.go`（429・ダミー経路・無効ユーザー）

**Steps:**
1. `loginDummyHash` を `init` で `BcryptCost` 生成
2. `login` を設計書 §2 どおり実装
3. テスト追加: 存在しないユーザー経路、ロック中 429、**無効ユーザー＋正しいパスワード → 401 かつ body に `msgLoginFailed`**。既存 `TestAuthLoginLogoutMe` 等を通す

**完了条件:** `go test ./internal/kanban/ -run 'Auth|Login' -count=1` 成功

---

### Task 3: MinPasswordLength

**Files:**
- Modify: `backend/internal/kanban/user.go`（定数、共有 `validatePasswordLength`、`validateUserCreate`、MySQL `UpdateUser`）
- Modify: `backend/internal/kanban/users_memory_test.go`（`memoryRepo.UpdateUser` でも同じ `validatePasswordLength` を呼ぶ。Create は既存どおり `validateUserCreate` 経由）
- Modify: `backend/internal/kanban/users_handler_test.go`（重複は 8 文字以上、短パスワード 400）

**Steps:**
1. `MinPasswordLength = 8` と `validatePasswordLength`（空は従来どおり別チェック、非空で rune 長 < 8 なら `ErrInvalidUserInput`）
2. `validateUserCreate`・MySQL `UpdateUser`・`memoryRepo.UpdateUser` のすべてで共有関数を使う（handler テストは memoryRepo 経由）
3. `TestUsersAPIListCreatePatch` の dup `password:"x"` を 8 文字以上に変更
4. 追加テスト: Create 7 文字→400 / Create 8 文字→成功、Patch 7 文字→400 / Patch 8 文字→成功

**完了条件:** `go test ./internal/kanban/ -run UsersAPI -count=1` 成功

---

### Task 4: nginx limit_req

**Files:**
- Modify: `deploy/nginx.conf`

**Steps:**
1. `map` 付近に `limit_req_zone $binary_remote_addr zone=api_general:10m rate=10r/s;`、`zone=api_login:10m rate=1r/s;`、`limit_req_status 429;`
2. `location = /api/auth/login` を `/api/` より前に追加（proxy 設定は `/api/` と同様＋`limit_req zone=api_login burst=5 nodelay`）
3. `/api/` に `limit_req zone=api_general burst=20 nodelay`

**完了条件:** `nginx.conf` に上記 rate・zone 名・両 location・`limit_req_status 429` があること

---

### Task 5: ドキュメントスクラブ

**Files:**
- Modify: `docs/production-deploy-status.md`

**Steps:**
1. 公開 URL・Basic ユーザーをプレースホルダ化
2. リポジトリ外管理の一文を追加

**完了条件:** 実 URL `scrum-board-jkcejsb6ka-an.a.run.app` と Basic ユーザー `kanban` がファイルに残っていない

---

### Task 6: OpenAPI（L-974）

**Files:**
- Modify: `docs/openapi.yaml`

**Steps:**
1. `/api/auth/login` に 429＋Error、説明に連続失敗ロック
2. users POST/PATCH の 400 説明にパスワード 8 文字未満を追記（requestBody が JsonValue のままなら description で足りる）

**完了条件:** login に 429、users にパスワード長の記載がある

---

### Task 7: 全体検証

**Steps:**
1. `cd backend && go test ./internal/kanban/ -count=1`
2. 失敗があれば修正して再実行

**完了条件:** 上記テスト成功。コミットしない
