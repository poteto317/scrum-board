# アイテム期限 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.  
> **Spec:** `docs/superpowers/specs/2026-11-17-item-due-at-design.md`  
> **コミットしない**（`/feature`）。知見: L-001, L-002, L-018, L-037, L-040, L-453

**Goal:** 詳細で分単位の期限をスクロール選択し、UTC `dueAt` として永続化・履歴に残す。

**Architecture:** DB `due_at` NULL + JSON `dueAt`。PATCH は省略／null／ISO。FE は side 保存（`ItemDueAt`）＋5 輪スクロールピッカー。ボード UI は出さない。

**Tech Stack:** Go / MySQL / Angular / vitest

## Global Constraints

- 未設定は JSON `null`（空文字 PATCH は 400）。
- 受理: `Z` または数値オフセット付き RFC3339 → UTC `…Z`（秒 00）。
- ピッカー表示中・saving 中は busy。カード切替で破棄。
- `/feature` 中はコミットしない。

## ファイルマップ

| 領域 | パス |
|------|------|
| migrate | Create: `backend/internal/kanban/due_at_migrate.go`（+test）／Modify: `database/init/001_schema.sql`／`cmd/server/main.go`（`InitializeDueAt` を **`InitializeHistory` より前**）／`mysql_test.go` の Initialize 列にも追加 |
| normalize | Create: `backend/internal/kanban/due_at.go`（`NormalizeDueAt`）／`due_at_test.go` |
| model・repo・handler・history | Modify: `model.go`／`repository.go`（`cardFields`+UPDATE）／`handler.go`（RawMessage decode＋空 PATCH ガード）／`history.go`（`historyValues`+field 列）／`history_migration.go`（baseline に dueAt） |
| API docs | Modify: `docs/api.md` |
| FE 型・normalize・autosave side | Modify: `models.ts`（`Item.dueAt`＋`ItemInput` の Partial Pick に `'dueAt'`）／`board-data.ts`／`item-autosave.ts` |
| dueAt セッション | Create: `item-due-at.ts`／`due-at.ts`／specs |
| ピッカー UI | Create: `frontend/src/app/due-at-picker.ts`／`.html`／`.css`／Modify: `item-detail.*` |

---

### Task 1: Backend — dueAt 永続化・PATCH・履歴

**Files:** migrate / `due_at.go` / model / repo / handler / history / `docs/api.md` / `main.go` / `mysql_test.go`

**Interfaces:**
- `Item.DueAt *time.Time`（JSON `dueAt`、`omitempty` 禁止。未設定は JSON `null`。応答キー常時）
- `ItemPatch`: `DueAt *time.Time` ＋ `ClearDueAt bool`（`ClearDueAt`＝null クリア；`DueAt!=nil`＝設定；両方 false＝省略）
- handler body: `DueAt json.RawMessage`（`Assignee`/`CloseReason` と同型の decode）
  - `len==0` → 省略
  - `"null"` → `ClearDueAt=true`
  - `""`（JSON 空文字）→ 400
  - 文字列 → `NormalizeDueAt` → `DueAt=&t`／失敗 400
- `NormalizeDueAt(s string) (time.Time, error)` in `due_at.go` — 受理形式のみ、UTC・秒切り捨て
- 空 PATCH ガード（`handler.go`）に `p.DueAt == nil && !p.ClearDueAt` 条件を追加（dueAt 単独 PATCH が 400 にならないように）
- 履歴: `historyValues` に `"dueAt"`。値は UTC `…Z`（秒 00）、未設定は `""`

- [x] **Step 1: 失敗するテスト**（列挙必須）:
  - PATCH 設定（`Z`）→ 応答 `…Z` 秒 00
  - PATCH オフセット付き（`+09:00`）→ UTC `…Z` に正規化
  - PATCH 省略 → 既存値不変
  - PATCH `null` → クリア（応答 `dueAt: null`）
  - PATCH `""` → 400
  - PATCH タイムゾーン無し → 400
  - PATCH 日付のみ → 400
  - PATCH 暦無効 → 400
  - dueAt **単独** PATCH が 400 にならない（空ガード更新）
  - ボード GET／単体 GET／PATCH 応答いずれも `dueAt` キー必須（欠落なし・未設定は `null`）
  - 履歴 field `dueAt`；before/after は UTC `…Z` または `""`
  - migrate で既存行 `due_at` NULL；`InitializeDueAt` を History より前に呼ぶこと
- [x] **Step 2: RED** — `cd backend && go test ./internal/kanban/ -count=1`
- [x] **Step 3: 実装** — migrate → `cardFields`/`Scan`/`UPDATE` → `NormalizeDueAt` → handler RawMessage＋空ガード → history → `docs/api.md` → `main.go` で `InitializeCloseReason` の直後・`InitializeHistory` の前に `InitializeDueAt`
- [x] **Step 4: GREEN**

---

### Task 2: Frontend — 型・UTC ヘルパー・side 保存

**Files:**
- Create: `frontend/src/app/due-at.ts`／`due-at.spec.ts` — `formatDueAtUtc`／`parseDueAt`／`toLocalParts`／`fromLocalParts`（DST は Date 正規化、往復で分一致 L-018；暦末日丸めは `fromLocalParts` 側）
- Modify: `models.ts` — `Item.dueAt: string | null`；`ItemInput` の `Partial<Pick<…>>` に `'dueAt'` を追加
- Modify: `board-data.ts` — normalize `dueAt: item.dueAt ?? null`（`?? ''` 禁止。欠落→`null`）
- Modify: `item-autosave.ts` — `sideFields` に `'dueAt'`；`markDueSideDirty`；**`applyDueSave` を専用実装**（既存 `applySideSave` の `?? ''` を通さない。`null` 保持）
- Create: `item-due-at.ts` — open／draft parts／confirm／clear／saving；`cancel$`；busy 用 `open()`/`saving()`

- [x] **Step 1: 失敗するテスト**:
  - due-at 往復（分一致）
  - DST 飛び: `process.env.TZ='America/New_York'`（または同等）を固定し、春の飛びローカル構成要素 → Date 正規化後 Instant を UTC `…Z` にし、同じ関数でローカルに戻して分一致
  - 暦末日丸め（例: 2/31 → 2 月末日）
  - normalize 欠落 → `null`（空文字にしない）
  - null クリア；side dirty 中に form flush が dueAt を潰さない（`applyDueSave` 経由）
- [x] **Step 2: RED**
- [x] **Step 3: 実装**
- [x] **Step 4: GREEN**

---

### Task 3: Frontend — スクロールピッカー UI

**Files:** Create `due-at-picker.ts`／`.html`／`.css`；Modify `item-detail.html`／`.ts`／`.css`／`.spec.ts`

**挙動:**
- 表示: 未設定「期限なし」／設定済みはローカル `YYYY/MM/DD HH:mm`
- 編集ボタンでピッカー。初期値: 既存あればローカル換算、無ければ「今」の分切捨て
- 年範囲: 現在年−1〜＋5。月日は暦末日丸め。時 0–23、分 0–59
- 確定→ side PATCH。失敗で表示を戻しエラー（L-001）
- クリア→ `dueAt: null`
- `busy()` に `dueAt.open()`／`saving()`
- 破棄: カード切替／destroy でピッカー閉じる；進行中 PATCH は `cancel$` 解除

- [x] **Step 1: 失敗するテスト**（item-detail.spec）:
  - 表示（未設定「期限なし」／設定済み `YYYY/MM/DD HH:mm`）
  - 開く（初期値: 既存ローカル／無ければ今の分切捨て）
  - 年範囲 −1〜＋5
  - 確定で updateItem
  - クリア
  - 失敗ロールバック
  - busy（open＋saving）
  - カード切替で閉じる
  - destroy でピッカー破棄
  - 進行中 PATCH の `cancel$` 解除
- [x] **Step 2: RED** — compile fails: `dueAt` / picker UI missing on ItemDetail
- [x] **Step 3: 実装** — `due-at-picker` + `item-detail` wire（ItemDueAt / busy / display / actions）
- [x] **Step 4: GREEN** — `npx ng test --watch=false --include=src/app/item-detail.spec.ts`（91 passed）

---

### Task 4: 全体検証

- [x] **Step 1:** `cd backend && go test ./...` — ok
- [x] **Step 2:** `cd frontend && npx ng test --watch=false` — 52 files / 494 tests passed
- [x] **Step 3:** `cd frontend && npx ng lint` — lint ターゲット無しのためスキップ
- [x] **Step 4:** ボード／バックログカード面に期限 UI が無いこと
  - `board.html` / `backlog.html` / `board.ts` / `backlog.ts` に `dueAt`/`期限` ヒットなし
  - 全 FE テスト GREEN（ボード／バックログ含む）

## 知見チェック

| ID | 扱い |
|----|------|
| L-001 | 失敗時ロールバック＋エラー |
| L-002 | null≠省略≠`""`；FE で null 保持；handler RawMessage＋ClearDueAt |
| L-018 | local↔UTC 往復・分一致；DST Date 正規化（TZ 固定テスト） |
| L-037/040 | ピッカー＋saving を busy、切替／destroy で破棄、cancel$ |
| L-453 | sideFields + markDueSideDirty；applyDueSave で null 保持 |
