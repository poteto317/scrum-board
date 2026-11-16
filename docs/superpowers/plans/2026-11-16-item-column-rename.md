# DB 列名・制約名を item に揃える Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.  
> **Spec:** `docs/superpowers/specs/2026-11-16-item-column-rename-design.md`  
> **コミットしない**（`/feature`）。知見: L-456, L-791, L-001, L-038

**Goal:** 補助表の `card_id` / `related_card_id` / `task_number` と `card`/`task_number` を含む制約名を `item_*` に揃え、起動時冪等 ALTER で既存 DB を移行し、本番デプロイ後も API が動く。

**Architecture:** `RenameCardTablesToItems` 直後に `RenameCardColumnsToItems`（GET_LOCK + information_schema）。列・制約ごとに冪等。DDL／アプリ SQL を新名に更新。行データ・id・公開番号は触らない。

**Tech Stack:** Go / MySQL / Cloud Run

## Global Constraints

- 列単位・制約単位の冪等。表全体スキップ禁止。
- 期待する新 FK/INDEX が無ければ ADD（途中クラッシュ回復）。
- インデックス改名は `RENAME INDEX` 優先。
- `/feature` 中はコミットしない（Commit ステップはスキップ）。
- 公開 API/JSON・Go ファイル名の機械リネーム・CSS は対象外。

## ファイルマップ

| 領域 | パス |
|------|------|
| 列リネーム migrate | Create: `backend/internal/kanban/column_rename_migrate.go` + `_test.go` |
| 起動順 | Modify: `backend/cmd/server/main.go`（RenameTables 直後・Initialize* 前） |
| DDL | Modify: `numbering.go`, `history_migration.go`, `pr_link.go`, `related_item_migrate.go`, `card_command_template_migrate.go`, `pr_link_migrate.go` |
| SQL 参照 | Modify: `repository.go`, `related_item.go`, `related_item_read.go`, `history.go`, `history_query.go`, `history_import.go`, `pr_link.go`, `card_command_template_repo.go`, `numbering.go` |
| テスト | Modify: 上記を触る `*_integration_test.go` / `*_test.go` |
| Docs | Modify: `docs/superpowers/specs/2026-11-16-items-url-rename-design.md`（当面維持→本 spec） |

---

### Task 1: 列リネームマイグレーション + テスト

**Files:**
- Create: `backend/internal/kanban/column_rename_migrate.go`
- Create: `backend/internal/kanban/column_rename_migrate_test.go`
- Modify: `backend/cmd/server/main.go`

**Interfaces:**
- Produces: `func (r MySQLRepository) RenameCardColumnsToItems(ctx context.Context) error`
- Consumes: `tableExists`（既存）、information_schema ヘルパ

- [x] **Step 1:** 失敗するテストを書く  
  - 旧列付きスキーマ → migrate → 新列・新制約名のみ。移行前後で行 `id` / 公開番号（旧 `task_number`）が不変（L-456）  
  - 旧→新後の 2 回目呼び出し、および**最初から新 DDL の DB**での呼び出しがどちらもエラーなし（no-op）  
  - 途中状態: FK DROP 後に新 FK 無し、および UNIQUE/INDEX 欠落を再現し、再実行で期待する新 FK **と** UNIQUE/INDEX が付くこと（L-038）

- [x] **Step 2:** `go test ./internal/kanban/ -run TestRenameCardColumns -count=1` が FAIL することを確認

- [x] **Step 3:** `RenameCardColumnsToItems` を実装  
  - Lock: `scrumboard_rename_card_columns_to_items`  
  - 対象表: spec 網羅リスト。加えて同表内で名前に `card` / `task_number` を含む INDEX/FK/CHECK を `information_schema` で掃いて改名  
  - 順序: **旧 FK DROP → CHANGE COLUMN → 残 INDEX 改名 → 期待する新 FK/UNIQUE/INDEX が無ければ ADD**（spec どおり。FK 付きのまま CHANGE しない）  
  - `task_number` 暗黙 UNIQUE 改名 + CHECK `item_number > 0` 追随  
  - 失敗は error をそのまま返す（握りつぶさない = L-001）

- [x] **Step 4:** `main.go` で `RenameCardTablesToItems` の直後・`Initialize*` の前に、既存の `if err == nil { err = ... }` 連鎖へ載せる（失敗で起動停止 = L-001）。コメントで L-791 順序を固定。起動順の統合テストは必須としない（コード位置の確認で足りる）

- [x] **Step 5:** テスト PASS。コミットはしない。

**Done when:** 旧→新・両 no-op・FK/UNIQUE/INDEX 欠落回復・データ不変のテストが緑。

---

### Task 2: DDL とアプリ SQL を新列名へ

**Files:** numbering / history / pr_link / related / command_template 系と repository 等（ファイルマップ参照）

- [x] **Step 1:** CREATE TABLE / INSERT / SELECT / JOIN の `card_id`→`item_id`、`related_card_id`→`related_item_id`、`task_number`→`item_number`（`item_number_sequence.next_number` は触らない）

- [x] **Step 2:** DDL 内の制約名を新名に（`fk_item_number`, `uq_item_pr_url`, `uq_item_related_item`, `fk_history_item`, `fk_item_pr_links_item`, `fk_item_command_templates_item` 等）。`item_numbers` の CHECK は `item_number > 0` で定義する

- [x] **Step 3:** `dbError` は `uq_item_related_` を正とし、過渡の旧名照合は残してよい

- [x] **Step 4:** `go test ./internal/kanban/...` を回し、生 SQL を持つテストも新列名へ更新（旧→新専用テスト以外）

**Done when:** `go test ./internal/kanban/...` 緑。

---

### Task 3: docs 更新 + 起動経路の確認

- [x] **Step 1:** `2026-11-16-items-url-rename-design.md` の「列名当面維持／対象外の列リネーム」を「列リネーム済み → `2026-11-16-item-column-rename-design.md`」に更新

- [x] **Step 2:** `main.go` で `RenameCardColumnsToItems` が Tables 直後・Initialize* 前の err 連鎖上にあることを目視確認（L-791）

**Done when:** docs と起動順が spec と一致。

---

### Task 4: 検証（ローカル）と本番反映準備

- [ ] **Step 1:** `go test ./internal/kanban/...` 再実行

- [ ] **Step 2:** （後続 `/commit-ja`→`/pr-ja`→merge 後）`deploy-gcp.sh` で本番デプロイし、`/api/board`・`/api/items/by-number/26` をスモーク。**本 Task のデプロイはマージ後のフローで実施**（`/feature` 単体ではマージしない）。

**Done when:** ローカルテスト緑。本番は PR マージ後ステップで実施する旨を state/報告に残す。
