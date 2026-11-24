# projectId 省略時にボード全件を読まない（#119）設計

## 背景

番号でアイテムを指定する API（`/api/items/by-number/{n}/...`）、スプリント、定期実行、アーカイブは、`projectId` を省略するとアクティブなプロジェクトの ID を使う。この ID を調べる `activeProjectForByNumber`（`handler.go`）が `repo.Board()` を呼んでおり、設定 1 行を知るためだけに、全アイテム（本文・PR・関連を含む）を読んでいた。本文中の添付画像の URL（`/api/items/by-number/{n}/attachments/{id}/content`）には `projectId` が付かないので、画像 1 枚の表示ごとにこれが走る。

また、スプリント詳細の `suggestedVelocity`（`sprint_handler_helpers.go` の `enrichSprintForResponse`）は、Done 列の ID を知るためだけに `repo.Board()` を呼んでいた。

## 決めたこと

- `Repository` に 2 つのメソッドを足す。
  - `ActiveProjectID(ctx) (int64, error)`: 設定とプロジェクト一覧だけを読み取り専用トランザクションで読み、`resolveActiveProjectID` で解決する（`Board` の `settings.activeProjectId` と同じ規則）。列もアイテムも読まない。
  - `Columns(ctx) ([]Column, error)`: 並び順どおりの列だけを読む（`Board.Columns` と同じ）。
- `activeProjectForByNumber` は `ActiveProjectID` を使う。`enrichSprintForResponse` は `Columns` を使う。
- `item_acl_handler.go` の `Board()` はアイテム本体を使うので変えない。`GET /api/board` も変えない。
- 添付画像の URL 側（`attachment.go`）は変えない。URL に `projectId` を足さなくても、解決が軽くなれば完了条件（ボード全件の読み込みが走らない）を満たす。

## 受け入れ条件

1. `projectId` を省略した番号指定の API で `Board()` が呼ばれず、`ActiveProjectID` が使われる（`memoryRepo` の呼び出し回数で断言）。
2. スプリント詳細で `Board()` が呼ばれず、`Columns` が使われる。
3. MySQL: `ActiveProjectID` と `Columns` が `Board` の `settings.activeProjectId`・`columns` と一致する（保存済みの ID が存在しない場合の代替も含む。`KANBAN_TEST_DSN` 指定時）。
4. 既存のテストが通る。

## 範囲外

- 添付画像の URL への `projectId` の付与。
- フロントエンドの変更（API の応答は変わらない）。
