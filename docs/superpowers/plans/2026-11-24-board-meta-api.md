# 列と設定だけが必要な画面でボード全件を取得しない（#118）実装プラン

設計書: `docs/superpowers/specs/2026-11-24-board-meta-api-design.md`

作業は `/Users/mash/Desktop/scrum-board-lite`（ブランチ `feat/board-lite-api`）で行う。コミットはしない（後続の `/commit-ja`）。テストは、失敗するテストを先に書いて失敗の理由を確かめてから、実装する（TDD）。

## 気をつける知見

L-040（古い応答の上書き）、L-775（操作中のポーリング）、L-860（ポーリングでの `syncActiveFromBoard`）、L-901（副経路の認証）、L-060（省略可能なヘルパーが配線漏れを隠す）、L-1080（ETag と 304）。

## ファイル

バックエンド（`backend/internal/kanban/`）:

- 変更: `model.go`（`BoardMeta` 型、`Repository` に `BoardMeta` を追加）、`repository.go`（`loadBoardHead` の切り出し、`MySQLRepository.BoardMeta`）、`handler.go`（ルートとハンドラ）
- 変更（テスト）: `handler_test.go`（`memoryRepo.BoardMeta`）
- 新規（テスト）: `board_meta_handler_test.go`、`board_meta_integration_test.go`（`KANBAN_TEST_DSN` が無ければスキップされる既存の仕組み）

フロントエンド（`frontend/src/app/`）:

- 変更: `models.ts`、`board-data.ts`、`board-active-sync.ts`、`api.ts`、`conditional-get.ts`、`project-session.ts`、`item-detail.ts`、`recurring.ts`、`backlog.ts`
- 新規（テスト）: `board-data.spec.ts`（`board-data` のスペックは今は無い）
- 変更（テスト）:`board-active-sync.spec.ts`、`api.spec.ts`、`conditional-get.spec.ts`、`project-session.spec.ts`、`item-detail.spec.ts`、`item-detail-project.spec.ts`、`recurring.spec.ts`、`recurring-session.spec.ts`、`backlog.spec.ts`、`backlog-project-switch.spec.ts`、`backlog-board-poll.spec.ts`（必要なものだけ。他のスペックの `Api` のダブルが壊れたら、`boardMeta` を足す）

## Task 1: バックエンド — ハンドラとインメモリのリポジトリ（失敗するテストから）

- [x] `model.go` に `type BoardMeta struct { Columns []Column \`json:"columns"\`; Settings BoardSettings \`json:"settings"\` }` を足し、`Repository` に `BoardMeta(context.Context) (BoardMeta, error)` を足す（コメント: `Board` と同じ列・設定の解決。アイテムは読まない）。
- [x] `handler_test.go` の `memoryRepo` に `BoardMeta` を足す: `boardForScope` と同じ列の並べ替えと、`resolvedSettings(cols)` を使う（`Board` からアイテムを除いた値と一致する。実装は、先に空の本体でコンパイルだけ通して、テストを失敗させる）。
- [x] `board_meta_handler_test.go` に、次のテストを書く（`fresh()`、`request`、`requestAnon` など `handler_test.go` の既存のヘルパーを使う）:
  - `TestBoardMetaReturnsColumnsAndSettingsWithoutItems`: `GET /api/board/meta` が 200 で、JSON のキーが `columns` と `settings` だけ（`items` が無い）。`settings.cardLayout`・`mobileBoardColumnId`・`activeProjectId` が、同じリポジトリの `GET /api/board` の `settings` と一致する。
  - `TestBoardMetaMatchesBoardEnvelope`: 列を追加したり、`ActiveProjectID` が存在しないプロジェクトを指す状態にして、`/api/board/meta` と `/api/board` の `columns`・`settings` が一致する（解決の規則が同じこと）。
  - `TestBoardMetaETag304`: 1 回目の `ETag` を `If-None-Match` に付けると 304 で本体が空。列を足すと 200 で ETag が変わる。
  - `TestBoardMetaRequiresSession`: `requestAnon(h, "GET", "/api/board/meta", "")` が 401（L-901）。
  - `TestBoardMetaAllowsNonAdminUser`: 非管理者のセッションで `GET /api/board/meta` が 200 を返し、本文が管理者の応答と一致する（列と設定は ACL の対象外。閲覧が制限されたアイテムがあっても同じ。L-901 の肯定ケース）。既存の非管理者のセッションを作るヘルパー（`handler_test.go` や `auth_handler_test.go`）を使う。
  - `TestBoardMetaIgnoresInvalidProjectID`: `?projectId=abc` と `?projectId=999999` でも 200 で、本文（`columns`・`settings`）が `projectId` 無しの応答と一致する。
  - `TestBoardMetaStorageFailure`: `memoryRepo` に `boardMetaFail error` を足し、`BoardMeta` の先頭でそれを返す。ハンドラが 500 を返し、本文に内部のエラーメッセージを漏らさない（`fail` の挙動）ことを断言する。
- [x] `go test ./internal/kanban/ -run TestBoardMeta` を実行し、ルートが無いために 404 で落ちることを確認する（ビルドエラーや別の理由で落ちていないこと）。`TestBoardMetaRequiresSession` は、未登録のルートでも認証が先に走って 401 を返し、実装前に通る可能性がある。通った場合は、そのテストが認証を守っていることを、Task 5 の変異 (c) で示す。
- [x] `handler.go` に `mux.HandleFunc("GET /api/board/meta", h.boardMeta)` を足し、`func (h handler) boardMeta(w, r)` を書く: `h.repo.BoardMeta(r.Context())`、失敗は `fail`、成功は `replyJSONWithETag(w, r, meta)`。`optionalQueryProjectID` は呼ばない。
- [x] `go test ./internal/kanban/ -run TestBoardMeta` が通ることと、`go test ./internal/kanban/` が全体で通ることを確認する。

## Task 2: バックエンド — MySQL の実装（`loadBoard` の前半を切り出す）

- [x] `board_meta_integration_test.go` に、`mysqlTestDB` を使うテスト `TestBoardMetaMatchesBoardMySQL` を書く: 列を足して、設定を変えてから、`r.BoardMeta(ctx)` の `Columns` と `Settings` が、`r.Board(ctx)` の `Columns` と `Settings` と一致する（`reflect.DeepEqual` かフィールドごと）。`KANBAN_TEST_DSN` が無いときはスキップされるので、DB が無い環境では、`BoardMeta` が未実装のためにコンパイルで落ちる（`r.BoardMeta undefined`）ところまでを、失敗の確認とする。
- [x] `repository.go` の `loadBoard` の前半（`listOrderedColumns`、`loadBoardSettings`、`listProjects`、`MobileBoardColumnID` と `ActiveProjectID` の解決）を `loadBoardHead(ctx, tx) (boardHead, error)`（`boardHead` は `Columns`・`Settings`・`Projects`・`Active` を持つ構造体。`BoardMeta` は `Columns` と `Settings` だけを使い、`loadBoard` は `Projects` と `Active` も使う） に切り出し、`loadBoard` はそれを呼ぶ形にする（振る舞いは変えない）。
- [x] `MySQLRepository.BoardMeta(ctx)` を書く: `r.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})`、`defer tx.Rollback()`、`loadBoardHead` を呼び、`tx.Commit()`。
- [x] `go build ./... && go vet ./... && go test ./...`（`backend/` で）が通ることを確認する。MySQL を使う統合テストは、`KANBAN_TEST_DSN` が無ければスキップされる。Docker のデーモンが動いていれば、`compose.yaml` の `db` で `scrumboard_numbering_test` を作って、統合テストも実行する。実行できなければ、スキップしたことを PR に書く。

## Task 3: フロントエンド — 型・正規化・ヘルパー・API（失敗するテストから）

- [x] 新規 `board-data.spec.ts` を作る。まず、切り出し前の `normalizeBoardData` の挙動を固定するテストを書いて、今のコードで通ることを確認する: `settings` 欠落で `cardLayout` が `pack` になる、`mobileBoardColumnId` と `activeProjectId` が整数化され、未定義のときはキーが削除される。そのうえで、`normalizeBoardMeta` のテストを足す: `settings` 欠落で `{ cardLayout: 'pack' }`、`mobileBoardColumnId` と `activeProjectId` の整数化と未定義のキーの削除、`columns` 欠落で `[]`、`items` を返さないこと。上の `normalizeBoardData` の固定テストが、切り出し後も通ること（`normalizeBoardSettings` の切り出しで振る舞いが変わらない）。
- [x] `board-active-sync.spec.ts` に、`NormalizedBoardMeta` を渡しても `syncActiveFromBoard(activeProjectId, false)` が呼ばれ、`apply` が同じ値で呼ばれるテストを足す。
- [x] `api.spec.ts` に、`boardMeta()` が `GET /api/board/meta` を呼ぶこと、`boardMetaConditional(etag)` が `If-None-Match` を付け、304 を `notModified` にすることを足す（`board()` と `boardConditional()` の既存のテストと同じ書き方）。
- [x] `conditional-get.spec.ts` に、`resolveBoardMetaConditional` が `api.boardMetaConditional` を優先すること、無ければ `api.board()` から `{ columns, settings }` を取り出して `ok` を返すこと、`fetchBoardMeta` が `api.boardMeta` を優先し、無ければ `api.board()` から取り出すことを足す。
- [x] 本物の `Api` が `boardMeta` と `boardMetaConditional` を必ず持つことを、型と実通信で固定する（ヘルパーの引数は省略可能な型なので、`Api` のメソッド名の誤りを型が拾えない。L-060）:
  - `conditional-get.spec.ts` に、`const _meta: Required<Pick<Api, 'boardMeta' | 'boardMetaConditional'>> = api;`（`TestBed.inject(Api)` で得た本物の `Api`）のような、型の代入の確認を足す。
  - `item-detail`・`recurring`・`backlog` のうち少なくとも 1 つで、本物の `Api` と `HttpTestingController` を使い、`/api/board/meta` に要求が出て `/api/board` には出ないことを確かめるテストを足す（`backlog` のポーリングを推奨）。
- [x] 上のテストが、未実装のために落ちること（型エラーまたは未定義）を確認する。
- [x] `models.ts` に `BoardMeta`（`columns`、`settings?`）を足す。`board-data.ts` に `normalizeBoardSettings`（`normalizeBoardData` から切り出す）、`NormalizedBoardMeta`、`normalizeBoardMeta` を足す。`board-active-sync.ts` の `board` の型を `T extends { settings: BoardSettings }` に緩める（`apply: (board: T) => void`）。`api.ts` に `boardMeta()`、`boardMetaConditional(etag)` を足す。`conditional-get.ts` に `resolveBoardMetaConditional` と `fetchBoardMeta` を足す。
- [x] Task 3 のテストが通ることを確認する（`cd frontend && npm test -- --watch=false --include <該当のスペック>` は遅いので、まとめて実行する）。

## Task 4: フロントエンド — 呼び出し元の切り替え（呼び出し元ごとに、失敗するテストから）

各呼び出し元で、先にテストを書き、`boardMeta`（または `boardMetaConditional`）が呼ばれて `board`（`boardConditional`）が呼ばれないことの断言が失敗することを確かめてから、実装する（L-060）。

- [x] `project-session`（`project-session.spec.ts`）: `load()` が `GET /api/board/meta` を呼び、`GET /api/board` を呼ばない。`settings.activeProjectId` で `activeId` が決まる。`delete()` 後の再取得（アクティブなプロジェクトを消した場合）も `meta`。既存の `HttpTestingController` の `expectOne('/api/board')` を、`/api/board/meta` に直す。
- [x] `item-detail`（`item-detail.spec.ts`、`item-detail-project.spec.ts`）: 初回読み込みとポーリング（`startLiveRefresh` の `fetch`）が `boardMeta` を呼び、`board` を呼ばない。`columns` は `meta.columns` から設定される。ポーリングの規則（操作中は適用しない）は、`item-detail.spec.ts` の `startLiveRefresh` を使う既存のテスト（操作中・保存中・ドラッグ中にポーリングの応答を適用しないもの）が、`boardMeta` を返すダブルでも通ることで確かめる。`Api` の部分的なダブルに `boardMeta` を足す。
- [x] `recurring`（`recurring.spec.ts`、`recurring-session.spec.ts`）: `loadColumns()` が `boardMeta` を呼び、`board` を呼ばない。
- [x] `backlog`（`backlog.spec.ts`、`backlog-project-switch.spec.ts`、`backlog-board-poll.spec.ts`）: `load()`・`pollBacklogBoard()`・`reloadAfterProjectSwitch()` の 3 か所が、`boardMetaConditional`（`resolveBoardMetaConditional` 経由）を使い、`boardConditional`・`board` を呼ばない。ETag の保持とリセットの位置が変わらない（`boardMetaEtag`）。`mergeBacklogBoardPoll` は変更しない。`applyBoardDataWithActiveSync` には `normalizeBoardMeta` の結果を渡す。
- [x] 実装する: `project-session.ts`、`item-detail.ts`、`recurring.ts`、`backlog.ts`。各ファイルの `api.board()` / `boardGetConditional` を、設計書の表のとおりに切り替える。`board.ts`・`sprint-detail.ts`・`favorites-session.ts`・`project-board-cache.ts` は変更しない（`git diff` で確認する）。
- [x] import の差し替え: `backlog.ts` は `BoardData`→`BoardMeta`、`normalizeBoardData`→`normalizeBoardMeta`、`resolveBoardConditional`→`resolveBoardMetaConditional`。`project-session.ts` は `normalizeBoardData`→`normalizeBoardMeta`。使わなくなった import は残さない（`tsconfig` は未使用を検出しないので、目視と `git diff` で確かめる）。
- [x] `backlog.ts` の型: `boardGetConditional` の戻り値と `rememberEtagsFromOk` の引数の型を、`ConditionalGetResult<BoardMeta>` に変える（`load()` の `this.columns.set(board.body.columns)` は変更不要）。
- [x] 全スペックを通すことを完了条件にする。`frontend/src/app/*.spec.ts` のうち、`Api` のダブルが `board` だけを持つもの（`app.spec.ts`、`list-filter-session.spec.ts`、`header-menu-session.spec.ts`、`item-solution.spec.ts`、`projects.spec.ts`、`item-autosave-routing.spec.ts`、`board-project-switch.spec.ts` など）は、フォールバック（`fetchBoardMeta`）で書き換えずに通る想定。実装後に全体を一度走らせ、`boardMeta is not a function` や型エラーで落ちたものは、そのスペックのダブルに `boardMeta`（`of({ columns: [], settings: { cardLayout: 'pack' } })` 相当）を足す。事前の洗い出しは `grep -ln "board:\|api.board\|'/api/board'" frontend/src/app/*.spec.ts`。

## Task 5: 検証

- [x] バックエンド: `cd backend && go build ./... && go vet ./... && go test ./...`。
- [x] フロントエンド: `cd frontend && npm test -- --watch=false`（全体）と `npm run build`。この環境は負荷が高く遅いので、バックグラウンドで実行して完了を待つ。`node_modules` は、メインの `frontend/node_modules` を `cp -Rc` で実体コピーしたものを使う（シンボリックリンクだとビルドが止まる）。
- [x] 変異の確認（各変異の前にテストが通ること、変異が適用されたこと（`git diff`）、失敗の理由が該当の断言であること、戻した後に `git diff` が元の差分と一致することを確認する。L-060: ヘルパーのフォールバックが配線漏れを隠さないことを、切り替えた経路ごとに示す）:
  - フロントエンド: 次の各経路で、`fetchBoardMeta(this.api)`（または `resolveBoardMetaConditional` の呼び出し）を、`this.api.board()`（または `boardConditional` の経路）に戻し、対応する Task 4 のテストが落ちることを確認する。
    - (a1) `item-detail.ts` のポーリング（`fetch`）、(a2) `item-detail.ts` の `loadCardForRoute`
    - (a3) `project-session.ts` の `load()`、(a4) `project-session.ts` の `delete()` 後
    - (a5) `recurring.ts` の `loadColumns()`
    - (b1) `backlog.ts` の `load()`、(b2) `pollBacklogBoard()`、(b3) `reloadAfterProjectSwitch()`
  - バックエンド:
    - (c) `auth_middleware.go` の `sessionExempt` に、`r.Method == GET && path == "/api/board/meta"` を足す。`TestBoardMetaRequiresSession` が落ちることを確認して戻す。
    - (d) `BoardMeta` が `items` を含む形にする（`TestBoardMetaReturnsColumnsAndSettingsWithoutItems` が落ちる）。
    - (e) `boardMeta` ハンドラで `replyJSONWithETag` を `reply`（ETag なし）に置き換える（`TestBoardMetaETag304` が落ちる）。
- [x] 実ブラウザー（設計書の受け入れ条件 5）: 新しい API は、本番のボードにはまだ無いので、ホストされたボードでは測れない。ローカルで `docker compose up`（`db` と `api` と `web`）ができれば、ネットワークの記録で、ボード画面の起動の `GET /api/board` が 2 回と `GET /api/board/meta` が 1 回、詳細・バックログのポーリングが `meta` だけになることを確認する。ローカルで起動できなければ、実測は未実施として PR に明記し（設計書の受け入れ条件 5 にも同じ扱いを書いてある）、自動テストの呼び出し回数の断言で代える。
- [x] 変更はコミットしない（後続の `/commit-ja` が行う）。

## 実施結果（実装時の記録）

- バックエンド: `go test ./...` が通る。MySQL の統合テスト（`TestBoardMetaMatchesBoardMySQL`）は、使い捨ての MySQL 8.4 コンテナで実行して通った。`KANBAN_TEST_DSN` を付けた `internal/kanban` の全テストでは、7 件（履歴・コメント・番号・プロジェクト・繰り返しのマイグレーションの統合テスト）が落ちたが、変更前の `main` でも同じ 7 件が落ちる（テスト用 DB の状態が原因で、今回の変更とは無関係）。
- フロントエンド: 全体 109 ファイル・1040 件が通った（その後のレビュー対応で `backlog` のテストを 2 件足し、最終的に 1042 件）。`npm run build` が通る（CSS の予算超過の警告は、変更していない `item-detail.css` と `board.css` で、元からある）。
- 変異: a1〜a5・b1〜b3（フロントエンド）と c・d・e（バックエンド）は、すべて狙いどおりのテストが落ち、元に戻して `git diff` が一致することを確認した。
- 実ブラウザー（ローカルのバックエンド + `ng serve`、使い捨て MySQL）: ボード画面の起動で `GET /api/board/meta` が 1 回、`GET /api/board`（全件）が 2 回（ボード画面とお気に入り。修正前は 3 回）。バックログとアイテム詳細の 5 秒ごとのポーリングは、`/api/board/meta` だけで `/api/board` は飛ばない。`If-None-Match` 付きの再取得は 304。
