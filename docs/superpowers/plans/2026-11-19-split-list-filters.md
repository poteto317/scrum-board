# Split Board/Backlog List Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.  
> **Spec:** `docs/superpowers/specs/2026-11-19-split-list-filters-design.md`  
> **コミットしない**（`/feature`）。

**Goal:** ボードとバックログの一覧フィルタを独立させ、ボード初期は全列、バックログ初期は Todo 列のみにする。

**Architecture:** `GET/PUT /api/list-filter` のボディを `{ board, backlog }` に拡張。DB はビュー別カラムへ移行。Todo シードの永続は **Initialize（行なし新規含む）と旧形移行** でのみ行い、通常 GET は再シードしない。FE の `ListFilterSession` をビュー別にし、各画面は自ビューだけ編集。PUT は両ビュー全体を送る。

**Tech Stack:** Go / MySQL / Angular / vitest

## Global Constraints

- 空 `statusIds`＝全列（既存意味）。クリア後に Todo を再シードしない
- PUT は `board`+`backlog` 両方必須（部分更新なし）
- Todo 解決: trim＋大小無視で `"todo"`、複数なら position 昇順の先頭。**0 件なら `[]`（エラーにしない）**
- 壊れた JSON の GET は安全デフォルトを返すだけで行を上書きしない
- **旧カラムはマイグレーション完了後に DROP する**（「読まないだけ」は採らない。二重ソース禁止）
- クライアントは列名から Todo を推測して初回 PUT しない（シードは BE 移行のみ）
- `/feature` 中はコミットしない

## 知見チェック

| ID | Plan での扱い |
|----|----------------|
| L-001 / L-002 | GET 失敗≠空成功。壊 JSON を空で上書きしない。PUT/clear 失敗を成功扱いせず draft を戻す（全体 PUT） |
| L-037 / L-040 | session の load/save 世代ガードを両ビューで維持（Task2 Step1/3） |
| L-110 | root 単一 filter signal を廃止し view 別 |
| L-015 | クリア／移行で相手ビュー prefs を消さない |
| L-460 / L-472 | 既存 board/backlog フィルタ＋DnD スペックを回帰 |

## ファイルマップ

| 領域 | パス |
|------|------|
| BE モデル/永続 | Modify: `backend/internal/kanban/list_filter.go`, `list_filter_migrate.go`, `model.go`（Repo シグネチャ） |
| BE HTTP | Modify: `list_filter_handler.go`, `handler_test.go` / `list_filter_handler_test.go`, `list_filter_integration_test.go` |
| FE 型/API | Modify: `frontend/src/app/list-filter.ts`, `api.ts`, `api.spec.ts` |
| FE session/UI | Modify: `list-filter-session.ts`, `list-filter-session.spec.ts`, `list-filter-bar.ts`, `board.ts`, `backlog.ts` と関連 spec |
| 文書 | Modify: `docs/api.md`（共有→分離の節） |

---

### Task 1: BE — スキーマ移行と Get/Put 新形

**Files:** `list_filter*.go`, 関連テスト, `docs/api.md`

- [x] **Step 1: 失敗するテスト**
  - GET が `{board,backlog}`
  - **行なし新規**: board=`[]` 全列、backlog=Todo ID（列あり時）
  - 旧行移行後: board＝旧値、backlog＝Todo ID
  - **Todo 列 0 件**: backlog=`statusIds:[]`、エラーなし
  - PUT 片方欠落・未知トップ／ネストキー・query 200 超・statusIds 非正整数 → 400
  - backlog `statusIds:[]` 保存後 GET で `[]` のまま（再シードなし）
  - 壊 JSON: 安全デフォルト・行非上書き
- [x] **Step 2: RED** — `go test ./internal/kanban/ -count=1 -run ListFilter`
- [x] **Step 3: 実装** — DDL をビュー別カラムへ（`board_query_text`, `board_status_ids`, `backlog_query_text`, `backlog_status_ids`）。`InitializeListFilter` で旧カラム検出→コピー＋Todo シード→**旧 `query_text`/`status_ids` を DROP**。`WorkspaceListFilters` 型。`decode` は両キー必須＋既存と同水準のネスト検証。`resolveTodoColumnID(cols)` ヘルパ。
- [x] **Step 4: GREEN** — 上記テスト＋既存 list_filter ハンドラ／統合テスト更新後すべて緑。`docs/api.md` を新形に更新。

---

### Task 2: FE — API・Session・画面配線

**Files:** `list-filter.ts`（型は単体 ListFilter 維持＋`WorkspaceListFilters`）, `api.ts`, `list-filter-session.ts`, `list-filter-bar.ts`, `board.ts`, `backlog.ts`, 各 spec

- [x] **Step 1: 失敗するテスト**
  - session が view 別に独立（board `setQuery` で backlog 不変）
  - **クリアが片側だけ**（clear(board) で backlog 不変）
  - **遷移時 dirty 分離**（board dirty のまま backlog を load しても board draft を捨てない／上書きしない）
  - PUT ボディが両ビュー
  - 初回 load 後、クライアントが Todo 推測の **自動 PUT を発火しない**
  - **PUT/clear 失敗**で成功扱いせず、当該ビューの draft が confirmed に戻る／エラー表示（全体 PUT でも相手ビューを壊さない）
  - **世代ガード**: 古い GET/PUT 応答が新しい入力を上書きしない（既存 session 挙動の回帰）
  - ボード／バックログ各 load が自ビューを表示
- [x] **Step 2: RED** — `npx ng test --watch=false --include='**/list-filter*.spec.ts'`
- [x] **Step 3: 実装** — `ListFilterSession` に `View = 'board'|'backlog'`。`filter(view)` / `setQuery(view,…)` 等。dirty はビュー単位。`load` は両ビューを GET で取り込み、表示は呼び出し元 view。PUT はメモリ上の両 confirmed/draft をマージして全体送信。**列名推測の初回 PUT は書かない**。loadGeneration/saveGeneration を維持（L-037/L-040）。Board/Backlog は自 view を渡す。Bar は view またはフィルタ操作コールバックを受ける。
- [x] **Step 4: GREEN** — list-filter* / board.spec フィルタ節 / backlog.spec フィルタ節。

---

### Task 3: 回帰と手動

- [x] **Step 1:** `go test ./internal/kanban/ -count=1` と FE の board/backlog/list-filter 関連 spec
- [x] **Step 2 手動:**
  - バックログ初期が Todo のみ（Todo 列あり）
  - バックログで絞る → ボードへ移動してもボードは独立（移行後は旧 board または全列）
  - ボードで絞る → バックログの設定が変わらない
  - 各画面でクリア → その画面だけ全列。再読込しても Todo に戻らない
  - **Todo 列なし／改名**: 無効 ID が落ち、空なら全列。クラッシュしない
  - フィルタ中 DnD／件数表示が従来どおり安全

## サブエージェントのレビュー済み

- 第 1 周（要件対応）: 旧カラム DROP・Todo0件・新規行・400・FEクリア/dirty/自動PUT禁止・手動受入5
- 第 2 周（整合と知見）: Initializeシード範囲・L-001/世代ガード・設計手動文言
