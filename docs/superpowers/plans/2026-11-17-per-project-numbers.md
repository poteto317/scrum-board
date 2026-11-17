# プロジェクトごとのアイテム番号 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** アイテム表示番号を `(project_id, item_number)` 一意にし、プロジェクト内で 1 から採番する（カード #192）。

**Architecture:** `item_numbers` に `project_id` を追加し UNIQUE を複合化。`item_number_sequence` をプロジェクト PK 化する。採番・by-number・関連解決はすべてプロジェクトスコープの同一規則。FE は `?project=` 付き深いリンクと `ProjectSession.switchTo` 再利用。

**Tech Stack:** Go/MySQL（backend/internal/kanban）、Angular（frontend/src/app）

**設計書:** `docs/superpowers/specs/2026-11-17-per-project-numbers-design.md`

## Global Constraints

- コミットしない（`/feature` → `/commit-ja` へ委譲）
- L-455: 移動・削除で既存番号を繰り下げない（欠番可）
- L-456: マイグレーションで `items.id` / `created_at` を振り直さない
- L-791: `item_numbers.project_id` を読む SELECT／Initialize より前に DDL・データ移行を完了
- L-037/L-040/L-844: 深いリンクは `ProjectSession.switchTo` 再利用。詳細 load 完了まで busy／poll 抑止。同一 busy で作成・layout 拒否
- L-459: アクティブ PATCH は既存 settings 経路・未知キー保持
- by-number 系はすべて同一解決ヘルパ＋任意 `projectId` クエリ
- RelatedItem は `projectId` 必須（現行以降の書込）。既存履歴 JSON の backfill は非目標
- 知見 ID: L-001, L-037, L-040, L-455, L-456, L-459, L-791, L-842, L-844, L-460

---

## File map

| 責任 | ファイル |
|------|----------|
| DDL・採番・per-project シーケンス | `backend/internal/kanban/numbering.go` |
| Create／Update 移動時の採番 | `backend/internal/kanban/repository.go` |
| Repository インタフェース | `backend/internal/kanban/model.go` |
| by-number クエリ解決ヘルパ | `backend/internal/kanban/handler.go`（新規小関数可）＋ status/assignee/history/command-templates handlers |
| RelatedItem 構造・検証・解決・読取 | `related_item_validate.go`, `related_item.go`, `related_item_read.go` |
| プロジェクト Create 時シーケンス行 | `backend/internal/kanban/project.go`（Create 付近） |
| 起動順（必要ならコメントのみ） | `backend/cmd/server/main.go`（InitializeNumbers は既に Projects 後） |
| FE リンク | `frontend/src/app/item-link.ts` |
| FE API | `frontend/src/app/api.ts` |
| FE モデル | `frontend/src/app/models.ts` |
| 詳細深いリンク | `frontend/src/app/item-detail.ts` |
| 切替 busy 延長 | `frontend/src/app/project-session.ts`（`onSwitched` / `endSwitch` または同等。listener0 で PATCH 直後に `switching` を落とさない経路） |
| 関連リンク表示 | related を描画するコンポーネント（既存 related UI） |

---

### Task 1: Schema + per-project 採番（Create / 移動）

**Files:**
- Modify: `backend/internal/kanban/numbering.go`
- Modify: `backend/internal/kanban/repository.go`（CreateItem INSERT、UpdateItem の `projectChanged`）
- Modify: `backend/internal/kanban/project.go`（CreateProject で sequence 行 `next_number=1`）
- Test: `backend/internal/kanban/numbering_integration_test.go`, `project_integration_test.go`（移動後番号）

**Interfaces:**
- Produces: `lockNextNumber(ctx, tx, projectID int64) (int64, error)` — `FOR UPDATE` でそのプロジェクトの `next_number` を返し、呼び出し側が `UPDATE ... SET next_number=next+1`
- Produces: `InitializeNumbers` が per-project DDL・振り直し・シーケンス投入を冪等に行う
- Consumes: `items.project_id`（既存）

- [x] **Step 1: 失敗する統合テストを書く**

  - 2 プロジェクトに各 1 枚 Create → 両方 `number==1`
  - 片方を他プロジェクトへ PATCH `projectId` → 移動先で新番号（例: 2）、移動元の 1 は欠番のまま（繰り下げなし）
  - Create／移動／`InitializeNumbers` 後に `items.project_id == item_numbers.project_id` を assert（食い違い検知）
  - `InitializeNumbers` 再実行で id／番号不変

- [x] **Step 2: テスト実行 → FAIL を確認**

Run: `cd backend && go test ./internal/kanban/ -run 'TestPerProjectNumber|TestNumber' -count=1`
Expected: 新テスト FAIL（同番衝突または移動後も旧番号）

- [x] **Step 3: `InitializeNumbers` を per-project 形へ**

  1. `item_numbers` に `project_id` が無ければ追加（INFORMATION_SCHEMA で判定）→ `UPDATE item_numbers n JOIN items c ON c.id=n.item_id SET n.project_id=c.project_id` → NOT NULL + FK
  2. 旧 `UNIQUE(item_number)` を落とし、プロジェクトごとに `ORDER BY item_number, item_id` で 1..n に振り直し（一時列または再挿入）。`items.id`/`created_at` 不変（L-456）
  3. `UNIQUE(project_id, item_number)` を張る
  4. `item_number_sequence` を `project_id` PK + `next_number` 形へ置換（新表→投入→旧表削除など）。各プロジェクト `MAX(item_number)+1`。既存 per-project 形ならスキップ（冪等）
  5. Create 時 INSERT: `INSERT INTO item_numbers(item_id,item_number,project_id)`
  6. `lockNextNumber(ctx, tx, projectID)` に変更。行が無ければ `INSERT ... next_number=1` してから lock（または CreateProject で必ず作る）
  7. `projectChanged` 時: 移動先で `lockNextNumber` → `UPDATE item_numbers SET project_id=?, item_number=?`（繰り下げなし・L-455）

- [x] **Step 4: テスト PASS**

Run: 同上 + `go test ./internal/kanban/ -count=1`（関連が落ちたら Task 2 まで一時スキップ可だが、番号系は緑）

- [x] **Step 5: コミットしない**

---

### Task 2: by-number 解決ヘルパ + RelatedItem.projectId

**Files:**
- Modify: `backend/internal/kanban/model.go` — **`GetItemByNumber(ctx, number, projectID int64)` のみ**（具体の正の projectID。0/nil アクティブ解決は repo に置かない）。Repository インタフェースと memoryRepo 全実装
- Modify: `backend/internal/kanban/repository.go` — `GetItemByNumber` を `WHERE n.project_id=? AND n.item_number=?` で検索
- Modify: `handler.go`, `status_handler.go`, `assignee_handler.go`, `history_query.go`, `card_command_template_handler.go` — クエリ `projectId` を読み **HTTP 層ヘルパ `resolveByNumberProjectID` が具体 `int64` を返してから** `GetItemByNumber` へ渡す
- Modify: `related_item_validate.go` — `ProjectID int64 \`json:"projectId,omitempty"\``。kind=item は `projectId>0` 必須。重複は `(projectId, number)`
- Modify: `related_item.go` — `resolveRelatedStored` を `WHERE project_id=? AND item_number=?`
- Modify: `related_item_read.go` — JOIN で peer の `project_id` を返し JSON に載せる
- Test: `handler_test.go`, `related_item_test.go`, `related_item_integration_test.go`, by-number 系テスト

**Interfaces:**
- Consumes: Task1 の `item_numbers.project_id`
- Produces: HTTP クエリ `projectId`（省略時はヘルパが解決後アクティブの具体 ID を返す）。RelatedItem に `projectId`
- number→id（関連追加）: `projectId` 省略 400、無ければ 404/ErrRelatedItem

- [x] **Step 1: 失敗テスト**

  - 2 プロジェクトに同番 1 → `GET .../by-number/1?projectId=A` は A、`?projectId=B` は B、クエリ無しはアクティブのみ
  - RelatedItem に `projectId` 無し → 400。有りで解決成功し応答に `projectId` が載る

- [x] **Step 2: FAIL 確認**

Run: `cd backend && go test ./internal/kanban/ -run 'ByNumber|RelatedItem' -count=1`

- [x] **Step 3: 実装**

  - HTTP 専用: `resolveByNumberProjectID(r *http.Request, ...) (int64, error)` — 正の `projectId` クエリがあればそれ、無ければ設定の解決後アクティブの具体 ID。repo には渡さない
  - 全 by-number ハンドラ: `pid, err := resolve...` → `GetItemByNumber(ctx, n, pid)`。memoryRepo も `(number, projectID int64)` 対応
  - RelatedItem 正規化・解決・読取を更新

- [x] **Step 4: PASS**

Run: `cd backend && go test ./internal/kanban/ -count=1`

- [x] **Step 5: コミットしない**

---

### Task 3: FE リンク・API・深いリンク

**Files:**
- Modify: `frontend/src/app/item-link.ts` — `itemAppPath(number, projectId)`, `itemDetailUrl(origin, number, projectId)` → `/items/{n}?project={id}`
- Modify: `frontend/src/app/api.ts` — `itemByNumber(number, projectId?)` が `params: { projectId }`；history / status / assignee / templates も同様に任意 `projectId`
- Modify: `frontend/src/app/models.ts` — `RelatedItem.projectId`
- Modify: `frontend/src/app/project-session.ts` — 深いリンク用に **詳細 load 完了まで `switching` を維持**できる API（例: `switchTo` + listener が `endSwitch` を呼ぶまで落とさない／`onSwitched` 後に詳細が `endSwitch`）。既存 listener0（詳細）が PATCH 直後に解除しているなら、深いリンク経路では load 成否まで延長（L-037/L-040）。同一 busy で addItem／作成／layout 拒否は既存のまま（L-844）
- Modify: `frontend/src/app/item-detail.ts` — `project` クエリあり: **`projectSession.switchTo(id)` 必須**（`patchActive` 単体は使わない。switching が立たない）。register switch listener → PATCH 成功後 `itemByNumber(n, projectId)` → load 完了（成功／失敗）後に `endSwitch()`。PATCH 失敗時は by-number しない。**`busy()` および poll `enabled` に `projectSession.switching()` を含める**（現状 `busy()` が switching 非含有なら修正。L-037/L-040）。poll fetch も `projectId` を渡す。コピーリンクは `itemDetailUrl(..., card.projectId)`
- Modify: 関連リンク生成箇所（grep `itemAppPath` / `itemDetailUrl` / `relatedItems`）
- Test: `item-link.spec.ts`, `api.spec.ts`, `item-detail-project.spec.ts`（または新規 deep-link spec）, 必要なら `project-session.spec.ts`

**Interfaces:**
- Consumes: Task2 API（`projectId` クエリ、RelatedItem.projectId）
- Produces: 深いリンク中 `switching===true` が詳細 load 完了まで続くこと

- [x] **Step 1: 失敗テスト**

  - `itemDetailUrl` が `?project=` を含む
  - `itemByNumber(5, 3)` が `/api/items/by-number/5?projectId=3` を呼ぶ
  - 詳細ルートで `project` クエリ時:
    1. 順序: PATCH（switch）→ その後 by-number
    2. by-number 応答前は `switching`/busy が true（詳細 load 完了まで維持）
    3. PATCH 失敗時は by-number を呼ばない
    4. busy 中は poll の `enabled` が false（抑止）

- [x] **Step 2: FAIL 確認**

Run: `cd frontend && npx ng test --no-watch --browsers=ChromeHeadless --include='**/item-link.spec.ts' --include='**/api.spec.ts' --include='**/item-detail-project.spec.ts'`
（deep-link を別ファイルにした場合はその include も追加）

- [x] **Step 3: 実装**（設計書 FE 節どおり。履歴欠落 `projectId` はアクティブ前提フォールバック）

- [x] **Step 4: PASS**

Run: Step2 の include + 関連する `project-session.spec.ts`

- [x] **Step 5: コミットしない**

---

### Task 4: 全体検証

**Files:** 変更なし（検証のみ）

- [x] **Step 1: Backend**

Run: `cd backend && go test ./... -count=1`
Expected: PASS

- [x] **Step 2: Frontend**

Run: `cd frontend && npm test -- --no-watch --browsers=ChromeHeadless`
Expected: PASS（フレーク時は 1 回再実行）

- [x] **Step 3: 受け入れ条件を手で突く（ローカル API があれば）**

  1. 2 プロジェクトで同番 Create 可
  2. コピーリンクに `?project=`
  3. 移動後は移動先新番号・移動元欠番
  4. `projectId` 無し深いリンクはアクティブ外 404

- [x] **Step 4: コミットしない**

---

## レビュー用メモ

- 第1周知見反映済み設計書の要件取りこぼし・TBD・テスト手順不足を見る
- 第2周は `lockNextNumber` / `GetItemByNumber` / RelatedItem / FE シグネチャのタスク間整合と知見 ID
