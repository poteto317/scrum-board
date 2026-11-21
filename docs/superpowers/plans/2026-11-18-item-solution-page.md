# アイテム・ソリューションページ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.  
> **Spec:** `docs/superpowers/specs/2026-11-18-item-solution-page-design.md`  
> **コミットしない**（`/feature`）。知見: L-001, L-002, L-037, L-040, L-453, L-454, L-790, L-015

**Goal:** アイテムに `solution` 本文を永続化し、別ルートで編集・詳細プロパティからリンクする。

**Architecture:** DB `items.solution` TEXT + JSON `solution`（空は `""`）。専用ルート `/items/:number/solution` で description と同型のブロックエディタ＋autosave。詳細の `fields` / `sideFields` には載せない。

**Tech Stack:** Go / MySQL / Angular / vitest

## Global Constraints

- `solution` は description と同じ検証: UTF-8 かつ rune ≤ 10000。内容 trim なし。
- PATCH: キー省略＝変更なし。JSON `null` は `*string` で変更なし。クリアは `""`。
- 詳細に `solution` を `fields` / `sideFields` に入れない。
- プロパティ文言: 空 →「ソリューション（未記入）」／非空 →「ソリューション」。
- `/feature` 中はコミットしない。

## ファイルマップ

| 領域 | パス |
|------|------|
| migrate | Create: `backend/internal/kanban/solution_migrate.go`（+test）／Modify: `database/init/001_schema.sql`／`cmd/server/main.go`（`InitializeSolution` を History より前）／`mysql_test.go` Initialize 列 |
| model・repo・handler・history | Modify: `model.go`／`repository.go`／`handler.go`／`history.go`／`history_migration.go`／`history_import.go`（description と同型の長さチェックがあれば追随） |
| API docs | Modify: `docs/api.md` |
| FE 型・normalize | Modify: `models.ts`／`board-data.ts`（`solution: item.solution ?? ''`）／関連 spec の item フィクスチャに `solution: ''` |
| ソリューションページ | Create: `item-solution.ts`／`.html`／`.css`／`.spec.ts`／Modify: `app.routes.ts` |
| 詳細プロパティ | Modify: `item-detail.html`／`.ts`（リンク生成のみ。form に載せない）／`.spec.ts` |
| 履歴ラベル | Modify: `item-history.ts`（labels に `solution: 'ソリューション'`） |

---

### Task 1: Backend — solution 永続化・PATCH・履歴

**Files:** migrate / model / repo / handler / history / `docs/api.md` / `main.go` / `mysql_test.go`

**Interfaces:**
- `Item.Solution string`（JSON `solution`。欠落させず常に string。未設定 `""`）
- `ItemInput.Solution string`／`ItemPatch.Solution *string`
- 検証: 既存 `validDescription` を流用（または同内容の `validSolution` エイリアス）
- handler: create で任意 `solution`（省略 `""`）。update で `Description` と同様 `*string` デコード＋ `validDescription` チェック
- 空 PATCH ガードに `p.Solution == nil` を「フィールド無し」側として既存条件へ足す（solution 単独 PATCH が 400 にならない）
- 履歴: `historyValues` と field 列に `"solution"`。baseline／import の許可フィールドにも追加
- import: `validHistoricalRecord` の `len(v.Changes) > 8` を **`> 9`** に更新。`case "solution"` は description と同じ 10000 rune。`docs/api.md` の履歴 changes 上限・field 一覧を更新
- migrate: `InitializeSolution` — `close_reason` と同型 `ADD COLUMN solution TEXT NOT NULL DEFAULT ('')`

- [x] **Step 1: 失敗するテスト**
  - ボード GET・`GET /api/items/{id}`・`GET .../by-number/{n}`・POST／PATCH 応答いずれも `solution` キー（未設定 `""`）
  - POST で非空 `solution` → 永続化・応答一致
  - PATCH 設定 → 保存・応答一致（改行・前後空白保持）
  - PATCH 省略 → 不変
  - PATCH `{"solution":null}` → 不変（description 同型）
  - PATCH `""` → クリア
  - PATCH 10001 rune → 400；10000 → 200；不正 UTF-8 → 400
  - solution **単独** PATCH が空ガードで 400 にならない
  - solution のみ PATCH しても description／prUrls／relatedItems が変わらない（L-015）
  - 履歴 field `solution`；同値 PATCH で履歴件数増えない
  - `InitializeSolution` idempotent；既存行 `""`
- [x] **Step 2: RED** — `cd backend && go test ./internal/kanban/ -count=1`
- [x] **Step 3: 実装**
- [x] **Step 4: GREEN**

---

### Task 2: Frontend — 型・normalize・履歴ラベル・詳細リンク

**Files:** `models.ts`／`board-data.ts`／item フィクスチャを使う spec／`item-history.ts`／`item-detail.*`／`item-link.ts`（パスヘルパーが無ければ追加）

**挙動:**
- `Item.solution: string`；`ItemInput` の Partial に `'solution'`（作成 UI は触らない）
- normalize: `solution: item.solution ?? ''`
- `item-history.labels.solution = 'ソリューション'`
- 詳細プロパティ: PR／関連の近くに `<a [routerLink]="..." [queryParams]="...">`。文言は `item().solution ? 'ソリューション' : 'ソリューション（未記入）'`（空文字判定は `=== ''`）
- **form / autosave fields / sideFields に `solution` を追加しない**

- [x] **Step 1: 失敗するテスト**
  - board-data normalize 欠落 → `''`
  - item-history ラベル
  - item-detail: 空／非空でリンク文言；`routerLink` が `/items/{n}/solution`；`queryParams.project` がアイテムの projectId；form value に solution キーが無い
- [x] **Step 2: RED**
- [x] **Step 3: 実装**
- [x] **Step 4: GREEN** — 対象 spec

---

### Task 3: Frontend — ソリューションページ

**Files:** Create `item-solution.ts`／`.html`／`.css`／`.spec.ts`；Modify `app.routes.ts`

**挙動:**
- ルート `items/:number/solution`（`?project=` 解決は詳細と同じ）
- 取得 `api.itemByNumber`；見出しに番号・タイトル；詳細へ戻るリンク
- description と同じ `DescriptionBlocksEditor` を再利用。`LENGTH_ERROR` が「説明は…」固定のため、**超過メッセージを input 化する**（既定は現行「説明は…」、ソリューションページは「ソリューションは…」）か、同等の専用ラッパで上書きする
- **`ItemAutosave` は使わない**（固定 `fields`/`form` のため）。専用 FormControl／FormGroup＋debounce で `{ solution }` のみ PATCH（L-454: 他キーを undefined で送らない）。詳細コンポーネントと form を共有しない
- 保存失敗でエラー表示・下書き保持（L-001）
- ライブ再取得／世代ガード（L-037 / L-040）: 編集 dirty 中は GET で `solution` を上書きしない
- `canDeactivate` で未保存フラッシュ
- 空のときプレースホルダ（編集可能な未記入状態）

- [x] **Step 1: 失敗するテスト**（item-solution.spec）
  - ロード表示（`?project=` 付きで正しい itemByNumber 呼び出し）
  - 編集 → updateItem が `{ solution }` のみ
  - 失敗時エラー・値保持
  - dirty 中の再取得で下書き維持
  - 空プレースホルダ
  - 詳細への戻るリンク
  - `canLeave`／未保存フラッシュ（詳細の canDeactivate と同趣旨）
- [x] **Step 2: RED**
- [x] **Step 3: 実装**
- [x] **Step 4: GREEN**

---

### Task 4: 全体検証

- [x] **Step 1:** `cd backend && go test ./...`
- [x] **Step 2:** `cd frontend && npx ng test --watch=false`
- [x] **Step 3:** `rg -n 'ソリューション|/solution' frontend/src/app/board.html frontend/src/app/backlog.html frontend/src/app/board.ts frontend/src/app/backlog.ts` が 0 ヒット
- [x] **Step 4:** `rg -n \"solution\" frontend/src/app/item-autosave.ts frontend/src/app/item-detail.ts` で fields／sideFields／form への追加が無いこと（プロパティリンク用の参照のみ可）

## 知見チェック

| ID | 扱い |
|----|------|
| L-001 | 保存失敗で成功扱いしない |
| L-002 | 空は `""`；null クリアに頼らない |
| L-037/040 | ソリューションページの世代ガード |
| L-453 | 詳細 side 連続更新に solution を載せない |
| L-454 | PATCH は送るキーだけ |
| L-790 | 詳細 sideFields に入れない |
| L-015 | solution PATCH が他フィールドを暗黙更新しない |
