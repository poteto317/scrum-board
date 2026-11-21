# AI 利用上限・残量 API（#51）Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. Commit は `/feature` 中はしない。

**Goal:** アプリ内トークン上限の保存と残量 API、超過時の AI 呼び出し拒否を実装する。

**Architecture:** `ai_usage` に `limit_tokens` を追加。`GET/PUT /api/ai/credits` を追加。ai-chat／refined はセマフォ取得前に上限チェック。

**Tech Stack:** Go（kanban）、MySQL、OpenAPI、既存テストパターン（`ai_chat_handler_test.go`）

**Design:** `docs/superpowers/specs/2026-11-21-ai-credits-limit-design.md`

**知見:** L-001, L-044, L-017, OpenAPI 正本（update-api-doc skill）

**Commits:** `/feature` 中はコミットしない。

---

### Task 1: スキーマとリポジトリ

- [x] **Step 1:** `database/init/001_schema.sql` の `ai_usage` に `limit_tokens BIGINT NULL` を追加
- [x] **Step 2:** `ai_chat_migrate.go` の DDL を同期。既存 DB 向けに `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 相当（プロジェクト既存の migrate 流儀に合わせる）で `limit_tokens` を冪等追加
- [x] **Step 3:** `AIUsage` に `LimitTokens *int64`。`GetAIUsage` が読む。`SetAICreditLimit(ctx, limit *int64) error` を Repository／MySQL／memory に追加
- [x] **Step 4:** リポジトリテスト: 未設定→設定→解除、加算後の used と整合

---

### Task 2: credits ハンドラと超過ガード

- [x] **Step 1:** 純関数 `BuildAICreditsView(usage AIUsage, configured bool)` → `limitTokens` / `usedTokens` / `remainingTokens` / `unlimited` / `approximate`(常 true) / `period`(`cumulative`) / `configured`(キー有無)
- [x] **Step 2:** `GET /api/ai/credits`（ログイン）、`PUT /api/ai/credits`（admin）。DisallowUnknownFields。PUT 本文は sprint velocity と同様 **`limitTokens` を `json.RawMessage`** で受け、キー無し（`{}`）→400、`null`→解除、数値→設定（負・非整数 400）。成功 200＋GET 同形
- [x] **Step 3:** `ensureAICreditAvailable`: 上限ありかつ used>=limit なら false。`postAIChat` **と** `createRefinedItem` の両方でセマフォ前に呼び、429 `ai_credit_limit`
- [x] **Step 4:** handler テスト（必須ケース）:
  - GET: 未ログイン 401／member 200
  - GET ビュー: 未設定 → `unlimited:true`・`limitTokens`/`remainingTokens` null；超過 → `remainingTokens:0`；境界 limit==used → remaining 0
  - PUT: member 403／admin 設定 200（`limitTokens` と `configured` を断言）／admin 解除（null）200・`unlimited:true`／負数・空・未知フィールド 400
  - 429: **ai-chat POST と refined POST の両方**で limit==used 時 `code=ai_credit_limit`；unlimited では拒否しない；`ai_busy` と code 分離

---

### Task 3: OpenAPI

- [x] **Step 1:** `docs/openapi.yaml` に `/api/ai/credits` GET/PUT を追加（update-api-doc skill）
- [x] **Step 2:** `scripts/check-openapi-routes.py` が通ることを確認（ルート登録と一致）

---

### Task 4: 検証

- [x] **Step 1:** `cd backend && go test ./internal/kanban/ -count=1`（関連パッケージ）
- [x] **Step 2:** OpenAPI ルートチェックがあれば実行
- [x] **Step 3:** FE／settings は変更しないことを `git diff` で確認

---

## レビュー記録

- 第1周（要件対応）: GET 三態・解除・両 EP 429・PUT 400／成功フィールドをテスト手順に追記
- 第2周（タスク整合）: PUT の `limitTokens` を RawMessage 三態（無し／null／数値）と明記
- 結果: 妨げ解消。プラン確定
