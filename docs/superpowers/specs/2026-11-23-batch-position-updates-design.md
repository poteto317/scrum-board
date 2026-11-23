# ステータス変更・バックログ並べ替えの UPDATE 定数化（#116）

## 背景

| 経路 | 現状 | 見積 |
|---|---|---|
| ステータス変更後の移動元詰め直し | `compactColumnPositions` が列内カードを読み、**行ごと** `UPDATE … position=?`（`updated_at=updated_at`） | 〜n 文 |
| バックログ並べ替え | `ReorderBacklog` が全提出 ID に **行ごと** `UPDATE … backlog_position=?` | 〜n 文 |

全列ロック（`lockColumnRows`）下で n 比例の Exec が続く。カード DnD の CASE 化（スクラム機能 #115、マージ済み GitHub PR）と同型。

## 決めたこと

| 事項 | 採用 |
|---|---|
| 対象 | **`compactColumnPositions`**（`UpdateItem` の列変更かつ `!projectChanged`）と **`ReorderBacklog`** のみ |
| 非対象 | `reassignPositionsByOffsetY`、作成時 backfill、`ReorderItems`（#115 済）、プロジェクト変更時の詰め |
| compact 方式 | カード提案の `position-1` 一括は、`DeleteItem` が残すギャップを埋めないため**現行の稠密 0..n-1 と非同等**。採用は **SELECT id … ORDER BY position FOR UPDATE（1 文）＋ スキャン順で全 id を CASE して position を 0..n-1（最大 1 Exec・空なら 0）**。現値比較はしない（目標はスキャン順だけで決まる）。意味は現行ループと同じ |
| シグネチャ | `compactColumnPositions(ctx, tx, columnID, projectID int64)` のまま（removedPos 不要） |
| バックログ | **`lockProjectCards` 非改変**（id 集合照合）。続けて ReorderBacklog 内で **別 SELECT** `id, backlog_position … FOR UPDATE` → 変化行だけ CASE（最大 1 Exec）。`updated_at=updated_at` |
| ロック | **`lockColumnRows` 先行は維持**（新書き込み経路の追加ではない） |
| 計測 | #115 同型フック。**(A) compact**: 列変更で移動元に n 枚残る。関数内 SELECT〜CASE のみ。**(B) backlog**: 全 ID reverse。`lockColumnRows`〜CASE（`resolvedActiveProjectID` 内 SQL **含む**・`listBacklogCards` 除外）。各経路 n=20/80・`|Δ|≤5`・上限 40（L-1084） |
| API | JSON / OpenAPI 変更なし |

## 目的と受け入れ条件

1. **`compactColumnPositions` と `ReorderBacklog` のホットパス**（上記計測区間）の SQL が n に比例して増えない。
2. 位置／backlog_position だけ変わるカードの `updated_at` は変わらない。
3. 移動元は稠密 0..n-1（`TestStatusChangeCompactsSourceColumnInPositionOrderMySQL`）。`TestMySQLBacklogReorderPreservesUpdatedAt`・`TestCardWritesDoNotDeadlockMySQL`・`TestCardWritersQueueOnTheAllColumnsLockMySQL`・`card_lock_integration_test` の全列ロック待ち系（`docs/verification.md` 記載）GREEN。
4. HTTP JSON 契約は変えない。

## 方式（概要）

### compactColumnPositions

1. 対象列を `SELECT id … ORDER BY position,id FOR UPDATE`（1 文）。
2. スキャン順の全 id を CASE で `position` 再採番（最大 1 Exec）。空なら Exec 0。
3. 行ごと UPDATE ループを削除。

### ReorderBacklog

1. `lockColumnRows` → `lockProjectCards`（集合照合・シグネチャ非改変）。
2. **追加**で現行値ロック読込（id + backlog_position、1 文）。
3. 変化行のみ CASE（最大 1）。`listBacklogCards` は現状（計測外）。

## 気をつける知見

- **L-1084**: 計測に履歴・応答全文を混ぜない。経路ごとに測る。
- **L-777**: ロック順を変えず既存並行テストで固定。
- **L-1083**: 権限経路ではない（N/A）。

## テスト方針

- 単体: backlog / compact の CASE 組立があれば固定。
- 統合: 既存 GREEN + クエリ数テスト 2 本（compact / backlog）。

## レビュー記録

- 第 1 周（記述の確かさ）: compact は稠密 CASE（position-1 は非同等で不採用）、backlog 現値取得経路、計測境界を経路別に固定。
- 第 2 周（範囲と知見）: L-1084 シナリオ具体化、`lockProjectCards` 非改変、デッドロックテスト列挙、#115 との番号表記整理。1 プラン（compact / backlog / 計測 2 本）で完結。
