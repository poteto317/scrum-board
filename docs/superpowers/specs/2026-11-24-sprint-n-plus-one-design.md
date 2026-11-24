# スプリントの一覧・詳細・メンバー更新の N+1 をなくす（#126）設計

## 背景

スプリントの一覧・詳細・メンバーの置き換えが、スプリント数・アイテム数に比例して SQL を発行していた。

- **一覧（`ListSprints`）:** スプリントごとに、所属アイテムの ID を別のクエリで読んでいた。外側の結果を開いたまま内側のクエリを出すので、1 リクエストが DB の接続を 2 本使っていた。さらにハンドラーが、メンバーごとに `GetItem`（3 文）で閲覧の可否を調べていた（スプリント 20 × アイテム 15 件で約 920 文）。
- **詳細:** メンバーごとに `GetItem`（3 文）。
- **メンバーの置き換え（`ReplaceSprintItems`）:** メンバーごとに、アーカイブ済みかの確認（行ロック付き）と、置き換え可能かの確認（行ロック付きと、別のスプリントに入っていないかの確認）を、1 件ずつ発行していた（1 件 14 文、12 件 69 文）。

カードの記述（main 2040b87 時点）のうち、詳細で「ボード全件を読む」点は、#119 で `Columns` に置き換わり、すでに直っている。今回は残りを直す。

## 決めたこと

- **スプリントのメンバー（`SprintItem`）に、閲覧の判定に必要な列を持たせる。** `ViewAccess`・`EditAccess`・`CreatedByUserID`（JSON には出さない）。メンバーを読む 1 つのクエリが、アイテムとの結合で、これらも返す。
- **一覧は、スプリントの行を読み切って閉じてから、全スプリントのメンバーを 1 文で読む**（`loadSprintItemsBySprint`、`IN (…)`）。1 リクエストの DB 接続は 1 本。
- **閲覧の可否は、メンバーに載せた列から決める。** 制限付きのメンバーの許可リストは、既存のまとめて取る処理（`ListACLEntriesForItems`）で 1 回だけ読む。`GetItem` は呼ばない。判定の中身（`filterBoardItems`、`CanView`）は変えない。
- **一覧は、全スプリントのメンバーをまとめて判定し**（許可リストの読み込みは全体で 1 回）、スプリントごとの可視の件数を数える。詳細は、そのスプリントのメンバーを 1 回で判定する。
- **メンバーの置き換え:** 関係するアイテムの状態（プロジェクト・削除・アーカイブ）を、1 文で読んでロックし（id 順）、別の計画中・進行中のスプリントに入っているかも 1 文で読む。確認は、読んだ結果から、従来と同じ順序（見つからない・削除済み → アーカイブ済み → プロジェクトの不一致 → 別のスプリントに所属）で行う。書き込みは、複数行の `INSERT`。1 文のプレースホルダーが MySQL の上限（65535）に届かないよう、読み込みも書き込みも `sprintBatchSize`（1000）件ずつに分けるので、文の数は、1000 件までは固定（それを超えたら 1000 件ごとに 1 文増える）。重複した id は除き、id の昇順でロックする。
- ハンドラーの `prepareReplaceSprintItems` が、送られたアイテムごとに `GetItem` して編集権限を調べる点は、このカードでは変えない（編集権限の判定に完全なアイテムが要るため）。メンバー側の判定（`filterSprintItems`・`invisibleSprintMemberIDs`）は、まとめて行うようになる。
- API の応答の形は変えない。

## 受け入れ条件

1. スプリントの一覧・詳細で、メンバーごとの `GetItem` を呼ばない。制限付きのメンバーがあっても、許可リストの読み込みは 1 回で、スプリント数・アイテム数に依らない（`TestSprintListReadsItemsInOneGoWhateverTheSize`、`TestSprintDetailReadsItemsInOneGoWhateverTheSize`）。
2. MySQL: `ListSprints` が DB 接続 1 本で動き（接続を 1 本に絞って、固まらない）、発行する文の数が、スプリント数・アイテム数に依らない（`TestMySQLListSprintsStatementCountDoesNotGrowWithSprintsOrItems`）。
3. MySQL: `ReplaceSprintItems` が発行する文の数が、アイテム数に依らない（`TestMySQLReplaceSprintItemsStatementCountDoesNotGrowWithItems`）。
4. 閲覧・編集の権限、アーカイブ済み・削除済み・別プロジェクト・別のスプリントのメンバーの扱いは、従来と同じ（既存のスプリントのテスト、`TestMySQLSprint*`）。
5. 件数が多くても、分けた文で同じ結果になる（`TestMySQLSprintBatchesGiveTheSameResultWhenSplit`）。
6. MySQL で、置き換えのエラーの優先順位、アーカイブ済み・見えないメンバーの保持、空の置き換え、権限の列が読めることを確かめる（`TestMySQLReplaceSprintItemsReportsTheFirstReasonAMemberCannotJoin`、`...KeepsArchivedAndRetainedMembersAndAllowsEmpty`、`TestMySQLSprintMembersCarryWhatVisibilityTakes`）。
7. 既存のテストが通る（`TestMySQLActivateSprintConcurrent` は変更前から失敗している）。

## 範囲外

- 一覧が、完了済みを含む全スプリントの全メンバー（タイトル・権限の列を含む）を読むこと。件数を出すだけなので、列を絞ることもできるが、現在の規模では要らない。

- `prepareReplaceSprintItems` の、送られたアイテムごとの `GetItem` と編集権限の確認。
- スプリントの詳細・一覧の取得を、メンバーの件数に応じて分割すること（ページング）。

## 実装プラン

変更が小さい（`sprint.go`・`sprint_handler*.go` と、メンバーの型）ため、実装プランは作らず、設計書のサブエージェントレビューも省く。
