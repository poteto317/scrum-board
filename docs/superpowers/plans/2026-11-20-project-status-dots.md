# プロジェクト選択の状態ドット Implementation Plan

> **For agentic workers:** 本リポジトリの `/feature` ではコミットしない。実装後の commit は後続の `/commit-ja` に任せる。Steps は checkbox で進捗管理する。

**Goal:** ヘッダーのプロジェクト listbox の各 option に、Doing / Review（どちらも無ければ Todo）の有無を示す色付き status-dot を出す。

**Architecture:** 列名→件数の純関数を切り出し、`ProjectBoardCache` の board スナップショットを `{ items, columns }` 一体に拡張。`App` はキャッシュからドットと `aria-label` を算出して listbox に描画するだけ（`switchTo` / 先読み契約は不変）。

**Tech Stack:** Angular（standalone）、Vitest、既存 `.status-dot` / `.doing .status-dot` CSS。

**Spec:** `docs/superpowers/specs/2026-11-20-project-status-dots-design.md`

## Global Constraints

- 表示ルール: Doing≥1 → doing ドット、Review≥1 → review ドット（両方可・順は Doing→Review）。どちらも0かつ Todo≥1 → todo ドットのみ。それ以外なし。
- 列名は完全一致 `"Doing"` / `"Review"` / `"Todo"`。Done / Close / カスタム列は無視。
- 色は現行かんばんと同じ。Review／Todo はデフォルト灰リング。ボードの Review 色は新設しない。
- セレクタ: Doing は祖先 `.doing` + 子 `.status-dot`。Review は祖先 `.review` + 子 `.status-dot`（色上書き CSS は書かない）。Todo は修飾なし `.status-dot`。
- データは `ProjectBoardCache` 単一源。Board `data()` は読まない。未 warm はドットなし。
- board キャッシュは `{ items, columns }` 一体 put のみ。items 単体 put 廃止。prefetch は `putBoardIfAbsent`（遅延が fresher `putBoard` を踏まない。L-040）。
- warm / enqueue スキップ判定は **`columns.length >= 1`**（空 columns のエントリは未キャッシュ。L-002）。単なる `map.has` だけでは足りない。
- option に必ず `aria-label`（ドットなし=名前のみ／あり=`名前, Doing` 等。設計書どおり）。ドットは `aria-hidden`。
- listbox の開閉・キーボード契約（#80 / L-408）は変えない。ドットと aria-label の追加に留める。
- BE・DB・ボード列マークアップ変更なし。コミットしない。

## File map

| File | Responsibility |
|------|----------------|
| `frontend/src/app/project-status-dots.ts` | `projectStatusDots` / `projectStatusAriaLabel` 純関数 |
| `frontend/src/app/project-status-dots.spec.ts` | 純関数単体 |
| `frontend/src/app/project-board-cache.ts` | board スナップショットを一体形へ。getter 互換 |
| `frontend/src/app/project-board-cache.spec.ts` | columns 保持・未 warm・遅延 prefetch |
| `frontend/src/app/board.ts` | `putBoard` 呼び出しを columns 付きに更新 |
| `frontend/src/app/app.ts` / `app.html` / `app.css` | option にドット + aria-label。キャッシュ購読 |
| `frontend/src/app/app.spec.ts` | App 経由の配線テスト（L-060）＋開中先読み完了 |
| `frontend/src/styles.css`（または同等グローバル） | `.status-dot` / `.doing .status-dot` を `.kanban-column` と `.project-select-list` 祖先付きで共有（L-792）。`board.css` から移すか複製せず1か所 |
| `frontend/src/app/board.css` | 共有へ移した規則を削除（重複色定義を残さない） |
| `frontend/src/app/board-project-switch.spec.ts` | `putBoard(2, items)` → columns 付きシグネチャへ |
| `frontend/src/app/backlog-project-switch.spec.ts` | 同上（board put があれば） |

---

### Task 1: 純関数

**Files:**
- Create: `frontend/src/app/project-status-dots.ts`
- Create: `frontend/src/app/project-status-dots.spec.ts`

**Interfaces:**
- `export type StatusKind = 'doing' | 'review' | 'todo'`（設計書スニペットと同名）
- `projectStatusDots(columns: {id:number;name:string}[], items: {columnId:number}[]): StatusKind[]`
- `projectStatusAriaLabel(name: string, dots: StatusKind[]): string` — 設計の文言どおり

- [x] **Step 1:** 失敗するテスト: Doing のみ / Review のみ / 両方（順 Doing→Review）/ Todo フォールバック / なし / columns 空→[] / 名前不一致列のみ→[] / aria-label 各パターン。
- [x] **Step 2:** 実装してテストを通す。
- [x] **Step 3:** `cd frontend && npx vitest run src/app/project-status-dots.spec.ts`

---

### Task 2: ProjectBoardCache を一体スナップショットへ

**Files:**
- Modify: `frontend/src/app/project-board-cache.ts`
- Modify: `frontend/src/app/project-board-cache.spec.ts`
- Modify: `frontend/src/app/board.ts`
- Modify: `frontend/src/app/board-project-switch.spec.ts`
- Modify: `frontend/src/app/backlog-project-switch.spec.ts`（該当すれば）

**Interfaces:**
- 内部: `Map<number, { items: Item[]; columns: Column[] }>`
- `readonly revision: Signal<number>`（または同等）— `putBoard` / 成功した `putBoardIfAbsent` のたびに bump。App が開中 listbox を再描画するために購読
- `getBoard(projectId): Item[] | undefined` — items の clone（既存呼び出し互換）。warm でないなら undefined
- `getBoardSnapshot(projectId): { items: Item[]; columns: Column[] } | undefined` — 両方 clone。**`columns.length < 1` なら undefined**（未キャッシュ）
- `putBoard(projectId, items, columns)` / `putBoardIfAbsent(projectId, items, columns)` — 一体のみ。`columns.length < 1` の put は no-op（またはエントリを作らず warm にしない）
- prefetch の board 成功時: 応答から `items` と `columns` を抽出して `putBoardIfAbsent`（現行 `extractItems` だけでは不足）
- enqueue スキップ: **`columns.length >= 1` の warm エントリがあるときだけ**（空 columns や items だけを `map.has` でスキップしない。L-002）

- [x] **Step 1:** 失敗するテスト: put 後 `getBoardSnapshot` が columns を返す。`putBoard` 後の遅延 `putBoardIfAbsent` が上書きしない。空 columns では warm にしない／再 prefetch 可。**`prefetchBoard` に columns 付き mock 応答 → `getBoardSnapshot().columns` が保存される**こと。put 成功で `revision` が増加すること。
- [x] **Step 2:** キャッシュ実装を更新。`board.ts` の `putBoard(activeId, board.items)` を columns 付きに。`board-project-switch.spec.ts` / `backlog-project-switch.spec.ts` の `putBoard` 呼び出しを追随。
- [x] **Step 3:** `cd frontend && npx vitest run src/app/project-board-cache.spec.ts`

---

### Task 3: status-dot CSS 共有 + listbox UI 配線

**Files:**
- Modify: `frontend/src/styles.css`（または既存グローバル入口）
- Modify: `frontend/src/app/board.css`（移した規則を削除）
- Modify: `frontend/src/app/app.ts`
- Modify: `frontend/src/app/app.html`
- Modify: `frontend/src/app/app.css`

**Interfaces:**
- 受け入れ2: Doing 金ドットが listbox でも見えるよう、`.status-dot` と `.doing .status-dot`（必要なら `.done .status-dot` もボード用に）を **グローバルへ祖先付きで移す**:
  - `.kanban-column .status-dot` / `.kanban-column.doing .status-dot`（現行ボードセレクタに合わせる）
  - `.project-select-list .status-dot` / `.project-select-list .doing .status-dot`
  - セレクト専用の新色は作らない（L-792）
- App が projectId ごとに `getBoardSnapshot` → `projectStatusDots` / `projectStatusAriaLabel`
- キャッシュ更新で開いた listbox も再描画（cache の version signal 等）
- HTML: option に `aria-label`、ドット群 `aria-hidden`、設計のクラス構造
- CSS（app.css）: option 横並び（ドット + 名）。色定義は styles 側に任せる

- [x] **Step 1:** `board.css` の status-dot 規則を `styles.css` へ祖先付きで移し、ボード見た目が退行しないことを目視／既存 board テストで確認。
- [x] **Step 2:** HTML / app.css を設計の UI 構造（横並び）に合わせる。開閉・キーボード・外側クリックの既存ハンドラは触らない（L-408）。
- [x] **Step 3:** `app.ts` で `revision` を読んでスナップショット→ドット算出。未 warm は `[]` と名前のみ aria-label。
- [x] **Step 4:** `revision` 購読により、開中メニューがキャッシュ更新で再描画されることを確保。

---

### Task 4: app.spec（L-060）と全体検証

**Files:**
- Modify: `frontend/src/app/app.spec.ts`

- [x] **Step 1:** キャッシュに Doing/Review 付きスナップショットを入れ、listbox を開いて option 内 `.doing .status-dot` / `.review .status-dot` と aria-label を App 経由で断言。
- [x] **Step 2:** 未キャッシュ project はドット要素なし・aria-label が名前のみ。
- [x] **Step 3:** **受け入れ4:** listbox を開いた状態で、後から `putBoard` / prefetch 完了相当でスナップショットを入れ、ドットが出現することを App 経由で断言。
- [x] **Step 4:** `cd frontend && npx vitest run src/app/app.spec.ts src/app/project-status-dots.spec.ts src/app/project-board-cache.spec.ts`
- [x] **Step 5:** `cd frontend && npm test`（既定 FE テスト）を通し、失敗を直す。※本変更と無関係な main 既存失敗（normalizeItem 余剰フィールド比較）は残存。関連 include は全通。
- [x] **Step 6:** 設計の受け入れ 1–6 をチェックリスト確認（とくに色共有＝受け入れ2、開中更新＝受け入れ4）。

## 知見チェック

- L-002 / L-035 / L-040（遅延 prefetch） / L-037 / L-792 / L-408 / L-060（app.spec 必須） / L-842 — 設計書どおり。
