# スマホ用レイアウト Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.  
> **Spec:** `docs/superpowers/specs/2026-11-17-mobile-layout-design.md`  
> **コミットしない**（`/feature`）。知見: L-001, L-037, L-040, L-459

**Goal:** 狭い幅でかんばんをステータスセレクト＋1列表示にし、選択列を board settings に永続。バックログは狭幅の残差分のみ。

**Architecture:** DB `board_settings.mobile_board_column_id` ↔ JSON `mobileBoardColumnId`。読取は `GET /api/board` の `settings`、書込は部分 `PATCH /api/board/settings`。FE は `BOARD_MOBILE_MAX_PX=700` の `matchMedia` で1列 DOM／セレクト／effective pack を切り替え、CSS 同閾値で列全幅。

**Tech Stack:** Go / MySQL / Angular / vitest

## Global Constraints

- ボード閾値 700px、バックログ狭幅 780px（揃えない）。
- モバイル中は effective pack（永続 `cardLayout` は消さない）。
- 他列 DOM なし。セレクト変更中は `settingsSaving`。
- `/feature` 中はコミットしない。

## ファイルマップ

| 領域 | パス |
|------|------|
| settings モデル・読写 | Modify: `model.go`／`board_settings.go`／`board_settings_migrate.go`／`handler.go`／`repository.go`（`loadBoardSettings` 呼び出し全箇所）／`handler_test.go`（`memoryRepo.UpdateBoardSettings`）／`board_settings_handler_test.go`／migrate 系 test／`docs/api.md`（GET `/api/board` の settings 行＋PATCH 節）／`README.md` |
| FE 型・API | Modify: `models.ts`／`board-data.ts`／`api.ts`／`api.spec.ts`／`models.spec.ts`／`board-layout-switch.ts`（patch 型） |
| モバイル判定・セレクト | Create: `board-mobile.ts`／`board-mobile.spec.ts`；Modify: `board.ts`／`board.html`／`board.css`／関連 board\*spec |
| バックログ | Modify: `backlog.css`（検証で残差分のみ。ゼロ可） |

---

### Task 1: Backend — `mobileBoardColumnId` 読取・部分 PATCH・シード

**Files:** `model.go`／`board_settings.go`／`board_settings_migrate.go`／`handler.go`／tests／`docs/api.md`／`README.md`

**Interfaces:**
- `BoardSettings` JSON: `{ CardLayout string \`json:"cardLayout"\`, MobileBoardColumnID int64 \`json:"mobileBoardColumnId"\` }`
- パッチ DTO（handler 専用）:
  ```go
  type boardSettingsPatch struct {
    CardLayout           *string `json:"cardLayout"`
    MobileBoardColumnID  *int64  `json:"mobileBoardColumnId"`
  }
  ```
- `fallbackMobileColumnID(columns)` — 名前 `Todo`、無ければ `position` 昇順・同点は `id` 昇順の先頭、列0件なら `0`（**FE `fallbackMobileColumnId` と同順**）。
- `loadBoardSettings(ctx, q, columns []Column) (BoardSettings, error)` — `card_layout`＋`mobile_board_column_id` を読む。無効／欠落 ID は上記フォールバック。**DB は読取で書き換えない**（未シード行の挿入は `InitializeBoardSettings` のみ。Board GET 時シードはしない）。
- 未知 DB `setting_key`（例: 手動挿入した別キー）は GET／PATCH 後も行として残り、JSON `settings` には載せない（L-459 回帰）。
- **部分 PATCH の実装手順（必須）**:
  1. handler は `boardSettingsPatch`（ポインタ）を decode。両方 `nil` → 400。
  2. `cardLayout != nil` かつ値が `""`／不正 → 400（`null` はポインタ nil＝省略。`{"cardLayout":null}` は省略扱いだが、**両方省略なら 400**。単独 `{"cardLayout":null}` も両方欠落と同じ 400）。既存の `cardLayout:""`／不正値 400 は維持。
  3. repo から current settings＋columns を読む。
  4. `next := current`。指定フィールドだけ上書き。`mobileBoardColumnId` 指定時は `>0` かつ列に存在、否则 400。
  5. `UpdateBoardSettings(ctx, next BoardSettings, prev CardLayout)`（または同等）: 満額の `BoardSettings` を書き込む。`items` 再割当は **`prev==free && next.CardLayout==pack` の遷移時のみ**。handler は遷移時だけ応答に `items` を付ける（現行の「結果が pack なら常に items」を遷移検知に変更。mobile のみ／pack 据え置き PATCH では `items` 無し）。
  6. 成功応答 `settings` は常に両キー。
- `InitializeBoardSettings`: 既存 `card_layout` シードに加え、列が1件以上かつ `mobile_board_column_id` 行が無ければ Todo／最小 position（同点 id）の ID を冪等 INSERT。列0件ならスキップ（エラーにしない）。
- `repository.go` の `loadBoardSettings` 呼び出し・`model.Repository`／`memoryRepo.UpdateBoardSettings` 署名を追随。

- [ ] **Step 1: 失敗するテスト**
  - `GET /api/board` の `settings` に `mobileBoardColumnId` あり（シード後は Todo 列 ID）
  - 行無し／削除済み ID → 応答は Todo フォールバック、DB 行は読取で変わらない
  - 列0件 → `mobileBoardColumnId: 0`、シードスキップで起動成功
  - PATCH `{ "mobileBoardColumnId": <Doing> }` のみ → layout 不変・**items キー無し**・応答に両キー
  - PATCH `{ "cardLayout": "free" }` のみ → mobile ID 不変
  - PATCH `{}`／両方欠落／`{"cardLayout":null}` のみ → 400
  - 既存回帰: `cardLayout:""`／不正値／未知フィールド → 400
  - 存在しない列 ID・`0`・負数 → 400
  - 未知 `setting_key` 行が GET／PATCH 後も DB に残る（L-459）
  - `free`→`pack` は items 付き・mobile ID 維持。既に pack への `cardLayout:"pack"` は items 無し可
  - Initialize 再実行で上書きしない
  - position 同点の2列で BE/FE フォールバックが同じ id

- [ ] **Step 2: RED** — `cd backend && go test ./internal/kanban/ -count=1 -run 'BoardSettings|InitializeBoard'`

- [ ] **Step 3: 実装** — migrate → load/update（満額 next＋遷移時のみ items）→ handler ポインタ DTO → api.md（**GET `/api/board` の settings 説明行も** `mobileBoardColumnId` 付きに更新＋PATCH 節）→ README 表

- [ ] **Step 4: GREEN** — 同テスト PASS。既存 cardLayout テストも通す（`go test ./internal/kanban/ -count=1`）

---

### Task 2: Frontend — 型・normalize・API・matchMedia・1列 UI・effective pack

**Files:**
- Create: `board-mobile.ts`／`board-mobile.spec.ts`
  ```ts
  export const BOARD_MOBILE_MAX_PX = 700;
  export function boardMobileMediaQuery(): string {
    return `(max-width: ${BOARD_MOBILE_MAX_PX}px)`;
  }
  export function fallbackMobileColumnId(columns: { id: number; name: string; position: number }[]): number {
    const todo = columns.find((c) => c.name === 'Todo');
    if (todo) return todo.id;
    if (!columns.length) return 0;
    return [...columns].sort((a, b) => a.position - b.position || a.id - b.id)[0].id;
  }
  export function resolveMobileColumnId(
    saved: unknown,
    columns: { id: number; name: string; position: number }[],
  ): number {
    const n = typeof saved === 'number' && Number.isFinite(saved) ? Math.trunc(saved) : NaN;
    if (n > 0 && columns.some((c) => c.id === n)) return n;
    return fallbackMobileColumnId(columns);
  }
  ```
- Modify: `models.ts` — `BoardSettings.mobileBoardColumnId?: number`（正規化後は number）
- Modify: `board-data.ts` — normalize で `mobileBoardColumnId` を数値化（欠落は後段 resolve。settings に残す）
- Modify: `api.ts` — `patchBoardSettings(body: { cardLayout?: CardLayout; mobileBoardColumnId?: number })`（少なくとも一方）。送信は定義されたキーのみ
- Modify: `board-layout-switch.ts` — deps の patch 型を上記に合わせる（呼び出しは `cardLayout` のみのまま可）
- Modify: `board.ts`／`board.html`／`board.css`:
  - `isBoardMobile` signal + `matchMedia` listener（`ngOnInit`/`DestroyRef`）
  - **共通 `applyBoardPayload(raw)`**: `normalizeBoardData` → `settings.mobileBoardColumnId = resolveMobileColumnId(...)` → `setData`。`load`／`pollBoard`／settings PATCH 成功マージはすべてこれを通す（poll だけ resolve 抜け禁止。自動 PATCH しない）
  - `selectedMobileColumnId` = resolve 済み ID。`visibleColumns` = mobile なら選択列1件のみ（無ければ空配列）、否则 `data().columns`
  - `@for (column of visibleColumns(); …)` — 既存の空列 `@empty`／`.empty-column` を選択列でもそのまま使う
  - ツールバー: `@if (isBoardMobile()) { <label><select aria-label="表示するステータス" [disabled]="data().columns.length===0 || selectedMobileColumnId()===0" …>`。**option は `data().columns` 全件**。value=`column.id`
  - `layout-toggle` は `@if (!isBoardMobile())`
  - **effective pack ゲート**: `isFreeLayout` = `!isBoardMobile() && cardLayout() === 'free'`（`card-list-free`／`top`／`sortingDisabled`／`freeListMinHeight`／キーボード列内移動が同一式を参照）
  - **drag-help**: mobile 時は「列内のみ並べ替え可。他ステータスへはセレクト切替または詳細で変更」と分岐（pack 文言の「別の位置やステータスへ」を出さない）
  - `connectedLists`: mobile なら `[]`
  - セレクト change: **`settingsSaving`（または `isBusy`）中は no-op**。否則 楽観更新 → `settingsSaving=true` → PATCH → 失敗ロールバック＋`reorderError`；成功は `applyBoardPayload` 相当で settings マージ
  - **`canReorder` 計算に `!isBoardMobile()` を入れる**（`draggable` と `onHandleKeydown` の両方を止める）
  - CSS: `@media (max-width: 700px)` で `.board-page.board-mobile .kanban-column` 全幅。`isBoardMobile` 時 root に `board-mobile` class

- [ ] **Step 1: 失敗するテスト**
  - `resolveMobileColumnId` / fallback（Todo／最小 position＋id tie-break／0）
  - normalize が `mobileBoardColumnId` を保持
  - load 後の無効保存値が Todo に resolve される（自動 PATCH なし）
  - `api.patchBoardSettings({ mobileBoardColumnId })` が当該キーのみ送る
  - board: matchMedia true でセレクト表示（aria-label「表示するステータス」）・option 全列・列 DOM 1・自由配置トグル非表示
  - 列0件でセレクト disabled
  - 空の選択列で empty-column 表示
  - matchMedia false でセレクト非表示・全列
  - 永続 free＋mobile → `isFreeLayout` false・card-list-free 無し・sortingDisabled false・offsetY top 無し
  - セレクト変更で PATCH＋`settingsSaving` 中は poll 適用しない（既存 busy ゲート）
  - PATCH 失敗で選択ロールバック

- [ ] **Step 2: RED**

- [ ] **Step 3: 実装**

- [ ] **Step 4: GREEN** — `npx ng test --watch=false --include=src/app/board-mobile.spec.ts` および関連 board／api／models spec

---

### Task 3: バックログ狭幅の残差分

**Files:** `frontend/src/app/backlog.css`（必要なら `backlog.html`）

- [ ] **Step 1:** 780px 以下で backlog を目視／既存 CSS 確認。横はみ出し・フィルタ／ツールバーの触れにくさが無ければ **変更なしで完了**。
- [ ] **Step 2:** 残る問題だけ最小 CSS（例: toolbar wrap、`minmax(0,1fr)`、overflow）。DnD／フィルタ契約は変えない。
- [ ] **Step 3:** 変更があれば関連 spec／手動確認。無ければスキップ。

---

### Task 4: 全体検証

- [ ] **Step 1:** `cd backend && go test ./internal/kanban/ -count=1`
- [ ] **Step 2:** `cd frontend && npx ng test --watch=false`（または board／api／models／board-mobile の include 一式）
- [ ] **Step 3:** 手動チェックリスト
  - 幅≤700: セレクト＋1列全幅、初期 Todo、変更がリロード後も残る
  - 幅≥701: 複数列、セレクト無し、free トグル復帰
  - mobile 中 free 設定でも縦 pack DnD（キーボード並べ替え可）
  - リストフィルタ・件数・カード開く／コピーが mobile でも動く（受け入れ7）
  - バックログ 780 以下で読め・触れられる
  - PATCH 失敗時ロールバック

---

## Spec coverage（self-review）

| 受け入れ | Task |
|----------|------|
| 1列 DOM・セレクト・700 | T2 |
| Todo フォールバック | T1+T2 |
| settings 永続・失敗ロールバック・settingsSaving | T1+T2 |
| 広い画面セレクト無し | T2 |
| バックログ | T3 |
| effective pack・cardLayout 保持 | T2 |
| フィルタ等 | T2（既存維持） |
| poll ガード | T2 |
| 部分 PATCH・応答両キー・シード | T1 |
