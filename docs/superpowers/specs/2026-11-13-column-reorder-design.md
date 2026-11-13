# かんばん列の並び替え 設計書

- 対象機能: かんばん列の並び替え
- 概要: かんばんボード上の列（ステータス）をドラッグ&ドロップで並び替え、MySQL に永続化する。例として `Done` の前に `Review` 等の別ステータスを配置できるようにする。

## 1. 現状の挙動と課題

1. `database/init/001_schema.sql` の `board_columns` には `position INT NOT NULL DEFAULT 0` が定義されており、`GET /api/board` の `Board()` は `SELECT id,name,position FROM board_columns ORDER BY position,id` で取得している。
2. しかし既存の列はすべて `position = 0` のまま登録されており、`CreateColumn` も `INSERT INTO board_columns(name) VALUES(?)` として `position = 0` のデフォルト値で挿入している（`AUTO_INCREMENT` に依存した末尾追加）。
3. そのため、列の並び替えを導入した後に `CreateColumn` が引き続き `position = 0` で挿入すると、新規追加した列が `position >= 1` の既存列より先頭へ割り込んでしまう（`L-540` 相当の順序フィールド不整合）。
4. また、既存の `board.html` / `board.ts` には列を並び替える操作や API が存在しない。

## 2. 設計方針

- 既存ライブラリ方針（「学習で処理を追える構成」「大規模な状態管理・UIライブラリを増やさない」）に沿い、フロントエンドは追加パッケージ（`@angular/cdk` 等）を入れず、ブラウザ標準の HTML5 Drag & Drop API とキーボード操作（`ArrowLeft` / `ArrowRight`）で実装する。
  - ※既知制約: HTML5 Drag & Drop API は多くのモバイルブラウザのタッチジェスチャーでは発火しないため、タッチ環境・キーボード環境ではハンドルへのフォーカス＋左右操作または既存のボード操作を前提とする（将来モバイルでのドラッグが必要になった場合は Pointer Events 化を検討する）。
- DB スキーマ変更（`ALTER TABLE` 等）は不要。既存の `board_columns.position` 列をそのまま活用し、未並び替えの既存列（すべて `position = 0`）も壊さず後方互換を保つ。
- ボード取得 API（`GET /api/board`）が並び替え後の順序で `columns` を返すため、詳細画面やカード追加モーダルのステータス `<select>` も自動的に同じ列順に揃う。

## 3. バックエンド設計

### 3.1 API 仕様

#### `PUT /api/columns/order`

全列の新しい並び順を指定して一括保存する。

- **リクエスト JSON**:
  ```json
  {
    "columnIds": [1, 2, 9, 3]
  }
  ```
  - `DisallowUnknownFields()` および単一 JSON 検証（既存の `decode` ヘルパー）を適用する。
- **バリデーション（HTTP 400）**:
  - `columnIds` が未指定、`null`、または空配列。
  - `columnIds` 内のいずれかの ID が `<= 0`。
  - `columnIds` 内に重複した ID がある。
  - 専用のセンチネルエラー `ErrColumnOrder` を用意し、`fail()` でも HTTP 400（`"列の並び順が不正です。"` 等の日本語メッセージ）にマップする。これによりハンドラー・リポジトリどちらの検証失敗でも 500 にならない。
- **整合性チェック（HTTP 409）**:
  - DB に現在存在する列 ID の集合と `columnIds` の集合が一致しない場合（別操作で新規列が追加された後の古い画面状態からの送信や、存在しない列 ID の混入）。
  - `ErrColumnMismatch` を新設し、`fail()` で HTTP 409 `{"message":"列の構成が変更されています。最新のボードを読み込んでからやり直してください。"}` を返す。
- **成功応答（HTTP 200）**:
  ```json
  {
    "columns": [
      { "id": 1, "name": "Todo", "position": 0 },
      { "id": 2, "name": "Doing", "position": 1 },
      { "id": 9, "name": "Review", "position": 2 },
      { "id": 3, "name": "Done", "position": 3 }
    ]
  }
  ```
  - 更新後に `ORDER BY position, id` で再取得した権威ある列配列を返す。
- **失敗時（HTTP 500）**:
  - DB 更新中にエラーが発生した場合はトランザクションをロールバックし、既存の `fail()` と同様に内部詳細を出さない 500 JSON を返す。

### 3.2 リポジトリと同時実行制御（`L-038`, `L-048`, `L-540`）

#### `ReorderColumns(ctx context.Context, columnIDs []int64) ([]Column, error)`

1. リポジトリ入口でも `validateColumnOrder(columnIDs)` を実行し、空・`<= 0`・重複時は `ErrColumnOrder` を返す。
2. トランザクションを開始し、`defer tx.Rollback()` を設定する。
3. `SELECT id FROM board_columns ORDER BY id FOR UPDATE` により、既存の全列行を主キー昇順（決定的ロック順）で排他ロックする。これにより複数リクエストの同時実行時でもデッドロックしない。
4. 取得した DB の列 ID 集合と `columnIDs` が 1 対 1 で一致することを確認する。不一致ならロールバックして `ErrColumnMismatch` を返す。
5. `columnIDs` のインデックス `0..len-1` を各列の `position` として更新する（`UPDATE board_columns SET position = ? WHERE id = ?`）。※MySQL は値が変わらない行で `RowsAffected() == 0` となるため、`RowsAffected` ではなく `err != nil` で成否判定する。
6. 同トランザクション内で `SELECT id, name, position FROM board_columns ORDER BY position, id` を再取得し、`tx.Commit()` して返す。

#### `CreateColumn(ctx context.Context, name string) (Column, error)` の更新

並び替え後に列を追加しても常に末尾へ配置されるよう、`CreateColumn` をトランザクション化する。

1. トランザクションを開始する。
2. `SELECT position FROM board_columns ORDER BY id FOR UPDATE` で既存行を主キー順ロックし、現在の最大 `position`（列が 0 件なら `-1`）を算出する。
   - ※既存列がすべて `position = 0`（例: 初期 3 列がまだ一度も並び替えられていない状態）で列を追加した場合、最大値 `0` + `1` = `1` が付与され、既存列の後ろに並ぶ。
   - ※並び替え後（`position` が `0..N-1`）に列を追加した場合、`N` が付与され、やはり末尾に並ぶ。
3. `INSERT INTO board_columns(name, position) VALUES(?, ?)` で挿入する。
   - `ReorderColumns` と同じ `ORDER BY id FOR UPDATE` の主キー順ロックを取るため、`ReorderColumns` と `CreateColumn` が並行しても競合シリアライズされ、デッドロックや欠番・先頭割り込みが起きない。
4. Go テストモック（`handler_test.go` の `memoryRepo`）にも `ReorderColumns` を実装し、`Board()` は `(Position, ID)` 昇順で返すよう揃える。

## 4. フロントエンド設計

### 4.1 API クライアント (`frontend/src/app/api.ts`)

- `reorderColumns(columnIds: number[])`:
  - `PUT /api/columns/order` へ `{ columnIds }` を送信し、`Observable<{ columns: Column[] }>` を返す。

### 4.2 ドラッグ&ドロップとキーボード操作 (`board.ts` / `board.html` / `board.css`)

1. **ドラッグ開始境界とカード操作の非干渉（`L-494`, `L-681`）**:
   - カードリンク（`<a class="task-card">`）やカード追加ボタン（`＋`）の操作を妨げないよう、列本体ではなく **列ヘッダー（`<header class="column-heading">`）** に `[attr.draggable]="canReorder() ? 'true' : null"` を設定する（`canReorder()` は `!loading() && !saving() && !reordering() && modal() === null && data().columns.length > 1`）。
   - 列ヘッダー左端にドラッグハンドル兼キーボード操作用ボタン `<button type="button" class="column-drag-handle">`（視覚表現 `⋮⋮`）を配置し、右端の `.icon-button`（カード追加の `＋`）には `draggable="false"` を付ける。
   - `dragstart` ハンドラーでは最初に `(event.target as HTMLElement | null)?.closest('.icon-button')` または `!this.canReorder()` を判定し、該当時は `event.preventDefault()` でドラッグ開始を抑止する。
   - ドラッグ開始時は `event.dataTransfer?.setData('text/plain', String(column.id))` と `event.dataTransfer.effectAllowed = 'move'` を設定し、列要素基準のオフセットで `event.dataTransfer?.setDragImage?.(columnEl, offsetX, offsetY)`（テストモック等で未定義でも安全なオプショナル呼び出し）を実行する。
   - `draggingColumnId` シグナルでドラッグ中の列を追跡し、該当列に `.dragging` スタイル（透明度低下・点線枠等）を付与する。

2. **コンテナ一元管理のドロップ位置計算・ピンポン防止・横スクロール追従（`L-680`, `L-681`, `L-541`）**:
   - 列間の `gap: 20px` 上や高さの異なる列の下部でも途切れずドロップでき、かつカードリンクや外部ファイル等の無関係なドラッグに誤反応しないよう、`dragover`・`drop`・`dragleave` は **`.board-columns`（コンテナ）に一元配置**する。
   - `dragover` / `drop` の先頭で `if (this.draggingColumnId() === null) return;` を確認し、列ドラッグ以外のドラッグ（カードの `<a>` や外部テキスト・ファイル）は無視する。
   - ドラッグ中に配列を即時書き換えるとレイアウトシフトによる境界振動（`L-681`）が起きるため、配列は動かさずに **挿入境界インデックス `dropSlot`（`0 .. columns.length`）** のみを計算する:
     - `.board-columns` 内の全 `.kanban-column` 要素の `getBoundingClientRect()` を参照し、各列の中心 `rect.left + rect.width / 2` より左にある最初の列インデックスを `dropSlot` とする（すべてより右なら `columns.length`）。
     - `insertAt = dropSlot > fromIndex ? dropSlot - 1 : dropSlot` とし、`insertAt === fromIndex`（実質無移動）の場合はドロップインジケーター（縦の挿入バー）を表示せず、ドロップ時も API 送信しない。
     - 列が移動する位置のみ、対応する列の左端（または最後の列の右端）に視覚的なドロップインジケーターを表示する。`.board-columns` に左右各 `4px` 程度の内側余白を持たせ、`dropSlot === 0` の左端インジケーターが `.board-scroll` 左端でクリップされないようにする。
   - **横スクロール自動追従（`L-680`）**:
     - `dragover` 中に `.board-scroll` の `getBoundingClientRect()` を取得し、`clientX < scrollRect.left + 48` なら左方向、`clientX > scrollRect.right - 48` なら右方向へ `boardScroll.scrollLeft` を加算・減算する。
   - **`dragleave` / `dragend` クリーンアップ**:
     - `dragleave` は `!container.contains(event.relatedTarget as Node | null)` の場合のみ `dropSlot` を `null` に戻し、子要素間移動のちらつきを防ぐ。
     - `dragend`（ドロップ未成立・Esc キャンセル含む）で必ず `draggingColumnId` と `dropSlot` を `null` に戻す。
   - **配列境界ガード（`L-541`）**:
     - 並び替え関数では `fromIndex < 0 || fromIndex >= columns.length` または `dropSlot < 0 || dropSlot > columns.length` を即リターンでガードする。

3. **キーボード・アクセシビリティ対応**:
   - `.column-drag-handle` ボタン上で `ArrowLeft` / `ArrowRight` を押下した場合、`reordering()` 等で実行不可でなければ `event.preventDefault()`（`.board-scroll` の横スクロール抑止）を呼び、左右隣へ 1 列移動して同じ保存フローを実行する。
   - 保存中に `[disabled]` を付けると HTML 仕様によりキーボードフォーカスが `document.body` へ脱落するため（フォーカス維持要件と矛盾）、`.column-drag-handle` には `[disabled]` ではなく `[attr.aria-disabled]="!canReorder()"` を使い、ハンドラー内で `!canReorder()` 時に無視する。
   - キーボード移動後の再描画直後およびエラーロールバック後も、移動対象の列（`column.id` に一致する `[data-column-id]` の `.column-drag-handle`）へフォーカスを復元し、`scrollIntoView({ block: 'nearest', inline: 'nearest' })` で画面内に追従させる。
   - ハンドルには `aria-label`（例: `Todo列を移動（ドラッグまたは左右矢印キー）`）を設定し、ボード上に `aria-live="polite"` のステータス通知領域を設けて移動結果（例: `Review列を3番目に移動しました`）を読み上げ可能にする。

4. **楽観更新・排他制御・非破壊エラーバナーとロールバック（`L-001`, `L-038`, `L-039`）**:
   - 初期ロード失敗で画面全体を置換する既存の `error` シグナルとは **独立した `reorderError` シグナル（＋ 409 競合判定用 `reorderConflict`）** を持つ。これにより並び替え失敗時にボードが消えるのを防ぐ。
   - 保存中は `reordering = signal(true)` とし、次のドラッグ/キーボード移動および `openColumn()` / `addColumn()` を抑止する（列追加ボタンも `[disabled]="reordering()"` とする）。
   - UI は即座に新しい列順を楽観反映し、`PUT /api/columns/order` 成功時はサーバー応答の `columns` で確定し、`reorderError` をクリアする。
   - API 失敗時は必ず変更前の `previousColumns` へロールバックし、`.board-scroll` の直前に `role="alert"` の非破壊エラーバナーを表示する。
     - **409 競合時**: 同じ順番の再送は無意味なため「最新の状態を読み込む（`load()`）」ボタンを提示する。
     - **その他エラー（500 等）時**: エラーメッセージを表示し、閉じるボタンおよび「最新の状態を読み込む」ボタン等で回復できるようにする。

### 4.3 詳細画面・追加モーダルとの整合

- `board.html` のアイテム追加モーダル `<select>` と `card-detail.html` のステータス `<select>` はどちらも `GET /api/board` の `columns` 配列順に描画しているため、並び替え後の順序が自動的に反映される。

## 5. テストと検証計画（`L-059`）

1. **Go 単体・HTTP ハンドラーテスト (`handler_test.go`)**:
   - `PUT /api/columns/order` 正常系（4列並び替え後の `GET /api/board` 順序、`position` 値更新）。
   - 異常系: 空配列、`null`、未知フィールド、不正JSON、重複ID、0以下ID（400）、存在しない列IDや不足列ID（409）。
2. **Go 実 MySQL 統合テスト (`KANBAN_TEST_DSN`)**:
   - 初期状態（すべて `position = 0`）からの並び替え永続化と `Board()` 応答順。
   - 並び替え後の `CreateColumn` が常に末尾（`MAX(position) + 1`）へ追加されること。
   - `PUT /api/columns/order` で一部列欠落・未知ID時に `ErrColumnMismatch`（409）となり既存 `position` が一切変化しないこと。
   - 20 ゴルーチン並行 `ReorderColumns` および `ReorderColumns` + `CreateColumn` 並行実行でデッドロック・データ破壊が起きないこと。
3. **Angular 単体テスト (`api.spec.ts`, `board.spec.ts`)**:
   - `Api.reorderColumns` が `PUT /api/columns/order` へ `{ columnIds }` を送信しエラー伝播すること。
   - ドラッグ&ドロップによる列移動（前方→後方、後方→前方、gap 上のドロップ、同一位置 no-op、カードリンクや外部ドラッグの非干渉、`＋` ボタン上のドラッグ抑止）。
   - キーボード `ArrowLeft` / `ArrowRight` による列移動・境界での無動作・フォーカス保持・`preventDefault()` 確認。
   - 送信中の二重移動・列追加抑止、API エラー時（500 / 409）のロールバックと非破壊エラーバナー表示（ボード維持確認）。
4. **実ブラウザ・独立検証環境**:
   - 本番利用中の DB（ポート 3307/4200）は変更せず、独立 Docker Compose またはテスト DB / dev サーバーを使い、実ブラウザでドラッグ&ドロップ・キーボード移動・リロード後の永続化・詳細画面のステータス `<select>` 順序・横スクロールを確認する。
