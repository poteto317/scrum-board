# 繰り返し動的日付（#136）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 繰り返しルールの title/description 内の `{{weekStart}}` / `{{date}}` を run 時に展開して起票する（日曜週・ルール TZ・基準時刻は run の `now`）。

**Architecture:** 純関数 `expandRecurringText` で置換し、`runOneRecurringRule` が `shouldFire` 成功後に同じ `now` と location で title/description を展開してから `createItemInTx`。CRUD はテンプレをそのまま保存。UI はヒントのみ。OpenAPI は rule の title/description 説明を更新。

**Tech Stack:** Go（backend/internal/kanban）、Angular recurring UI、docs/openapi.yaml

**Spec:** `docs/superpowers/specs/2026-11-23-recurring-dynamic-dates-design.md`

**知見:** L-044（未知トークンをマップしない）、L-203（OpenAPI + UI）

## ファイル担当

| ファイル | 責務 |
| --- | --- |
| `backend/internal/kanban/recurring_expand.go`（新規） | `expandRecurringText` と両 Run 共有の `materializeRecurringFire`（TZ・展開・valid） |
| `backend/internal/kanban/recurring_expand_test.go`（新規） | 展開の単体テスト |
| `backend/internal/kanban/recurring_run.go` | MySQL `runOneRecurringRule` で create 前に展開＋validTitle/validDescription |
| `backend/internal/kanban/recurring_memory_test.go` | テスト用 `memoryRepo.RunRecurring` も同じ展開・検証（handler テストがここを通る） |
| `backend/internal/kanban/recurring_handler_test.go` | run 後の作成 title が展開済みであること |
| `backend/internal/kanban/recurring_integration_test.go` | 静的 title 断言を展開後に合わせる／プレースホルダケース追加 |
| `frontend/src/app/recurring.html` | ヒント文言 |
| `frontend/src/app/recurring.spec.ts` | ヒントに `{{weekStart}}` / `{{date}}` が含まれることを検証（必須） |
| `docs/openapi.yaml` | RecurringRule title/description 説明 |

---

### Task 1: 展開純関数（TDD）

**Files:**
- Create: `backend/internal/kanban/recurring_expand.go`
- Create: `backend/internal/kanban/recurring_expand_test.go`

- [x] **Step 1: 失敗するテストを書く**

`expandRecurringText` について少なくとも:

1. 火曜 09:00 Asia/Tokyo → `{{weekStart}}` = その週の日曜 `YYYY-MM-DD`
2. 同じ週の土曜 → 同じ `weekStart`
3. `{{date}}` = `at` のローカル日付
4. description 相当の長い文字列でも両トークン置換
5. `{{ weekStart }}` / `{{WeekStart}}` / `{{unknown}}` / 未閉じ `{{weekStart` は残る
6. プレースホルダ無しは不変
7. TZ 跨ぎ（例: UTC 月曜直前と Asia/Tokyo でローカル曜日が違う `at`）で `weekStart`/`date` が loc 基準になる

- [x] **Step 2: テスト実行（失敗を確認）**

```bash
cd backend && go test ./internal/kanban/ -count=1 -run ExpandRecurring
```

- [x] **Step 3: 最小実装**

```go
// expandRecurringText replaces exact {{weekStart}} and {{date}} using at in loc.
// Unknown {{...}} left unchanged. Week starts Sunday in loc.
func expandRecurringText(template string, at time.Time, loc *time.Location) string
```

- [x] **Step 4: テスト再実行（成功）**

```bash
cd backend && go test ./internal/kanban/ -count=1 -run ExpandRecurring
```

---

### Task 2: RunRecurring 配線（MySQL + memory）

**Files:**
- Modify: `backend/internal/kanban/recurring_run.go`
- Modify: `backend/internal/kanban/recurring_memory_test.go`
- Modify: `backend/internal/kanban/recurring_handler_test.go`
- Modify: `backend/internal/kanban/recurring_integration_test.go`

- [x] **Step 1: 両 Run 経路で `shouldFire` 成功後に同じ手順**

  1. `time.LoadLocation(rule.Timezone)`（shouldFire 成功後は通常成功。失敗なら `failed++` で create しない）
  2. `expandRecurringText` で title/description
  3. **`validTitle` / `validDescription` を create 前に呼ぶ**（超過・不正なら create せず `failed++`。DB 制約任せにしない）
  4. 展開・検証済み文字列で `createItemInTx` / `CreateItem`

  可能なら小ヘルパーにまとめて MySQL と memory で共有。

- [x] **Step 2: 展開後 title が `validTitle` 上限を超えるルールで `failed++`・アイテム未作成になるテスト（memory 経路で可）**

- [x] **Step 3: handler/`RunRecurring` でプレースホルダ付きルール → 作成アイテム title/description が展開済み（`{{weekStart}}` が残らない）。integration の静的 title 断言も必要なら更新**

- [x] **Step 4: 関連テスト**

```bash
cd backend && go test ./internal/kanban/ -count=1 -run 'Recurring|Expand'
```

---

### Task 3: OpenAPI + UI ヒント

**Files:**
- Modify: `docs/openapi.yaml`（`/api/recurring-rules` の JsonValue を具体化し、title/description 説明に三点セット）
- Modify: `frontend/src/app/recurring.html`
- Modify: `frontend/src/app/recurring.spec.ts`（ヒント必須）

- [x] **Step 1: OpenAPI** — POST/PATCH requestBody と一覧・単体応答の rule オブジェクトで `title`/`description` に (1) トークン意味 (2) run 時のみ展開 (3) 未知 `{{...}}` は正規化せず残す（L-044・L-203）。`JsonValue` のまま説明だけ足すのは不可。`update-api-doc` スキルに従う。

- [x] **Step 2: 起票タイトル入力の直下と起票説明の直下の両方に、トークン一覧（`{{weekStart}}`・`{{date}}`）と例（`週次レビュー {{weekStart}}`）のヒントを出す**

- [x] **Step 3: FE テストでヒントに両トークンが含まれることを検証**

```bash
cd frontend && npm test -- --include=src/app/recurring.spec.ts
```

---

### Task 4: 通し検証

- [x] **Step 1:**

```bash
cd backend && go test ./internal/kanban/ -count=1
cd frontend && npm test -- --include=src/app/recurring.spec.ts
```

- [x] **Step 2:** 受け入れチェックリストを design の「受け入れ」と突き合わせる

**コミットはしない**（`/feature` 共通ルール）。
