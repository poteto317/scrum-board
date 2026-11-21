# コメント機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.  
> **Spec:** `docs/superpowers/specs/2026-11-18-item-comments-design.md`  
> **コミットしない**（`/feature`）。知見: L-001, L-002, L-015, L-037, L-040, L-453, L-454, L-790, L-865, L-867

**Goal:** アイテム詳細に Notion 風のフラットなコメント（投稿・編集・削除）を永続化する。

**Architecture:** MySQL `item_comments` + by-number REST。FE は `ItemComments` を履歴の直前に置き、成功応答後のみ一覧を更新。世代ガードでルート切替の stale を捨てる。詳細 live refresh はコメント state を触らない。

**Tech Stack:** Go / MySQL / Angular / vitest

仕様末尾のタスク分割: (1)=Task1、(2)=Task2+3、(3)=Task4。

## Global Constraints

- API は **`/api/items/by-number/{number}/comments` のみ**（内部 ID ルートなし）。
- `author` / `body` は **trim 後**判定。body 空＝400、author 空白のみ＝`""`。制御文字禁止。body ≤4000、author ≤60（Unicode 文字数）。
- 投稿・編集は **楽観一覧更新しない**。成功応答でのみ append／行置換。cancel／destroy 後の遅延成功は適用しない。
- GET 失敗を 0 件成功にしない（L-002）。
- autosave `fields` / `sideFields` に載せない（L-453 / L-790）。
- **コメント CRUD は `item_history` に載せない**（コメント自身が記録。履歴件数は不変）。
- 詳細の **live refresh はコメント signal／DOM を書き換えない**。コメント busy は title autosave busy と独立（L-037）。
- クエリ名は既存どおり **`projectId`**（`project` ではない）。
- `/feature` 中はコミットしない。

## 知見チェック

| ID | Plan での扱い |
|----|----------------|
| L-001 | 失敗で一覧・編集表示を戻す／増やさない |
| L-002 | GET 失敗≠空、author/body 正規化 |
| L-015 | 他画面に UI 無し。コメント追加で既存 item フィールドを落とさない |
| L-037 / L-040 | loadGeneration；number+projectId 一致時のみ適用；live refresh 非干渉；遅延成功破棄 |
| L-453 / L-790 | autosave 非同居。Task3/4 で `fields`/`sideFields` 非追加を確認 |
| L-454 | FE `updateComment` は送るキーだけ（undefined マージ禁止）。サーバ null も 400 |
| L-867 | 楽観一覧はしないため cancel 時の revert 対象なし（該当 としては非該当。遅延成功破棄は L-037） |

## ファイルマップ

| 領域 | パス |
|------|------|
| schema / migrate | Modify: `database/init/001_schema.sql`／Create: `comment_migrate.go`（+test）／Modify: `cmd/server/main.go`／`mysql_test.go` |
| model・repo・handler | Create: `comment.go`（型＋repo CRUD）／Modify: `handler.go`／Create: `comment_handler_test.go` |
| API docs | Modify: `docs/api.md` |
| FE | Modify: `models.ts`／`api.ts`／Create: `item-comments.ts`（+html/css/spec）／Modify: `item-detail.ts`／`.html`／`board-card-structure.spec.ts`／`backlog.spec.ts`／`item-solution.spec.ts`（非表示回帰） |

---

### Task 1: Backend — テーブル・CRUD・docs

**Files:** migrate / `comment.go` / handler / tests / `docs/api.md` / `main.go` / `mysql_test.go` / schema

**Interfaces:**
- `Comment` JSON: `id`, `itemId`, `author`, `body`, `createdAt`, `updatedAt`（時刻は **RFC3339 UTC**）
- `InitializeComments(ctx)` → `CREATE TABLE IF NOT EXISTS item_comments …`
- Repo:
  - `ListComments(ctx, itemID int64) ([]Comment, error)` — 順 **`created_at ASC, id ASC`**
  - `CreateComment(ctx, itemID int64, author, body string) (Comment, error)`
  - `UpdateComment(ctx, itemID, commentID int64, author, body *string) (Comment, error)` — nil ポインタ＝触らない
  - `DeleteComment(ctx, itemID, commentID int64) error` — 食い違い ErrNotFound
- Handler:
  - `GET|POST /api/items/by-number/{number}/comments`
  - `PATCH|DELETE /api/items/by-number/{number}/comments/{id}`（DELETE **204**）
- `projectId` query は既存 by-number 解決と同じ
- コメント操作後に `item_history` 行が増えないこと

- [x] **Step 1: 失敗するテスト**
  - migrate idempotent
  - GET 空配列／作成後 `created_at,id` 古い順；アイテム無し GET → 404
  - POST 省略／空白 author → `""`；author 60 超・制御文字 → 400；body 空・長すぎ・制御文字 → 400
  - PATCH body 空 → 400；author `""` 可；空オブジェクト → 400；null → 400；**author のみ／body のみ**で他方不変
  - 他アイテムの comment id → 404
  - item DELETE で CASCADE（件数 0）
  - コメント CRUD 前後で当該 item の history 件数不変
- [x] **Step 2: RED** — `cd backend && go test ./internal/kanban/ -count=1 -run Comment`
- [x] **Step 3: 実装**
- [x] **Step 4: GREEN** + `docs/api.md` 更新

---

### Task 2: Frontend — 型・Api・ItemComments

**Files:** `models.ts`／`api.ts`／Create `item-comments.ts`／`.html`／`.css`／`.spec.ts`

**挙動:**
- `ItemComment` 型；`normalizeComment` で author/body 常に string
- Api（`HttpClient`、query は `projectId`）:
  - `listComments(number: number, projectId?: number): Observable<ItemComment[]>`
  - `createComment(number, body: { author?: string; body: string }, projectId?: number): Observable<ItemComment>`
  - `updateComment(number, id, patch: { author?: string; body?: string }, projectId?: number): Observable<ItemComment>` — **定義されたキーのみ送信**（L-454）
  - `deleteComment(number, id, projectId?: number): Observable<void>`
- `ItemComments` inputs: `number`, `projectId`（変更で再 GET＋generation++）
- item の PATCH／autosave 経路は使わない（既存フィールドを落とさない。L-015）
- 見出し **「コメント」**。空成功: 「まだコメントはありません。」；GET 失敗: エラー（空文言にしない）
- 時刻表示は既存 history と同様 `date` パイプ。本文は `pre-wrap`
- 投稿フォーム: author + body + 送信。成功で clear + append(response)。保存中 disabled
- 行: 編集（成功で行置換；キャンセルで復元；失敗ロールバック；保存中 disabled）／削除（confirm → 成功で除去；キャンセルで残る）
- 表示名空 →「（無名）」
- **GET／POST／PATCH／DELETE** の成功適用前に世代＋現行 number/project を照合。destroy／cancel 後の遅延成功は適用しない
- live refresh 非干渉（コンポーネント内 state のみ）

- [x] **Step 1: 失敗するテスト**（ng test）
  - 見出し；空成功文言；GET 失敗でエラー
  - 投稿成功で末尾追加・失敗で不変；投稿中 disabled
  - number／project 変更で再 GET；**古い GET と古い mutation 成功を無視**
  - 編集失敗ロールバック；編集キャンセル復元；削除キャンセルで残る；destroy 後遅延成功非適用
- [x] **Step 2: RED**
- [x] **Step 3: 実装**
- [x] **Step 4: GREEN**

---

### Task 3: Frontend — 詳細組み込み・他画面非表示

**Files:** `item-detail.html`／`.ts`／`board-card-structure.spec.ts`／`backlog.spec.ts`／`item-solution.spec.ts`

- [x] **Step 1: 失敗するテスト**
  - 詳細に `app-item-comments` があり `app-item-history` より前
  - ボードカード・バックログ行・ソリューションページにコメント UI／件数ラベルが無い
- [x] **Step 2: RED**
- [x] **Step 3: 実装** — history 直前に配置；`[number]`/`[projectId]` を item から渡す。`item-autosave` の `fields`／`sideFields` に comment キーを足さない
- [x] **Step 4: GREEN** — `rg "sideFields|fields" frontend/src/app/item-autosave.ts` で comment 非含有を確認

---

### Task 4: 全体検証

- [x] **Step 1:** `cd backend && go test ./internal/kanban/ -count=1`（Comment 系 GREEN；MySQL 統合は DSN 無し時 skip）
- [x] **Step 2:** `cd frontend && npx ng test --watch=false`（622 passed）
- [x] **Step 2b:** autosave に comment フィールドが混入していないこと（確認済）
- [ ] **Step 3:** 手動観点（後続 PR 前に確認可）
  - 詳細で投稿→末尾→（無名）→編集→削除
  - GET 失敗時は空文言にならない（DevTools で遮断して確認可）
  - ボード／バックログ／ソリューションにコメント無し
  - 別アイテムへ遷移して一覧入替
  - live refresh 中もコメント一覧が勝手に消えない／混ざらない
  - title／description／favorite／履歴の既存挙動が変わらない

## サブエージェントのレビュー済み

- 第 1 周（要件対応）: history 非記録・live refresh・契約・非表示範囲・テストを追記
- 第 2 周（整合と知見）: `projectId` 統一、Repo/Api シグネチャ、L-015/037/454/867 の扱いを修正
