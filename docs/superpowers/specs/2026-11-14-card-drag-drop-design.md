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
3. 列の並び替えは HTML5 DnD で実装済み。カードは、この設計の起点では `<a class="task-card" routerLink>` で、全体ドラッグとクリック遷移が衝突しうる。main の「カードリンクのワンクリックコピー」（`2026-11-14-copy-card-link-design.md`）はこれを `<article class="task-card">` の中に「コピーボタン」と「本文リンク `<a class="task-card-body" routerLink>`」を並べる構造へ変えた。本設計は、その構造を残したままカード DnD を載せる（§4.4）。
4. README の拡張例は「カードに `position` を追加し Angular CDK と API を接続」と明記されている。
5. 既存 DB は init SQL の再実行では変わらないため、API 起動時の冪等マイグレーションが必要（採番・履歴と同様）。

## 2. 設計方針

- フロントは `@angular/cdk/drag-drop` を Angular 21 系の版で追加する。列 DnD は既存の HTML5 実装のまま残し、カード DnD だけ CDK にする（一気に列まで CDK 化しない＝YAGNI）。
- DB に `cards.position` を追加し、列内は `ORDER BY position, id`、ボード全体は列順とは独立にカード配列を返し、UI が列ごとにグルーピングする（現行と同じ）。
- 並び替え・列間移動の永続化は **1 リクエスト・1 トランザクション**。失敗時は UI をロールバックし、ボード全体を消す初期ロード用 `error` とは別の非破壊バナーを使う（列並び替えと同型。`L-001`, `L-038`）。
- カード DnD 中は列ヘッダー DnD と干渉しないこと。列の `dragstart` は現行どおり列ヘッダー起点のみ。
- タッチでの CDK ドラッグは CDK を使うが、`dragStartDelay` の既定（0）のままだと、カード上のスワイプが閾値（8px）を超えた時点でドラッグになってリストやボードをスクロールできない（カードは列幅のほぼ全面を占める）。そのためタッチだけ 200ms 押し続けてからドラッグにする（`dragStartDelay: { touch: 200, mouse: 0 }`。マウスは即時）。CDK は静止時に `touch-action` を付けないので、遅延の間のスワイプはブラウザーのスクロールになる。キーボードはカードにフォーカス可能な操作で上下移動（および列間は既存のステータス選択を主経路とし、キーボードでの列間移動は必須にしない）。

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
3. リクエストの列に現在属するカードをロック: `SELECT id FROM cards WHERE column_id IN (<リクエストの列>) ORDER BY id FOR UPDATE`。リクエストの `cardIds` にあってもこれらの列に属さないカード（他の列のカード）はロックせず、手順 4 の集合検証で不一致となり 409 になる（§3.3 整合性 3）。`ORDER BY` は結果の整列でしかなく、InnoDB は使うインデックスの走査順（テーブルが大きいと `cards_column_position`、小さいと主キー）で行ロックを取るため、`cards` のロック順は保証しない。書き込み経路どうしの直列化は手順 2 の全列ロックが担う（§3.4）。
4. 集合一致を検証。不一致なら `ErrCardOrderMismatch`。
5. 各 `(columnId, cardIds[i])` について、`column_id` と `position` の両方が現在値と同じカードは UPDATE しない。列が変わったカードは `UPDATE cards SET column_id=?, position=?, updated_at=?`、位置だけ変わるカードは `updated_at=updated_at` で据え置いて `column_id`・`position` のみ更新する。`updated_at` は「カードの編集時刻」で、ステータス変更でだけ動く（履歴の方針と一致。触っていないカードの更新日時や履歴の revision を変えない）。`RowsAffected` には依存しない（`L-540`）。
6. **履歴**: 更新前後で `column_id` が変わったカードだけ `appendHistory(..., "updated")`（status 変更として既存の historyValues 経路）。`position` のみの変更は履歴に載せない。
7. コミット前に `ORDER BY position, id` で全カードを再読込して返す。

### 3.4 `CreateCard` / `UpdateCard` の position（`L-540`）

- **ロック順（全経路共通）**: `CreateCard`、`UpdateCard`（`columnId` または `prUrls` 指定時）、`DeleteCard`、`ReorderCards`、`ReorderBacklog`（プロダクトバックログの並び替え。`backlog_position` を更新する）、履歴取り込み（`ImportHistory`、`cmd/import-history`）は、`cards` に触れる前に `board_columns` を `ORDER BY id FOR UPDATE`（全列 X ロック）で取る。外部キー検査が `board_columns` の共有ロックを取るため、`cards` を先に握った経路と列を先に握った経路が混ざると循環待ち（MySQL 1213）になる。実 MySQL で、列ロックなしの `ReorderCards` と `CreateCard`/`UpdateCard` を 60 並行で混ぜると reorder の大半が 1213 になることを確認した。共有ロック（`FOR SHARE`）では Create と Move の `cards` ロック順の違いが残るため不可。`DeleteCard` も対象で、`DELETE` は主キー→セカンダリインデックスの順に、`lockCardsInColumns`/`nextCardPosition` はセカンダリ→主キーの順にロックするため、全列ロックの外に置くと逆順の循環待ちになる（実 MySQL で再現）。`ImportHistory` は `cards` を ID 順に 1 枚ずつ `FOR UPDATE` するだけで列ロックを持たなかったため、`lockCardsInColumns` / `nextCardPosition` のインデックス走査順と交差して 1213 になった（実 MySQL で `ReorderCards`・`CreateCard` の両方と再現。取り込み開始直後に全列ロックを取ると消える）。`ReorderBacklog` は `cards` を主キー順に全行 `FOR UPDATE` するだけで列ロックを持たなかったため、`ReorderCards` のインデックス走査順と逆順になり、80 並行で約 3 分の 1 が 1213 になった（レビューで実測。`BeginTx` 直後に全列ロックを取ると消える）。`CreateCard` の `backlog_position` 採番（`nextBacklogPosition`）は全列ロックの後に実行されるため安全で、起動時のバックフィル（`backfillIdenticalBacklogPositions`）はサーバー起動前の単独実行なので対象外。`UpdateCard` の `prUrls` の書き換え（`replacePRURLs`。複数 PR 紐付け、PR #8）は `cards` ではなく `card_pr_links` に書くが、これも全列ロックの対象にした。`card_pr_links` を `DELETE`→`INSERT` するとき、初回保存のカードには消す行がなく、`DELETE` が `card_id` の隙間にギャップロックを取る。別のカードの初回保存が同じ隙間に `INSERT` しようとして互いに待ち、1213 になる（`TestMySQLPRLinksConcurrentFirstSave`。30 並行の初回保存で、全列ロックなしだと毎回再現し、PR #8 のみの `origin/main` 単体でも再現した）。`prUrls` を書く更新だけが全列ロックで直列化され、タイトル・説明だけの更新は従来どおり対象カード 1 枚だけを `FOR UPDATE` する。`card_pr_links` の行は `ON DELETE CASCADE` で `DeleteCard` が消すが、`DeleteCard` は全列ロックを取っているので `prUrls` の書き換えとは交差しない。`numberedCards`（`cards JOIN card_numbers`）は `card_pr_links` を結合しない。PR は 1 カード複数行なので結合するとカードが PR の数だけ重複し、`FOR UPDATE` で使うと結合先の行までロックするため、PR URL は `attachPRURL(s)` の別クエリ（ロックなしの読み取り）で付ける。失敗した書き込みの再試行（1213 のリトライ）は、順序のバグを隠すだけなので入れない。Delete は列内に `position` の穴を残し（詰め直しは設計外）、次の並び替えで 0..n-1 に振り直される。ボード全体の書き込みが直列化されるが、列の並び替え・作成が既に同じロックを取っており、1 人用の小さなボードでは問題にならない。
- **CreateCard**: 全列ロック（存在しない列なら `ErrColumn`）の後、当該 `column_id` のカードを `ORDER BY id FOR UPDATE` で読み、`MAX(position)`（カード0なら `-1`）をとり `position = max+1` で INSERT（プロダクトバックログの `backlog_position` も同じトランザクションで末尾に採番する。`position` とは別の値）。
- **UpdateCard で `columnId` が変わるとき**: 全列ロックの後、対象カードを単独で `FOR UPDATE` し、移動先のカードを読んで `MAX(position)+1` を付与する。同一トランザクションでソース列の残カードを `ORDER BY position, id` の現順で `0..n-1` に詰め直す。詰め直しは `position` が変わるカードだけを、`updated_at` を据え置いて更新する（`updated_at=updated_at`）。履歴は列変更の1イベントのみ（詰め直し自体は履歴に載せない）。
- **UpdateCard で列が変わらないとき**: `position` は触らない。`prUrls` を含む更新は全列ロックを取る（理由はロック順の項）。タイトル・説明だけの更新は全列ロックなしで対象カードだけを `FOR UPDATE` する。
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
2. **カードの構造と、どの要素が何を持つか**（コピーボタン機能との両立）。カードは `<article class="task-card">` で、その中に兄弟として `<button class="copy-card-link">`（`copyCardLink`）と `<a class="task-card-body">`（本文リンク）を置く。`<a>` の中に `<button>` は置けない（不正な HTML）ので、この兄弟構造は崩さない。
   - **外側の `<article class="task-card">`**: `cdkDrag`、`[cdkDragData]`、`[cdkDragDisabled]`、`(cdkDragMoved)`、`data-card-id`。ドラッグするのはカード全体（コピーボタンを含む）で、プレースホルダーとプレビューもこの要素。`cursor: grab`、プレビューの `transition: none`、`.cdk-drag-placeholder` などの DnD 用スタイルもここに付く。
   - **本文リンク `<a class="task-card-body">`**: **`routerLink` は付けず `[attr.href]="cardHref(card)"`**。`aria-describedby="card-drag-help"`、`(click)="onCardClick($event, card)"`、`(keydown)="onCardKeydown(...)"` もここ。`RouterLink` は通常のクリックで常に遷移し、同じ要素の `(click)` から `preventDefault()` しても止められず、ドラッグ直後の誤遷移を抑止できないため。`href` を残すので、新しいタブで開く・リンクのコピー・ステータスバーの URL 表示・Enter での遷移はブラウザーがそのまま行う。
   - **コピーボタン**: ドラッグ関連の属性は持たない。単なるクリックはコピーだけで、遷移も並べ替えも起こさない（CDK の閾値 8px 未満ではドラッグにならず、ボタンは `<a>` の外なので遷移しない）。ボタン上からドラッグを始めた場合は、カード全体のドラッグとして扱い（実ブラウザーで、並びが変わり、click もコピーも遷移も起きないことを確認）、ドラッグ開始を抑える処理は入れない。
   - ドラッグか click かは CDK の `dragStartThreshold`（**8**、`CARD_DRAG_THRESHOLD_PX`）に任せる。CDK はドラッグ開始時に元の `<article>` を DOM から外してプレースホルダーに差し替えるため、ドラッグ後の click は元の要素に届かず、アプリ側にドラッグ追跡のフラグは持たない（実ブラウザーで、列内・列間のドラッグ後に click も遷移も起きないことを確認）。
   - `(click)`（リンク）: Ctrl/Cmd/Shift/Alt 付きや primary 以外のボタンはブラウザー既定に任せる。それ以外は `preventDefault()` + `Router.navigate`。
   - 操作の説明は `aria-label` ではなく、視覚的に隠した説明要素を `aria-describedby` で結ぶ（カード本文の読み上げを損なわない。並べ替え不可の間は文言を切り替える）。
3. `(cdkDropListDropped)` で:
   - `L-541` どおりインデックス範囲をガード。あわせて、`event.item.data`（ドラッグしたカード）の id が、移動元の列の `previousIndex` にあるカードの id と一致することを確認し、一致しなければ何もしない（API も呼ばず、画面も変えない）。CDK の `previousIndex` / `currentIndex` は**ドラッグ開始時のリスト**に対する値で、その後にボードの配列が差し替わっていると、同じインデックスが別のカードを指すため（下の 9）。
   - 同一位置 no-op なら API しない。
   - 楽観的に `data().cards` を更新（`columnId` / 列内順）。
   - 影響列（`event.previousContainer !== event.container` なら2列、同一なら1列）の `{ columnId, cardIds }` を組み立て `reorderCards`。
   - 成功: 応答 `cards` で確定。失敗: 変更前スナップショットへロールバック＋非破壊エラー（列並び替えの `reorderError` と共用するか、`cardReorderError` を分ける。共用する場合は文言と 409 時の「再読込」をカード用でも使えるようにする）。
4. 保存中は `reordering`（または `cardReordering`）で次のカード DnD・列 DnD・列追加を抑止する。
5. 列ヘッダー HTML5 DnD との共存: カード上では列の `draggingColumnId` を立てない。列の `dragover`/`drop` は現行どおり `draggingColumnId === null` なら無視。
6. ドラッグ中のボード横スクロールとページ縦スクロール: CDK の自動スクロールは `cdkDropListAutoScrollDisabled` で止め（ページ／ボードの自前スクロールと競合するため）、列 DnD と同様に端での `scrollLeft` 補正を自前で行う（`L-680`）。縦は列ごとの `.card-list` スクロールではなく、ビューポート上下端で `document.scrollingElement` の `scrollTop` を補正する（列は内容に応じて伸び、ページを縦スクロールする）。補正はポインターの移動のたびに加え、列 DnD の `dragover` が静止中も繰り返し発火するのと同じく、ドラッグ中は一定間隔（50ms）のタイマーでも続ける（端に置いたままでもスクロールし続ける。マウスを離した時点（`cdkDragReleased`。CDK が終了を報告するのはプレビューが戻るアニメーションのあと、最大 300ms 後なので、それでは遅い）・ドラッグの終了・ドロップ・画面の破棄で止める）。
7. キーボード: カードのタブストップは本文リンク（`<a href>` はもともとフォーカス可能）。**キーイベントはリンクにだけ付け**（`<article>` には付けない）、リンクにフォーカスがあるとき `ArrowUp` / `ArrowDown`（修飾キーなしのときだけ）で同一列内で1つ移動し、同じ保存 API を呼ぶ。コピーボタンにフォーカスがあるときの矢印キーはカードを動かさない（ボタンのキーイベントはリンクへ届かない）。並べ替え後のフォーカスは、`data-card-id` を持つ `<article>` の中のリンク（`.task-card-body`）へ戻す（`<article>` はフォーカスできず、そこへの `focus()` は無言で失敗するため）。フォーカス枠は、リンクが `:focus-visible` のときにカード全体（`<article>`）へ付ける（`.task-card:has(.task-card-body:focus-visible)`。リンク自身の枠は消す）。`.card-list` の padding/margin 4px は枠とホバーの持ち上がりのために残す。保存中は無視する（`disabled` でフォーカス脱落させない。列 DnD と同じ）。カードのリンクには `aria-disabled` を付けない（遷移はできるため。並べ替え不可は `aria-describedby` の説明文の切替で伝える）。`aria-live` で結果を通知し、文言には移動後の位置を含める（同じカードを続けて動かしても毎回読み上げられる）。
8. 空列へのドロップ: 空の `cdkDropList`（列ボディ）をドロップ対象として確保し、高さ・`min-height` でヒット領域を維持する。
9. **ボードの自動反映（main の `startLiveRefresh`、5 秒ごとのポーリング。`2026-11-14-live-board-refresh-design.md`）との両立**。自動反映はボードの `data` を丸ごと差し替えるので、ドラッグや保存の最中に走ると、楽観更新やドロップのインデックスを壊す。ボードは次のどれかの間は**取得も適用もしない**（`enabled`）: 初回・手動の読み込み中（`loading`）、保存中（`reordering` / `saving`）、作成モーダル表示中（`modal`）、列のドラッグ中（`draggingColumnId`）、**カードのドラッグ中（`draggingCardId`）**。
   - `draggingCardId` は `(cdkDragStarted)` で立て、`(cdkDragEnded)` で下ろす。**`(cdkDragReleased)`（マウスを離した時点）では下ろさない**: CDK は離したあと、プレビューがプレースホルダーへ戻るアニメーション（最大 300ms）を終えてから `ended` → `dropped` を出すので、その間に応答が `data` を差し替えるとドロップのインデックスがずれる。自動スクロールのタイマーは逆に `released` で止める（スクロールを続ける意味がないため）。
   - CDK は `ended`（`cdkDragEnded`）を、`dropped`（`cdkDropListDropped` → `onCardDrop`）の直前に、同じ `NgZone.run` の中で同期的に出す（`ended.next` → `dropped.next` → `container.drop`）。ポーリングはタイマーとネットワーク応答のコールバックなので、この 2 つの間には割り込めない。つまり `ended` で下ろしても、`onCardDrop` は差し替えのないデータに対して走り、その中の `persistCardOrder` が同期的に `reordering` を立てて、保存が終わるまでポーリングを止める。ドロップが no-op（元の位置）や不正でも `ended` で下りるので、ポーリングは再開する。
   - ドラッグの前から飛んでいた取得の応答が、ドラッグ中に届くことがある。`startLiveRefresh` は応答の到着時にも `enabled` を見直すので、そのとき `draggingCardId` が立っていれば捨てる。
   - **応答は、取得を始めたときの `data` のままのときだけ適用する**（`pollBoard`。`data` の参照が変わっていたら捨てる）。取得を出してから応答が届くまでの間に、並び替えの保存（楽観更新と、成功時の全カード置換）・カードや列の作成・再読込が `data` を書き換えていたら、その応答は書き換えより古い状態で、適用すると次のポーリングまで画面が巻き戻る。`enabled` の再確認だけでは、保存が応答より先に終わっていると防げない。捨てた分は次のポーリングで取り込む。
   - ドロップ時の照合（上の 3）は、これらでも防げない経路（将来、別の経路で配列が差し替わる場合）への防御。

### 4.5 ドキュメント

- `docs/api.md` に `PUT /api/cards/order` を追記。
- `README.md` の「できること」と拡張例を、カード DnD 実装済みの記述に更新する（拡張リストから該当行を落とすか「実装済み」にする）。
- `docs/verification.md` に手動確認項目があれば追記。

## 5. テストと検証計画（`L-059`）

1. **Go ハンドラー**: 正常な列内並べ替え、列間移動（2列ペイロード）、空列への移動、400 系、409 集合不一致、履歴が列変更時のみ増えること。
2. **Go MySQL 統合**（`KANBAN_TEST_DSN`）: マイグレーション後の position バックフィル、永続化、CreateCard 末尾、UpdateCard 列変更で末尾、並行 Reorder で破壊なし。
3. **Angular**: `Api.reorderCards`、ドロップ（同一列・列間・no-op）、クリック閾値（短い動きは遷移・長い動きは非遷移）、エラー時ロールバック、空列ドロップ。自動反映との両立（`board-card-drag-live-refresh.spec.ts`。fake timers と `Api.board` のモック）: カードのドラッグ中は何度ポーリングが来てもボードを差し替えず、リクエストも出さない／離してから `ended` までの間も保持する／ドラッグ前から飛んでいた応答がドラッグ中に届いても捨てる／ドラッグ終了後（no-op のドロップを含む）は再開する／ドロップ時に移動元のカードが一致しなければ何も保存しない／保存中はポーリングしない／保存より前に出した取得の遅い応答で、保存した順序を巻き戻さない。実マウスのドラッグ（`mousedown` → `mousemove` → `mouseup`）で `cdkDragStarted` / `cdkDragEnded` の配線も確かめる。
4. **実ブラウザ**（利用中 DB を壊さない独立環境）: DnD、リロード後の順、詳細ステータス移動が末尾、列 DnD がカード操作を壊さないこと。自動反映との両立として、Todo に 5 枚（A〜E）を置き、B を掴んだまま別経路（API の DELETE）で A を消して 5 秒以上待ってからドロップしても、動くのは B であること。

## 6. 非目標（YAGNI）

- 列 DnD の CDK 化、リアルタイム同期、競合の OT/CRDT、タッチ専用の別 UI、カードの複数選択一括移動、並び替えの履歴イベント、認証。

## 7. 知見 ID（実装・プランに反映）

- `L-001`, `L-038`, `L-048`, `L-494`, `L-540`, `L-541`, `L-680`, `L-681`, `L-015`
