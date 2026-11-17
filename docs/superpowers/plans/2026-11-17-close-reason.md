# Close 理由 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.  
> **Spec:** `docs/superpowers/specs/2026-11-17-close-reason-design.md`  
> **コミットしない**（`/feature`）。知見: L-001, L-002, L-037, L-040, L-453

**Goal:** Close 時／Close 中に任意の `closeReason` を詳細で入力・編集・永続化し、履歴に残す。DnD では理由を求めない。

**Architecture:** DB 列 `close_reason` + Item JSON `closeReason`。PATCH 部分更新。詳細は autosave form 欄。非 Close→Close はモーダル経由。ボード UI は触らない。

**Tech Stack:** Go / MySQL / Angular / vitest

## Global Constraints

- 理由は任意（空可）。trim 後 Unicode 文字数 ≤ 2000。
- Close 列名は `"Close"` 完全一致。
- DnD / `PATCH .../status` は理由不要。
- `/feature` 中はコミットしない。

## ファイルマップ

| 領域 | パス |
|------|------|
| マイグレーション | Create: `backend/internal/kanban/close_reason_migrate.go`（+test）／Modify: `database/init/001_schema.sql`／`backend/cmd/server/main.go` |
| モデル・永続化・履歴 | Modify: `model.go`／`repository.go`／`handler.go`／`history.go`／`history_migration.go`／`validation.go`（必要なら） |
| API ドキュメント | Modify: `docs/api.md` |
| FE 型・正規化 | Modify: `frontend/src/app/models.ts`／`board-data.ts`（`normalizeItem` で `closeReason ?? ''`） |
| autosave | Modify: `item-autosave.ts`／`item-autosave.spec.ts`（`fields` に含め、`sideFields` には入れない） |
| 詳細 UI | Modify: `item-detail.ts`／`.html`／`.css`／`.spec.ts`（status change をモーダル分岐に差し替え、即 flush しない） |

---

### Task 1: Backend — closeReason 永続化・PATCH・履歴

**Files:**
- Create: `backend/internal/kanban/close_reason_migrate.go`（`InitializeCloseReason`）
- Create: `backend/internal/kanban/close_reason_migrate_test.go`（必須: 列欠落 DB に ADD し既存行が `""`）
- Modify: `database/init/001_schema.sql` — `close_reason TEXT NOT NULL`（DEFAULT は MySQL 版に合わせて assignee と同様）
- Modify: `backend/cmd/server/main.go` — `InitializeCloseReason` 呼び出し
- Modify: `model.go` — `Item` / `ItemInput` / `ItemPatch` に `CloseReason`
- Modify: `repository.go` — SELECT/INSERT/UPDATE に列を含める
- Modify: `handler.go` — PATCH decode・検証（trim、rune ≤ 2000、未知キー拒否）
- Modify: `history.go` / `history_migration.go` — field `closeReason`
- Modify: `docs/api.md` — `closeReason` 記載
- Test: 既存 handler／history／integration テストを拡張、または新規 `close_reason_*_test.go`

**Interfaces:**
- Produces: JSON `closeReason string`；`ItemPatch.CloseReason *string`；`NormalizeCloseReason(s string) (string, bool)`（trim、rune≤2000、ValidString）

- [x] **Step 1: 失敗するテスト** — PATCH で `closeReason` 保存／省略で不変／`null` で不変／2001 文字で 400／履歴に field が出る／`PATCH .../status` 後も closeReason 不変／migrate で既存行 `""`
- [x] **Step 2: RED 確認** — `cd backend && go test ./internal/kanban/ -count=1`（関連パッケージ）
- [x] **Step 3: 実装** — migrate・model・repo・handler・history・schema・docs
- [x] **Step 4: GREEN** — 同テスト通過

---

### Task 2: Frontend — 型・正規化と autosave

**Files:**
- Modify: `frontend/src/app/models.ts` — `Item.closeReason`；`ItemInput` に含める
- Modify: `frontend/src/app/board-data.ts` — `normalizeItem` で `closeReason: item.closeReason ?? ''`（L-002）
- Modify: `frontend/src/app/item-autosave.ts` — `fields` に `'closeReason'`（**`sideFields` には入れない**・L-453）；FormControl；reset／patch
- Modify: `item-detail.ts` の `autosave.reset`／live `apply` でも `closeReason: card.closeReason ?? ''`
- Test: `item-autosave.spec.ts`／`board-data` 関連 spec — closeReason の dirty／flush／欠落→`''`

- [x] **Step 1: 失敗するテスト**
- [x] **Step 2: RED**
- [x] **Step 3: 実装**
- [x] **Step 4: GREEN** — `npx ng test --watch=false --include=src/app/item-autosave.spec.ts`（必要なら board-data spec も）

---

### Task 3: Frontend — 詳細 UI（モーダル＋Close 時テキストエリア）

**Files:**
- Modify: `item-detail.html` — `#detail-status` の `(change)` を `onStatusChange` 等に差し替え（**即 `autosave.flush()` しない**）。Close 時 `#detail-close-reason`；Close 遷移モーダル（dialog）
- Modify: `item-detail.ts` — 列名 `Close` 判定；非 Close→Close はモーダルのみ（確定まで columnId 保存しない）。それ以外の status 変更は flush。確定／キャンセル／失敗ロールバック（L-001）
- Modify: `item-detail.css` — モーダル・理由欄の最低限スタイル（既存 modal に合わせる）
- Test: `item-detail.spec.ts`:
  - 非 Close→Close でモーダル；初期値＝保存済み closeReason
  - 確定で columnId（Close）+ closeReason が保存される
  - キャンセルで columnId 戻り、closeReason は変わらない
  - 保存失敗で columnId／closeReason を確定前に戻し、エラー表示
  - Close 中に理由欄があり flush；非 Close で理由欄なし
  - 理由を編集中のライブ再取得が下書きを上書きしない（既存 dirty／世代ガードに合わせる）

**Interfaces:**
- Consumes: `columns()`、`autosave.form`、`api.updateItem`／`autosave.flush`
- Helper: `isCloseColumn(columnId: number): boolean`（name === `'Close'`）

- [x] **Step 1: 失敗するテスト**
- [x] **Step 2: RED**
- [x] **Step 3: 実装**
- [x] **Step 4: GREEN** — `npx ng test --watch=false --include=src/app/item-detail.spec.ts`

---

### Task 4: 全体検証

- [x] **Step 1:** `cd backend && go test ./...`
- [x] **Step 2:** `cd frontend && npx ng test --watch=false && npx ng build`
- [x] **Step 3:** 手動確認リストをプラン末尾に残す（コミットしない）

## 手動確認

1. 詳細で Doing→Close：モーダルが出る。空で確定しても Close になる。確定で理由も保存される。
2. モーダル初期値が保持済み理由。キャンセルでステータスも理由も変わらない。
3. モーダル確定の保存失敗時、ステータス／理由が戻リ、エラーが出る。
4. Close 中に理由を編集すると自動保存され、再読込後も残る。編集中のライブ再取得で下書きが消えない。
5. Close→Doing 後も DB の理由は残り、再 Close 時モーダルに初期値として出る。
6. ボード DnD で Close へ移せる（理由モーダルなし）。
7. 履歴に closeReason の変更が残る。
