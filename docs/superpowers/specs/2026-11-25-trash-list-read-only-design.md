# ゴミ箱の一覧を読み取りだけにし、N+1 クエリをやめる（#130）設計

## 背景

`GET /api/trash` は、呼ばれるたびに次のことをしていた（`backend/internal/kanban/trash.go`、`trash_handler.go`）。

1. 期限切れの削除（`PurgeExpiredTrashForProject`）: 書き込みのトランザクションで、全列をロックし、期限切れのアイテムを 1 件ずつ `DELETE` する。
2. 一覧のクエリ。
3. 1 件ごとに、アイテムの取得（`GetDeletedItem`、関連の読み込みを含めて 3 文）と、ACL の確認（制限付きなら `item_acl_entries` の取得）。ゴミ箱が数十件で、100 文を超える。

さらに、1 の削除は、添付ファイルの GCS の実体を消さない（`POST /api/trash/purge` だけが、実体の削除までする）。一覧の呼び出しで行が消えると、実体が残る。

## 決めたこと

- **一覧は読み取りだけにする。** 期限切れの削除をやめる。保持期間（30 日）を過ぎたものは、一覧から外す（`deleted_at > 現在 - 30 日`）。削除そのものは、定期ジョブ `POST /api/trash/purge`（`scripts/ensure-trash-purge-scheduler.sh`）に任せる。これは、添付の実体の削除も行う。
- **N+1 をやめる。** 一覧のクエリで、権限の判定に必要な列（`view_access`、`edit_access`、`created_by_user_id`）も取る。制限付きのアイテムの許可リスト（`item_acl_entries`）は、まとめて 1 回で取る（`ListACLEntriesForItems`）。文の数は、件数にかかわらず、一覧 1 + 許可リスト 1 の 2 文。
- リポジトリの `ListTrash` は、`TrashEntry`（`TrashItem` と `ItemACLState`）を返す。ハンドラーは、純粋な関数 `filterTrashForViewer` で、閲覧できるものだけを `TrashItem` にして返す。応答の形は変えない。
- 使われなくなる `PurgeExpiredTrashForProject`（インターフェース・MySQL・メモリ実装）を削除する。
- 復元・完全削除・定期ジョブの動作は変えない。

## 受け入れ条件

1. 一覧は、文の数が件数に比例しない（制限付きのアイテムが多くても同じ）。`TestMySQLListTrashIsAConstantNumberOfReadsAndNeverPurges`。
2. 一覧は書き込みをしない: 期限切れの行は、一覧に出ないが、行は残る（MySQL・メモリの両方）。`TestTrashListHidesExpiredItemsWithoutPurgingThem`、`TestTrashListHidesExpiredAndGlobalPurgeRemovesThemMemory`。
3. 閲覧権限による絞り込みは変わらない（公開・誰でも・制限付きの許可リスト・作成者・管理者）。`TestFilterTrashForViewer`。
4. 全体の purge（`POST /api/trash/purge`）は、すべてのプロジェクトの期限切れを削除し、添付の実体も消す（既存）。

## 運用への影響

一覧が削除をしなくなるため、期限切れの行は、`/api/trash/purge` を動かす Cloud Scheduler のジョブがあるときだけ消える（READMEのとおり、このジョブはデプロイ時に自動では作られない。`scripts/ensure-trash-purge-scheduler.sh` で作る）。ジョブが無い環境では、期限切れの行は DB に残るが、一覧には出ない。

## 範囲外

- 復元（`RestoreItem`）で、保持期間を過ぎた行を拒否すること（従来も拒否していない）。
- ゴミ箱の一覧のページング。

## 実装プラン

変更は `trash.go`・`trash_handler.go`・`model.go` に収まるため、実装プランは作らず、設計書のサブエージェントレビューも省く（#125・#129 と同じ扱い）。
