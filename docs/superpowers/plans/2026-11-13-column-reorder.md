# かんばん列の並び替え 実装計画

- 設計書: [2026-11-13-column-reorder-design.md](../specs/2026-11-13-column-reorder-design.md)
- 作業ディレクトリ: `$REPO/.worktrees/feat-column-reorder`
- ブランチ: `feat/column-reorder`

## 1. 実装タスク分解

### Step 1: バックエンド インターフェース・エラー・バリデーション・リポジトリ + TDD

1. **モデル・エラー定義 (`backend/internal/kanban/model.go`, `http_transport.go`, `validation.go`)**
   - `model.go`:
     - `ErrColumnOrder = errors.New("invalid column order")`
     - `ErrColumnMismatch = errors.New("column set mismatch")`
     - `Repository` インターフェースに `ReorderColumns(context.Context, []int64) ([]Column, error)` を追加。
   - `http_transport.go`:
     - `fail()` に `ErrColumnOrder` -> HTTP 400 (`"列の並び順を確認してください。"`), `ErrColumnMismatch` -> HTTP 409 (`"列の構成が変更されています。最新のボードを読み込んでからやり直してください。"`) を追加。
   - `validation.go`:
     - `validateColumnOrder(columnIDs []int64) error`: 空配列、`<= 0`、重複 ID の場合に `ErrColumnOrder` を返す純粋関数を追加。

2. **ハンドラーとモック更新 (`backend/internal/kanban/handler.go`, `handler_test.go`, `column_order_handler_test.go`)**
   - `handler.go`:
     - `mux.HandleFunc("PUT /api/columns/order", h.reorderColumns)` を登録。
     - `reorderColumns` で `{"columnIds": []int64}` を `decode` し、`validateColumnOrder` 後に `h.repo.ReorderColumns(r.Context(), in.ColumnIDs)` を呼び出し、成功時 `200` で `{"columns": columns}` を返す。
   - `handler_test.go`:
     - `memoryRepo` に `ReorderColumns` を実装し、`Board()` は `(Position, ID)` 昇順のコピーを返すよう修正。`CreateColumn` も MySQL 実装と同じく現在最大 `Position`（0 件時は `-1`）+ 1 を採番するよう揃える（全既存ハンドラーテストがコンパイル・成功する状態を維持）。
   - **RED → GREEN (`backend/internal/kanban/column_order_handler_test.go`)**:
     - 先にハンドラーテストを追加し、未実装での失敗（RED）→ 実装後の成功（GREEN）を確認。
     - テストケース:
       - 4 列並び替え成功・`position` 更新・`GET /api/board` 順序反映・並び替え後 `POST /api/columns` の末尾配置。
       - 異常入力（HTTP 400）: `columnIds` 未指定 / `null` / `[]` / 重複 / `0` / 負数 / 未知フィールド / 不正 JSON。
       - 集合不一致（HTTP 409）: 存在しない ID、一部列の欠落。
       - ストレージ失敗（HTTP 500）: `ReorderColumns` が予期せぬエラーを返した場合に HTTP 500 となり、内部エラー文字列を含まない日本語 JSON を返し、既存の列順序が維持されること。

3. **MySQL リポジトリ実装 (`backend/internal/kanban/column_order.go`, `repository.go`) + 統合テスト (`column_order_integration_test.go`)**
   - `repository.go` / `column_order.go`:
     - 共通ヘルパー `lockColumnRows(ctx, tx)` で `SELECT id, name, position FROM board_columns ORDER BY id FOR UPDATE` を実行。
     - `CreateColumn`: トランザクションを開始し `lockColumnRows` で最大 `position`（0 件時は `-1`）を求めて `nextPos = maxPos + 1` で `INSERT INTO board_columns(name, position) VALUES(?, ?)`、コミット。
     - `ReorderColumns`: `validateColumnOrder` → トランザクション開始 → `lockColumnRows` → 集合一致検証（不一致は `ErrColumnMismatch`）→ 各列 `UPDATE board_columns SET position = ? WHERE id = ?`（`err != nil` 判定）→ `ORDER BY position, id` で再取得 → コミット。
   - **RED → GREEN (`backend/internal/kanban/column_order_integration_test.go`)**:
     - `mysqlTestDB(t, "")`（`KANBAN_TEST_DSN` で使い捨て DB `scrumboard_numbering_test` を指定）を用いて検証:
       - 初期 3 列（`position = 0`）を並び替えて `Board()` 順が永続化されること。
       - 並び替え後に `CreateColumn("Review")` を呼ぶと末尾に追加され、さらに `Review` を `Done` の前に移動できること。
       - 列欠落 / 未知 ID で `ErrColumnMismatch` を返し、既存列の `position` が一切変化しないこと。
       - 20 ゴルーチン並行 `ReorderColumns`、および `ReorderColumns` + `CreateColumn` 並行実行でデッドロック・データ不整合が起きないこと。

---

### Step 2: フロントエンド API・並び替えロジック・UI + TDD

1. **純粋ロジック分離 (`frontend/src/app/column-order.ts`, `column-order.spec.ts`)**
   - **RED → GREEN**:
     - `computeDropSlot(clientX: number, columnBounds: readonly { left: number; width: number }[]): number`: 各列中心との比較から挿入境界 `0..N` を返す。
     - `targetColumnIndex(fromIndex: number, dropSlot: number, length: number): number | null`: 配列境界・実質無移動（`insertAt === fromIndex`）をガードし、移動先インデックスまたは `null` を返す。
     - `moveColumn(columns: readonly Column[], fromIndex: number, toIndex: number): Column[]`: 境界チェック付きでイミュータブルに並び替えた列配列（暫定 `position: i`）を返す。
     - `computeAutoScrollDelta(clientX: number, containerLeft: number, containerRight: number): number`: 左右 48px ゾーンに応じた横スクロール増分を返す。

2. **API クライアント (`frontend/src/app/api.ts`, `api.spec.ts`)**
   - **RED → GREEN**:
     - `reorderColumns(columnIds: number[])` を追加し、`PUT /api/columns/order` へ `{ columnIds }` を送信して `{ columns: Column[] }` を返すこと・エラー伝播を `api.spec.ts` で検証。

3. **ボード UI・DnD・キーボード・エラー回復 (`frontend/src/app/board.ts`, `board.html`, `board.css`, `board.spec.ts`)**
   - `board.ts`:
     - シグナル: `reordering = signal(false)`, `reorderError = signal('')`, `reorderConflict = signal(false)`, `reorderAnnouncement = signal('')`, `draggingColumnId = signal<number | null>(null)`, `dropSlot = signal<number | null>(null)`。
     - `canReorder = computed(() => !this.loading() && !this.saving() && !this.reordering() && this.modal() === null && this.data().columns.length > 1)`。
     - Template 参照は `viewChild<ElementRef<HTMLElement>>('boardScroll')` および `viewChild<ElementRef<HTMLElement>>('columnsContainer')`、`afterNextRender(..., { injector: this.injector })` を使用し、既存の `new Board()` 単体テスト（`runInInjectionContext`）を壊さない。
     - `onColumnDragStart(event, column, columnEl)`: `.icon-button` 配下や `!canReorder()` なら `preventDefault()` して無視。`dataTransfer?.setData('text/plain', String(column.id))`、`effectAllowed = 'move'`、`setDragImage?.(columnEl, offsetX, offsetY)` を実行。
     - `onColumnsDragOver(event)`: `draggingColumnId() === null` なら何もしない。`event.preventDefault()`、`dataTransfer.dropEffect = 'move'`、横スクロール自動追従、`.kanban-column` 群の `getBoundingClientRect()` から `computeDropSlot` を算出し、`targetColumnIndex` が有効なら `dropSlot` を設定（無移動スロットなら `null`）。
     - `onColumnsDragLeave(event)`: `!container.contains(event.relatedTarget as Node | null)` のときのみ `dropSlot.set(null)`。
     - `onColumnsDrop(event)`: `draggingColumnId() === null` なら無視。`event.preventDefault()`、現在位置と `dropSlot` から `applyReorder(fromIndex, toIndex)` を呼び出し、ドラッグ状態をリセット。
     - `onColumnDragEnd()`: `draggingColumnId.set(null)`、`dropSlot.set(null)`。
     - `onHandleKeydown(event, columnIndex)`: `ArrowLeft` / `ArrowRight` かつ移動可能範囲内なら `event.preventDefault()` を呼び、`applyReorder` を実行し、`focusAfterRender(column.id)` をスケジュール（再描画後に `handle.focus()` とテスト環境配慮のオプショナル呼び出し `handle.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })` を実行）。
     - `applyReorder(fromIndex, toIndex, focusColumnId?)`:
       - 送信中（`reordering()`）は二重実行しない。`previousColumns` を退避し楽観更新。
       - `reordering.set(true)`, `reorderError.set('')`, `reorderConflict.set(false)`。
       - `api.reorderColumns(...)`: 成功時にサーバー返却 `columns` を反映・`reorderAnnouncement` 設定・必要時フォーカス復元。失敗時に `previousColumns` へロールバック、`reorderError.set(errorMessage(e))`、`reorderConflict.set(e?.status === 409)`、必要時フォーカス復元。
     - `dismissReorderError()`: `reorderError.set('')` と `reorderConflict.set(false)`（非競合バナー用）。
     - `openColumn()` / `addColumn()`: `this.reordering()` 中は開始しない（レース防止）。
     - `load()`: 開始時に `reorderError.set('')`・`reorderConflict.set(false)` でクリア。
   - `board.html`:
     - `.board-scroll` の直前に `reorderError()` 用の非破壊アラートバナー（`role="alert"`、「最新を読み込む（`load()`）」ボタン、および `!reorderConflict()` 時のみ「閉じる」ボタン）。
     - `aria-live="polite"` の視覚隠しライブ通知領域（`.sr-only`）。
     - `<div class="board-columns" #columnsContainer (dragover)="..." (dragleave)="..." (drop)="...">`。
     - 各 `<section #colSection class="kanban-column" [attr.data-column-id]="column.id" [class.dragging]="..." [class.drop-before]="..." [class.drop-after]="...">`。
     - `<header class="column-heading" [attr.draggable]="canReorder() ? 'true' : null" (dragstart)="onColumnDragStart($event, column, colSection)" (dragend)="onColumnDragEnd()">`:
       - 左端に `<button type="button" class="column-drag-handle" [attr.aria-disabled]="!canReorder()" ... (keydown)="onHandleKeydown($event, index)">`（`⋮⋮` 表示）。
       - 右端のカード追加ボタンに `draggable="false"`。
     - `<button class="add-column-tile" [disabled]="reordering()" ...>`。
   - `board.css`:
     - `.board-columns` に左右 `4px` パディング（左端ドロップインジケーターのクリップ防止）。
     - `.kanban-column` に `position: relative` を追加（`.drop-before::before` / `.drop-after::after` 縦アクセントバーの配置基準）。
     - `.column-heading`（`cursor: grab` 等）、`.column-drag-handle`、`.kanban-column.dragging`、`.drop-before::before` / `.drop-after::after`、`.reorder-alert` バナー、`.sr-only` スタイル。
   - **RED → GREEN (`board.spec.ts`)**:
     - D&D 前方/後方移動・`20px` gap 上ドロップ・実質無移動（no-op）・カードリンクや外部ドラッグの非干渉・`＋` ボタンからのドラッグ抑止。
     - キーボード `ArrowLeft` / `ArrowRight` による移動・`preventDefault()` 呼び出し・先頭列 `ArrowLeft` と末尾列 `ArrowRight` での無動作（API 非送信・フォーカス保持）・フォーカス復元・`aria-live="polite"` 通知文字列の更新。
     - `reordering()` 中および 1 列以下のとき `canReorder()` が `false` となり移動・列追加が抑止されること（`scrollIntoView` 未定義の jsdom でも落ちないこと）。
     - API 500 エラー時のロールバック＋閉じる可能な非破壊バナー表示（ボード非消滅）、および API 409 競合時のロールバック＋競合バナー（「最新を読み込む」表示・閉じる非表示）＋再読込実行による復旧。
     - 既存の `TestBed.runInInjectionContext(() => new Board())` を含む全テスト維持。

---

### Step 3: ドキュメント更新と実環境・ブラウザ総合検証

1. `docs/api.md` に `PUT /api/columns/order` の仕様・例・エラー表を追加。
2. 検証実行:
   - `cd backend && go test -race -count=1 ./...`（実 MySQL `KANBAN_TEST_DSN` で `scrumboard_numbering_test` を指定して実行）および `go vet ./...`
   - `cd frontend && npm test -- --watch=false`、`npm run build`、`./node_modules/.bin/prettier --check "src/**/*.{ts,html,css}"`
   - 本番ポート（3307/4200）に触れない独立 Docker Compose プロジェクト（例: `scrumboard-column-order-check`, `MYSQL_PORT=3308 API_PORT=8081 WEB_PORT=4201`）を起動し、API 直通 + Web プロキシ経由 + 実ブラウザでのドラッグ&ドロップ操作・キーボード操作・リロード永続化・新規列末尾追加・詳細画面ステータス `<select>` 順序・横スクロールおよび狭幅画面（`@media (max-width: 700px)`）表示を確認（検証後に専用ボリュームごと破棄）。
3. 検証結果を `docs/verification.md` に追記。

## 2. 変更予定ファイル一覧

- バックエンド:
  - `backend/internal/kanban/model.go`
  - `backend/internal/kanban/http_transport.go`
  - `backend/internal/kanban/validation.go`
  - `backend/internal/kanban/handler.go`
  - `backend/internal/kanban/repository.go`
  - `backend/internal/kanban/column_order.go`（新規）
  - `backend/internal/kanban/handler_test.go`
  - `backend/internal/kanban/column_order_handler_test.go`（新規）
  - `backend/internal/kanban/column_order_integration_test.go`（新規）
- フロントエンド:
  - `frontend/src/app/column-order.ts`（新規）
  - `frontend/src/app/column-order.spec.ts`（新規）
  - `frontend/src/app/api.ts`
  - `frontend/src/app/api.spec.ts`
  - `frontend/src/app/board.ts`
  - `frontend/src/app/board.html`
  - `frontend/src/app/board.css`
  - `frontend/src/app/board.spec.ts`
- ドキュメント:
  - `docs/api.md`
  - `docs/verification.md`
