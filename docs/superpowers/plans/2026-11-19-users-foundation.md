# ユーザー機能の土台 Implementation Plan

> **本フローではコミットしない**（`/feature`）。

**Goal:** ユーザーマスタ＋セッションログイン＋admin 向け `/users` で、後続権限の土台を置く。

**Architecture:** `users` / `sessions`。Go が Cookie セッションを発行。セッション不要は login/logout/purge/public-config/health のみ。nginx Basic 維持。

**Spec:** `docs/superpowers/specs/2026-11-19-users-foundation-design.md`

**Tech Stack:** Go/MySQL、bcrypt、Angular/Vitest

## Global Constraints

- bcrypt cost **10**。秘密をログ／レスポンス／err 文言に出さない（固定文）
- users=0 かつ AUTH 欠如 → 起動失敗。users>0 なら AUTH 欠如でも API 起動可（シードだけスキップ）
- セッション除外: `POST /api/auth/login|logout`、`POST /api/trash/purge`、`GET /api/public-config`、`GET /api/health`
- Cookie `sb_session`: HttpOnly; SameSite=Lax; Path=/; Secure は HTTPS 時のみ; TTL 14 日; DB sessions
- 最後の有効 admin の無効化・member 降格を拒否
- L-002 / L-017 / L-029 / L-037 / L-040 / L-462 / L-669 / L-890
- `/feature` のためコミットしない

## ファイル対応

| ファイル | 責務 |
|---------|------|
| `users_migrate.go` / sessions migrate | DDL |
| `001_schema.sql` / `main.go` / `mysql_test.go` | schema・連鎖 |
| `user*.go` / `auth*.go` / `session*.go` | repo・認証 |
| `handler.go` + middleware | ルート・ガード |
| `login*` / `auth*` / `users*` (FE) | UI |
| `api.ts` / routes / header-menu* / assignee* | 配線 |
| README または deploy コメント | ログイン必須注意（Scheduler スクリプトは触らない） |

---

### Task 1: BE — users/sessions + seed

**Files:** migrate, schema, main.go, mysql_test.go, user repo, tests

- [x] **Step 1: 失敗するテスト**
  - migrate で users/sessions 作成
  - 空＋AUTH → admin 1（bcrypt cost 10）。再実行で増えない。ログに平文パスワード無し
  - AUTH 欠如＋空 → エラー。users>0 かつ AUTH 欠如 → seed は no-op 成功

- [x] **Step 2:** `InitializeUsers` / `InitializeSessions` / `SeedAdminFromEnv` を main と mysql_test 連鎖へ

- [x] **Step 3: `go test` PASS** / **Step 4: コミットしない**

---

### Task 2: BE — auth + middleware

**Files:** auth/session handlers, middleware, tests

- [x] **Step 1: 失敗するテスト**
  - `POST /api/auth/login` body `{loginName,password}` → Cookie `sb_session`（HttpOnly 等）。失敗／disabled → 401 固定文・秘密なし
  - `POST /api/auth/logout` / `GET /api/auth/me`
  - 未ログイン board 401。未ログインで `public-config`・`health`・`purge` は 200 系
  - 無効化でセッション削除

- [x] **Step 2:** ルート配線＋ミドルウェア（除外リストを Global どおり）

- [x] **Step 3: `go test` PASS** / **Step 4: コミットしない**

---

### Task 3: BE — users API

**Files:** users handlers, tests

- [x] **Step 1: 失敗するテスト**
  - `GET /api/users` → `{id,displayName,loginName,role,disabled}[]`（password 無し）
  - `POST /api/users` 必須 loginName,password,displayName。role 省略=member。重複 loginName → 409。必須欠落 → 400
  - `PATCH /api/users/{id}` 任意 displayName/role/disabled/password
  - member → 管理 API 403。最後の admin 無効化・降格・自己無効化 → 400

- [x] **Step 2:** ハンドラを mux に配線

- [x] **Step 3: `go test` PASS** / **Step 4: コミットしない**

---

### Task 4: FE — login / guard / users / assignee / header

**Files:** login, auth, users, api (`withCredentials`), routes, `header-menu.ts` + BE `header_menu.go` + component switch, assignee/item-detail, specs

- [x] **Step 1: 失敗するテスト**
  - `/me` 401 → `/login`。5xx では飛ばない。returnUrl は同一オリジン相対のみ
  - ログイン済 `/login` → ボード。labels / `role="alert"`
  - users: 空≠エラー、generation、作成 in-flight 破棄、ログアウト再ログインで状態クリア
  - admin 管理 UI、member は管理コントロール無し。disabled は一覧にあるが担当では非選択
  - 担当に有効ユーザー＋プリセット＋自由入力
  - `open_users`（label ユーザー、board/backlog/itemDetail）FE catalog + BE ID map + onActionClick。L-669: hydrate 前に prefs 全 PUT しない

- [x] **Step 2: 実装**

- [x] **Step 3: `npx ng test` 関連 PASS** / **Step 4: コミットしない**

---

### Task 5: 手順メモ

- [x] **Step 1:** README または deploy コメントに「アプリログイン必須・MCP/smoke は Cookie」。**`ensure-trash-purge-scheduler.sh` は変更しない**（L-890）
- [x] **Step 2: コミットしない**

---

## プランレビュー

### 第1・2周

対応: public-config/health をセッション除外、Cookie Secure 分岐、users JSON 契約・409/400、returnUrl、disabled 担当、bcrypt/L-017 テスト、mysql_test 連鎖、auth/users ルート明示、header 三箇所名指し、L-669/L-890、作成 in-flight、users>0 時 AUTH 欠如、a11y。
