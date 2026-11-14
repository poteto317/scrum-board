# カードのドラッグ＆ドロップ移動・並べ替え 設計書

- 対象機能: ドラッグ＆ドロップでカードの移動・並べ替えを実装する（カード #1）
- 概要: ボード上のカードを列内で並べ替え、別ステータス列へ移動できるようにする。順序は MySQL に永続化し、詳細画面のステータス選択による移動も維持する。

## 決めたこと

| 項目 | 選択 | 根拠 |
| --- | --- | --- |
| DnD 実装 | **B: `@angular/cdk` DragDrop を新規導入** | ユーザー選択。接続リスト（列間）とプレビューが標準で揃う |
| API | **A: 列単位の完全順を送る一括保存**（複数列を1リクエスト可） | 未回答のため推奨。列並び替え `PUT /api/columns/order` と同型。列間移動はソース＋デストを1トランザクションで送り `L-038` を避ける |
| カード操作 | **B: カード全体をドラッグ可能。短い移動距離はクリック（詳細へ）** | ユーザー選択 |
| 履歴 | **A: 列（ステータス）変更のみ履歴。列内並び替えは履歴なし** | 未回答のため推奨 |
| 詳細のステータス選択 | **A: 残す。移動先列の末尾へ追加** | 未回答のため推奨。既存 MVP 手段を壊さない |

## 1. 現状の挙動と課題

1. `cards` テーブルに順序用の `position` が無く、`Board()` は `ORDER BY c.created_at, c.id` 固定である。
2. カード移動は詳細画面（および `PATCH .../status`）の列変更のみ。ボード上の DnD はない。
3. 列の並び替えは HTML5 DnD で実装済み。カードは `<a class="task-card" routerLink>` のため、全体ドラッグとクリック遷移が衝突しうる。
4. README の拡張例は「カードに `position` を追加し Angular CDK と API を接続」と明記されている。
5. 既存 DB は init SQL の再実行では変わらないため、API 起動時の冪等マイグレーションが必要（採番・履歴と同様）。

## 2. 設計方針

- フロントは `@angular/cdk/drag-drop` を Angular 21 系の版で追加する。列 DnD は既存の HTML5 実装のまま残し、カード DnD だけ CDK にする（一気に列まで CDK 化しない＝YAGNI）。
- DB に `cards.position` を追加し、列内は `ORDER BY position, id`、ボード全体は列順とは独立にカード配列を返し、UI が列ごとにグルーピングする（現行と同じ）。
- 並び替え・列間移動の永続化は **1 リクエスト・1 トランザクション**。失敗時は UI をロールバックし、ボード全体を消す初期ロード用 `error` とは別の非破壊バナーを使う（列並び替えと同型。`L-001`, `L-038`）。
- カード DnD 中は列ヘッダー DnD と干渉しないこと。列の `dragstart` は現行どおり列ヘッダー起点のみ。
- タッチでの CDK ドラッグは CDK の既定に任せる。キーボードはカードにフォーカス可能な操作で上下移動（および列間は既存のステータス選択を主経路とし、キーボードでの列間移動は必須にしない）。

## 3. バックエンド設計

### 3.1 スキーマ

`database/init/001_schema.sql` の `cards` に以下を追加する（新規ボリューム向け）。

- `position INT NOT NULL DEFAULT 0`
- インデックス: `INDEX cards_column_position (column_id, position, id)`（旧 `cards_order (created_at,id)` と `cards_column` は、ボード一覧が position 順になるため `cards_column_position` に置き換えてよい。履歴・採番の `ORDER BY created_at,id` は明示 SQL のまま残す）

既存ボリューム向け起動時マイグレーション（新ファイル例: `card_position.go`）:

1. `information_schema` または `SHOW COLUMNS` 相当で `cards.position` の有無を確認し、無ければ `ALTER TABLE cards ADD COLUMN position INT NOT NULL DEFAULT 0`。
2. **冪等バックフィル**: 列を今追加した直後、または「カードが2枚以上ある列で `position` がすべて同一」の列に限り、`ORDER BY created_at, id` で `0..n-1` を割り当てる。既に列内で異なる `position` がある列は触らない（再起動で DnD 順を消さない。`L-540`）。
3. インデックスが無ければ `cards_column_position` を追加する。
4. 失敗したら起動中止（採番マイグレーションと同方針）。

### 3.2 モデル

- `Card` に `Position int \`json:"position"\`` を追加する。
- `scanCard` / `cardFields` に `c.position` を含める。
- `Board()` のカード取得を `ORDER BY c.position, c.id` に変更する。
- エラー: `ErrCardOrder`（400 用）、`ErrCardOrderMismatch`（409 用）を追加する。

### 3.3 API: `PUT /api/cards/order`

列並び替えに揃え、**影響する列すべての「完全な cardId 順」を1回で送る**。

**リクエスト:**

```json
{
  "columns": [
    { "columnId": 1, "cardIds": [3, 5] },
    { "columnId": 2, "cardIds": [1, 7, 4] }
  ]
}
```

- 列内並べ替えのみなら `columns` は1要素。
- 列間移動では、ソース列とデスト列の両方を含める（CDK ドロップ後の両リスト）。1列だけ送って「足りない ID は他列へ残す／消す」はしない。

**バリデーション（HTTP 400）:**

- `columns` 欠落・null・空。
- 各要素の `columnId <= 0`、`cardIds` 欠落・null（空配列は「その列にカード0枚」として許可）。
- `cardIds` 内の `<= 0` または重複（リクエスト全体でもカード ID の重複不可）。
- `columns` 内の `columnId` 重複。
- 未知フィールド・不正 JSON（既存 `decode` + `DisallowUnknownFields`）。

**整合性（HTTP 409）:**

トランザクション内で次を満たさない場合 `ErrCardOrderMismatch`:

1. リクエストの各 `columnId` が実在する。
2. リクエストに現れる全 `cardId` が実在する。
3. **集合一致**: 「リクエストに含まれる各列に現在属するカード ID の和集合」＝「リクエストの全 `cardIds` の和集合」。  
   （他列のカードをデストに入れたい場合は、そのカードの現在列も `columns` に含め、移動後の順で送る。）

**成功（HTTP 200）:**

```json
{
  "cards": [ /* 更新後、Board() と同じ順（position, id）の全カード配列 */ ]
}
```

権威は DB。応答の `cards` は常に全カードを返す。クライアントはそれでボードのカード配列を置き換える（列配列は変えない）。

**リポジトリ `ReorderCards(ctx, []CardColumnOrder) ([]Card, error)`:**

1. 入口でもバリデーションし、失敗時 `ErrCardOrder`。
2. トランザクション開始。`board_columns` を `ORDER BY id FOR UPDATE` でロックし、列 ID の存在確認。
3. 対象になりうるカードをロック: リクエスト列に属するカード、およびリクエストの全 cardId を `SELECT id FROM cards WHERE ... ORDER BY id FOR UPDATE`。`ORDER BY` は結果の整列でしかなく、InnoDB は使うインデックスの走査順（テーブルが大きいと `cards_column_position`、小さいと主キー）で行ロックを取るため、`cards` のロック順は保証しない。書き込み経路どうしの直列化は手順 2 の全列ロックが担う（§3.4）。
4. 集合一致を検証。不一致なら `ErrCardOrderMismatch`。
5. 各 `(columnId, cardIds[i])` について、`column_id` と `position` の両方が現在値と同じカードは UPDATE しない。列が変わったカードは `UPDATE cards SET column_id=?, position=?, updated_at=?`、位置だけ変わるカードは `updated_at=updated_at` で据え置いて `column_id`・`position` のみ更新する。`updated_at` は「カードの編集時刻」で、ステータス変更でだけ動く（履歴の方針と一致。触っていないカードの更新日時や履歴の revision を変えない）。`RowsAffected` には依存しない（`L-540`）。
6. **履歴**: 更新前後で `column_id` が変わったカードだけ `appendHistory(..., "updated")`（status 変更として既存の historyValues 経路）。`position` のみの変更は履歴に載せない。
7. コミット前に `ORDER BY position, id` で全カードを再読込して返す。

### 3.4 `CreateCard` / `UpdateCard` の position（`L-540`）

- **ロック順（全経路共通）**: `CreateCard`、`UpdateCard`（`columnId` 指定時）、`ReorderCards` は、`cards` に触れる前に `board_columns` を `ORDER BY id FOR UPDATE`（全列 X ロック）で取る。外部キー検査が `board_columns` の共有ロックを取るため、`cards` を先に握った経路と列を先に握った経路が混ざると循環待ち（MySQL 1213）になる。実 MySQL で、列ロックなしの `ReorderCards` と `CreateCard`/`UpdateCard` を 60 並行で混ぜると reorder の大半が 1213 になることを確認した。共有ロック（`FOR SHARE`）では Create と Move の `cards` ロック順の違いが残るため不可。ボード全体の書き込みが直列化されるが、列の並び替え・作成が既に同じロックを取っており、1 人用の小さなボードでは問題にならない。
- **CreateCard**: 全列ロック（存在しない列なら `ErrColumn`）の後、当該 `column_id` のカードを `ORDER BY id FOR UPDATE` で読み、`MAX(position)`（カード0なら `-1`）をとり `position = max+1` で INSERT。
- **UpdateCard で `columnId` が変わるとき**: 全列ロックの後、対象カードを単独で `FOR UPDATE` し、移動先のカードを読んで `MAX(position)+1` を付与する。同一トランザクションでソース列の残カードを `ORDER BY position, id` の現順で `0..n-1` に詰め直す。詰め直しは `position` が変わるカードだけを、`updated_at` を据え置いて更新する（`updated_at=updated_at`）。履歴は列変更の1イベントのみ（詰め直し自体は履歴に載せない）。
- **UpdateCard で列が変わらないとき**: `position` は触らない。
- **by-number status / 詳細のステータス選択**: 既存どおり `UpdateCard` の `ColumnID` 経由 → 末尾追加になる。

### 3.5 ハンドラー

- `PUT /api/cards/order` を登録。
- `fail()` に `ErrCardOrder` → 400、`ErrCardOrderMismatch` → 409（メッセージは列並び替えに合わせた日本語）を追加。

## 4. フロントエンド設計

### 4.1 依存

- `frontend/package.json` に `@angular/cdk`（`@angular/core` と同じメジャー。例 `^21.2.0`）を追加し、lockfile を更新する。

### 4.2 API クライアント

- `reorderCards(columns: { columnId: number; cardIds: number[] }[])`: `PUT /api/cards/order`、戻り `Observable<{ cards: Card[] }>`。

### 4.3 モデル

- `Card` に `position: number` を追加。ボード描画の `grouped` は API 順（列内は既に position 順）を維持する。クライアント側で再ソートする場合は `position, id`。

### 4.4 ボード UI（CDK）

1. 各列のカードリストを `cdkDropList` にし、`cdkDropListData` にその列のカード配列（または ID）を渡す。全列を `cdkDropListConnectedTo` で相互接続する。
2. 各カード根要素に `cdkDrag`。`<a routerLink>` を維持する場合:
   - `pointerdown` で開始座標を記録。
   - `cdkDragMoved` / 自前の pointermove で移動距離が閾値（**8px**）を超えたら `cardDragMoved = true`。
   - `(click)` で `cardDragMoved` なら `preventDefault()` + `stopPropagation()` し遷移しない。超えなければ通常のリンク遷移。
   - `cdkDragEnded` でフラグをリセット。
   - あるいはルートを `<div class="task-card" cdkDrag>` + 内部クリックで `Router.navigate` に替え、同じ閾値ロジックを使う。どちらか一方に統一する（実装プランでファイル単位に固定）。
3. `(cdkDropListDropped)` で:
   - `L-541` どおりインデックス範囲をガード。
   - 同一位置 no-op なら API しない。
   - 楽観的に `data().cards` を更新（`columnId` / 列内順）。
   - 影響列（`event.previousContainer !== event.container` なら2列、同一なら1列）の `{ columnId, cardIds }` を組み立て `reorderCards`。
   - 成功: 応答 `cards` で確定。失敗: 変更前スナップショットへロールバック＋非破壊エラー（列並び替えの `reorderError` と共用するか、`cardReorderError` を分ける。共用する場合は文言と 409 時の「再読込」をカード用でも使えるようにする）。
4. 保存中は `reordering`（または `cardReordering`）で次のカード DnD・列 DnD・列追加を抑止する。
5. 列ヘッダー HTML5 DnD との共存: カード上では列の `draggingColumnId` を立てない。列の `dragover`/`drop` は現行どおり `draggingColumnId === null` なら無視。
6. ドラッグ中のボード横スクロール: CDK の近傍自動スクロール、または列 DnD と同様に端での `scrollLeft` 補正（`L-680`）。縦に長い列では列コンテナの縦スクロールも考慮する。
7. キーボード: フォーカス可能なカード（`tabindex="0"`）またはカード内の移動用コントロールで `ArrowUp` / `ArrowDown` により同一列内で1つ移動し、同じ保存 API を呼ぶ。保存中は `aria-disabled` で無視（`disabled` でフォーカス脱落させない。列 DnD と同じ）。`aria-live` で結果を通知する。
8. 空列へのドロップ: 空の `cdkDropList`（列ボディ）をドロップ対象として確保し、高さ・`min-height` でヒット領域を維持する。

### 4.5 ドキュメント

- `docs/api.md` に `PUT /api/cards/order` を追記。
- `README.md` の「できること」と拡張例を、カード DnD 実装済みの記述に更新する（拡張リストから該当行を落とすか「実装済み」にする）。
- `docs/verification.md` に手動確認項目があれば追記。

## 5. テストと検証計画（`L-059`）

1. **Go ハンドラー**: 正常な列内並べ替え、列間移動（2列ペイロード）、空列への移動、400 系、409 集合不一致、履歴が列変更時のみ増えること。
2. **Go MySQL 統合**（`KANBAN_TEST_DSN`）: マイグレーション後の position バックフィル、永続化、CreateCard 末尾、UpdateCard 列変更で末尾、並行 Reorder で破壊なし。
3. **Angular**: `Api.reorderCards`、ドロップ（同一列・列間・no-op）、クリック閾値（短い動きは遷移・長い動きは非遷移）、エラー時ロールバック、空列ドロップ。
4. **実ブラウザ**（利用中 DB を壊さない独立環境）: DnD、リロード後の順、詳細ステータス移動が末尾、列 DnD がカード操作を壊さないこと。

## 6. 非目標（YAGNI）

- 列 DnD の CDK 化、リアルタイム同期、競合の OT/CRDT、タッチ専用の別 UI、カードの複数選択一括移動、並び替えの履歴イベント、認証。

## 7. 知見 ID（実装・プランに反映）

- `L-001`, `L-038`, `L-048`, `L-494`, `L-540`, `L-541`, `L-680`, `L-681`, `L-015`
