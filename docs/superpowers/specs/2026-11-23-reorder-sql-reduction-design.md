# カード並べ替えの SQL 削減（#115）

## 背景

`PUT /api/items/order`（DnD）は、対象列のカード数 n に対しておよそ **4n + 定数** 文の SQL が出る。

| 段階 | 現状 | 見積 |
|---|---|---|
| 権限 | `expandItemOrdersWithHidden` が Board + ACL を読んだ後、`requireEditOnItemIDs` が **ID ごと `GetItem`**（本体・PR・関連 ≈ 3 文 × n） | 〜3n |
| ロック読込 | `SELECT id … FOR UPDATE` のあと **ID ごと `scanCard`（全文）** + `attachPRURLs` + `attachRelatedItems` | 〜1 + n + 付帯 |
| 更新 | 位置が変わった行ごとに `UPDATE` | 〜最大 n |
| 応答 | `listOrderedCards`（全文） | 定数 |

Done に 200 件ある列へ落とすと約 930 文・全列ロック中に他書き込みが待つ（見積もり）。

## 決めたこと

| 事項 | 採用 |
|---|---|
| 対象 | **`ReorderItems` 経路のみ**（`PUT /api/items/order`）。バックログ並べ替えは同パターンだが本カード範囲外 |
| 権限 | `expandItemOrdersWithHidden` が付与済みの **メモリ上 Item（`aclStateFromItem`）で `CanEdit`**。提出 ID の **追加 `GetItem` も、ID ごとの ACL 再取得もやめる**。`byID` に無い ID は現行どおりチェックを飛ばし、Reorder の集合不一致で **409** |
| ロック読込 | 対象列を **1 文の `SELECT … FOR UPDATE`**。並べ替え用に `id, column_id, position, offset_y, done_at, updated_at`（および project 等キー）を読む。**説明・ソリューション・PR・関連はロック段階で読まない**。列移動の `appendHistory` 用 `before` は、このロック結果をメモリに保持したスナップショットを使う（履歴差分に無いフィールドは空のままで可。DB を ID ごと再読しない） |
| 全列ロック | **維持**（`lockColumnRows` 先行と `card_lock_integration_test` を壊さない） |
| UPDATE | スキップ以外をまとめる。列変更あり／なしで SQL 形が違う場合は **最大 2 文**（各 CASE バッチ）。履歴 INSERT は正しさ優先で行ごと可（クエリ数上限の対象外） |
| 応答 | 成功時の全文 `listOrderedCards`（+ 既存 PR/関連付与）は現状維持 |
| 完了の測り方 | MySQL 統合で **`ReorderItems` トランザクション内**の Query+Exec を測る（`expand` の Board/ACL は含めない）。シナリオは **同一列内の position 入れ替えのみ**（履歴 INSERT が n に比例しない）。n=20 と n=80 で `|count80-count20| ≤ 5` かつ両方とも上限 40 以下。デッドロック系は `TestCardWritesDoNotDeadlockMySQL` と全列ロック待ち系（`docs/verification.md` / `card_lock_integration_test` の該当）を残す |

## 目的と受け入れ条件

1. **`ReorderItems` トランザクション内**の SQL が n に比例して増えない（GetItem×n・ロック後 scanCard×n・行ごと UPDATE×n を除去／定数化）。履歴 INSERT と応答用 `listOrderedCards` は別枠（上記測り方）。
2. デッドロック対策の **全列ロック先行**と既存 `card_lock_integration_test` が通る。
3. 権限: 提出 ID に編集権が無いときは拒否。`byID` 欠落は 409。hidden マージは維持。権限経路で **追加の GetItem / per-ID ACL 再取得が無い**。
4. 位置のみ移動で `updated_at` / 履歴が動かない既存仕様（`planCardReorder`）を維持。
5. API の JSON 形は変えない（OpenAPI ルート追加なし）。

## 方式（概要）

### Handler

1. `expandItemOrdersWithHidden` の戻りを拡張し、**`map[int64]Item`（ACL 付与済み）を必ず返す**（シグネチャ固定）。
2. 新ヘルパ `requireEditOnLoadedItems(w, r, byID, submittedIDs)`: ID が map にあれば `CanEdit(aclStateFromItem)`（ACL 再取得なし）。無ければ skip。拒否時は既存 `requireEdit` と同じ HTTP 応答。
3. `repo.ReorderItems(expanded)` は従来どおり。

### Repository `ReorderItems` / `lockCardsInColumns`

1. `lockColumnRows`（変更なし）。
2. ロック読込を **単一 SELECT FOR UPDATE**（最小列）。PR/関連 attach をこの段階から削除。
3. `planCardReorder` でスキップ／更新を決め、列変更なし／ありをそれぞれ **最大 1 文ずつの CASE バッチ**（合計最大 2）。
4. 列変更 ID だけ `appendHistory`（行ごと可）。
5. `listOrderedCards` で応答用全文（既存）。

## 非対象

- バックログ `ReorderBacklog` の同最適化（別カード可）
- フロントの送る列ペイロード削減
- 全列ロックの撤廃やロック順序の変更
- 応答から説明・ソリューションを落とす契約変更

## 気をつける知見

- **L-775**: 本変更はサーバ SQL。フロントのポーリング適用ガードは触らない。
- 並行書き込み: ロック順序を変えず、既存統合テストで固定（カード記載のデッドロック規約）。
- 履歴: 列移動のみ履歴、位置のみは `updated_at` 据え置き（既存 `planCardReorder` / 統合テスト）。

## テスト方針

- 単体: `planCardReorder` は既存。バッチ UPDATE の引数組み立てがあれば単体で固定。
- 統合（MySQL）: (1) 既存 reorder / lock / updated_at / PR links / デッドロック・全列ロック待ちが GREEN。(2) **クエリ数**: 同一列内 reverse、n=20 と n=80、上記数値基準。(3) 列移動 1 件の履歴が、最適化前と同等の status 変化を記録すること（`before` 最小列でも status 履歴が壊れない）。(4) 権限拒否の回帰。
- Handler: メモリ repo で並べ替え経路から `GetItem` が呼ばれないこと。

## レビュー記録

- 第 1 周（記述の確かさ）: 権限はメモリ ACL・byID 欠落は 409、ロック最小列と履歴スナップショット、UPDATE 最大 2 文、クエリ数は ReorderItems 内の数値基準に固定。
- 第 2 周（範囲と知見）: クエリ数シナリオを列内のみに固定、デッドロックテスト列挙、列移動履歴の同等性、1 プラン妥当・L-775 非対象は維持。
