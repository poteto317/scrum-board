# カード147 二重本文修復 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 管理者が `POST /api/admin/repair-doubled-text` で、生存アイテムの description / solution に残った厳密な half+half 二重本文を dry-run 確認のうえ修復できるようにする。

**Architecture:** 純関数 `collapseExactDoubledText` で判定と畳み込みを一本化し、ハンドラが `ListLivingItems` → フィールドごとに関数適用 →（apply 時）`UpdateItem` で部分更新する。ID / createdAt は触らない。FE 変更なし。

**Tech Stack:** Go（backend/internal/kanban）、既存 handler テストの memoryRepo、OpenAPI 3.1

**Spec:** `docs/superpowers/specs/2026-11-26-card147-doubled-description-repair-design.md`

## Global Constraints

- 認可は `requireAdmin` のみ（スケジューラトークン専用にしない）
- 判定は rune 列の厳密 half+half。曖昧類似は禁止
- dry-run 省略時は適用（`false`）。本番では必ず先に `dryRun: true`
- 一覧失敗のみ 5xx。個別 Update 失敗は 200 + `failedItemIds`
- 警告件数 = `len(warnings)`。`repairs` から `itemIds` を導出
- コミットはこの feature 手順では行わない（後続 `/commit-ja`）
- 知見: L-001, L-002, L-003, L-456, L-018

---

### Task 1: 純関数 `collapseExactDoubledText`

**Files:**
- Create: `backend/internal/kanban/doubled_text.go`
- Test: `backend/internal/kanban/doubled_text_test.go`

**Interfaces:**
- Produces: `func collapseExactDoubledText(s string, maxFolds int) (out string, folds int, hitLimit bool)`
- `maxFolds` 既定利用は呼び出し側で `8`

- [x] **Step 1: 失敗するテストを書く**

`doubled_text_test.go` に少なくとも次を置く:

- 空文字 → 変化なし、folds=0
- 奇数 rune 長 → 変化なし
- 非二重（`abcd`）→ 変化なし
- 単純二重（`あいうあいう`）→ `あいう`、folds=1
- 多重畳み: 元が `A` の 4 回連結 `AAAA`（= `AA`+`AA`）→ `maxFolds=8` で最終 `A`、folds≥2
- `maxFolds=1` で入力 `AAAA` → 出力 `AA`、`hitLimit=true`
- バイト境界で割れないこと（マルチバイト文字）

- [x] **Step 2: テストを実行して失敗を確認**

```bash
cd backend && go test ./internal/kanban/ -run CollapseExactDoubled -count=1
```

- [x] **Step 3: 最小実装**

`doubled_text.go` で rune スライスを偶数分割し、前半==後半なら前半に置換を繰り返す。

- [x] **Step 4: テスト成功を確認**

```bash
cd backend && go test ./internal/kanban/ -run CollapseExactDoubled -count=1
```

---

### Task 2: 修復ハンドラ + ルート

**Files:**
- Create: `backend/internal/kanban/doubled_text_handler.go`（または既存 admin ハンドラ近傍）
- Modify: `backend/internal/kanban/handler.go`（`POST /api/admin/repair-doubled-text` を登録）
- Modify: `backend/internal/kanban/handler_test.go`（memoryRepo に不足があれば）
- Test: `backend/internal/kanban/doubled_text_handler_test.go`

**Interfaces:**
- Consumes: `collapseExactDoubledText`, `requireAdmin`, `ListLivingItems`, `UpdateItem`, `ItemPatch`
- Produces: JSON

```go
type doubledRepairEntry struct {
	ItemID int64  `json:"itemId"`
	Field  string `json:"field"` // "description" | "solution"
}
type doubledRepairResponse struct {
	DryRun                bool                 `json:"dryRun"`
	Scanned               int                  `json:"scanned"`
	DescriptionRepaired   int                  `json:"descriptionRepaired"`
	SolutionRepaired      int                  `json:"solutionRepaired"`
	ItemIDs               []int64              `json:"itemIds"`
	Repairs               []doubledRepairEntry `json:"repairs"`
	Warnings              []string             `json:"warnings"`
	FailedItemIDs         []int64              `json:"failedItemIds"`
}
```

- Body: `{"dryRun": bool}`（省略時 false）
- `itemIds` は `repairs` からユニーク昇順で導出

- [x] **Step 1: 失敗するハンドラテストを書く**

- 非 admin → 403、未ログイン → 401
- 対象 0 件（二重なし）→ 200、`repairs` 空・修復件数 0（L-002: 空≠失敗）
- dry-run: 二重アイテムがあっても Update されず、`repairs` に field 付き、`descriptionRepaired` 等は予定件数
- apply: description のみ二重 / solution のみ / 両方、の3ケースで値が half に更新される（memoryRepo）
- apply 後、id / createdAt は不変（L-456）。memoryRepo が履歴を持たない場合は履歴アサーションは省略可
- fold limit（ハンドラは常に maxFolds=8）: 8 回畳んでも half+half が残る長い繰り返し（例: `strings.Repeat("a", 512)`）で `warnings` に `"item {id} {field}: fold limit reached"` 相当。短い `AAAA` では警告が出ない点に注意
- `ListLivingItems` 失敗スタブ → 5xx（空成功にしない）
- Update 失敗スタブ → `failedItemIds` に入り他アイテムは継続、最終 200

- [x] **Step 2: テスト失敗を確認**

```bash
cd backend && go test ./internal/kanban/ -run RepairDoubled -count=1
```

- [x] **Step 3: ハンドラ実装 + ルート登録**

1. `requireAdmin`
2. body decode（`dryRun` 省略 = false）
3. `ListLivingItems` 失敗 → `fail`（5xx）。成功時 `scanned = len(items)`
4. 各 item の description / solution を `collapseExactDoubledText(..., 8)` 適用。`hitLimit` なら `warnings` に `"item {id} {field}: fold limit reached"` を追加。`out != 元` なら `repairs` に追加し、フィールド別カウンタを +1
5. `!dryRun` なら変化したフィールドだけをまとめた `ItemPatch` で `UpdateItem`（1 アイテム 1 回）。失敗時は failed に入れて continue
6. `itemIds` は `repairs` からユニーク昇順で導出。200 + レスポンス（空スライスは `[]` で marshal）

- [x] **Step 4: テスト成功**

```bash
cd backend && go test ./internal/kanban/ -run 'RepairDoubled|CollapseExactDoubled' -count=1
```

---

### Task 3: OpenAPI 更新

**Files:**
- Modify: `docs/openapi.yaml`
- 必要なら: `scripts/check-openapi-routes.py`（sessionExempt に入れない）

**Skill:** `.cursor/skills/update-api-doc/SKILL.md`

- [x] **Step 1: path 追加**

`POST /api/admin/repair-doubled-text`

- security: cookieAuth OR basicAuth（admin 必須は description に明記）
- requestBody: `{ dryRun?: boolean }`
- responses: 200 schema（仕様のフィールド一式）、401、403、5xx

- [x] **Step 2: ルート整合チェック**

```bash
python3 scripts/check-openapi-routes.py
```

---

### Task 4: パッケージ検証

- [x] **Step 1: kanban パッケージ全体**

```bash
cd backend && go test ./internal/kanban/ -count=1
```

- [x] **Step 2: 失敗があれば修正して再実行。通るまで次へ進まない**

---

## 運用メモ（実装後・デプロイ後）

```bash
# 必ず dry-run 先
curl -u "$USER:$PASS" -H 'Content-Type: application/json' \
  -d '{"dryRun":true}' \
  "$BASE/api/admin/repair-doubled-text"

# 適用
curl -u "$USER:$PASS" -H 'Content-Type: application/json' \
  -d '{"dryRun":false}' \
  "$BASE/api/admin/repair-doubled-text"
```
