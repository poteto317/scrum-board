# 列と設定だけが必要な画面でボード全件を取得しない（#118）設計

## 背景

ボード全件の取得（`GET /api/board`）は、列・設定・アクティブなプロジェクトの ID・アイテム本体を 1 つの応答で返す。しかし、アイテム本体が要らない画面でも、この全件の取得を使っている。

| 場所 | 使う項目 | 現状の取得 |
| --- | --- | --- |
| `project-session.ts` の `load()`（起動時）と `delete()` 後 | `settings.activeProjectId` だけ | ボード全件 |
| `item-detail.ts` の初回読み込み（`loadCardForRoute`）と 5 秒ごとのポーリング | `columns` だけ | ボード全件（`api.board()`） |
| `backlog.ts` の `load()`・ポーリング（`pollBacklogBoard`）・プロジェクト切替後の再読み込み（`reloadAfterProjectSwitch`） | `columns` と `settings.activeProjectId` | バックログとボード全件の両方（アイテム本体を二重に取得） |
| `recurring.ts` の `loadColumns()` | `columns` だけ | ボード全件 |
| `favorites-session.ts` の `loadForActiveProject()` | `items`（お気に入りの抽出） | ボード全件 |
| `board.ts`（ボード画面） | 全部 | ボード全件 |
| `sprint-detail.ts` | `items`（スプリントの候補） | ボード全件 |

起動時は、`project-session`・`board`・`favorites-session` の 3 つが、それぞれ全件を取得する。

## 目的と完了条件（チケットから）

チケットの完了条件は、次の 2 つ。

1. 起動時のボード全件の取得が 1 回になる。
2. アイテム詳細・バックログのポーリングが、ボード全件を取得しない。

このチケットでは、2 を満たし、1 は「3 回から 2 回」まで進める（`project-session` を軽い API にする）。残りの 2 回（`board.ts` のボード画面と、`favorites-session.ts` のお気に入りの抽出。どちらもアイテム本体が要る）を 1 回にまとめる部分は、範囲外にして別のチケットにする（理由は「範囲外」に書く）。完了条件 1 は、別のチケットまで部分的な達成になる。

## 決めたこと

### 1. 軽い API を追加する: `GET /api/board/meta`

- 応答は `{ "columns": Column[], "settings": BoardSettings }`。`items` は含めない。
- `settings`（`cardLayout`、`mobileBoardColumnId`、`activeProjectId`）と `columns` の解決は、`GET /api/board` と同じ関数を使う。`loadBoard`（`repository.go`）の前半（列の取得、設定の取得、プロジェクト一覧、`MobileBoardColumnID` と `ActiveProjectID` の解決）を、`loadBoardHead(ctx, tx)` に切り出し、列・設定・プロジェクト一覧・解決済みのアクティブ ID を持つ構造体 `boardHead` を返す。`loadBoard` と、新しいリポジトリのメソッド `BoardMeta(ctx)`（`Columns` と `Settings` だけを使う）が、それぞれ自分の読み取り専用トランザクション（`ReadOnly: true`）の中でこの関数を呼ぶ（解決の規則を 2 か所に書かない）。アイテムの取得と、`resolveItemListScope`（不明な `projectId` で `ErrProject`）は `loadBoard` に残す。
- クエリの `projectId` は読まない。有効でも無効でも無視し、常に 200 を返す。有効な `projectId` のときは、`GET /api/board?projectId=` が `columns` と `settings` について返す値と同じ。無効・不明な `projectId` では、`GET /api/board` はエラーを返すが、meta はエラーにしない（既存 API との意図的な違い。列と設定はプロジェクトに依存しないので、エラーにする根拠が無い）。
- `replyJSONWithETag` で応答し、`If-None-Match` に一致すれば 304 を返す（`GET /api/board` と同じ）。
- 認証: `mux` に登録するだけで、`mux` 全体を包む `withSessionAuth` の内側に入る。`auth_middleware.go` の `sessionExempt` と `sessionOptional` には足さない。列と設定にはアイテムごとの ACL（閲覧・編集の権限）が関係しないので、`filterBoardItems` の呼び出しは要らない。
- 既存の `GET /api/board` の応答は変えない。

### 2. フロントエンドの API・型・ヘルパー

- `models.ts` に `BoardMeta { columns: Column[]; settings?: BoardSettings }` を追加する（API の生の応答の型。`BoardData` から `items` を除いた形）。
- `board-data.ts` に、正規化後の型 `NormalizedBoardMeta = { columns: Column[]; settings: BoardSettings }` と、`normalizeBoardMeta(raw)` を追加する。設定の正規化（`cardLayout` の補完、`mobileBoardColumnId` と `activeProjectId` の整数化と、未定義のときの削除）は、`normalizeBoardData` の中の処理を `normalizeBoardSettings(raw)` として切り出して、両方が使う。
- `board-active-sync.ts` の `applyBoardDataWithActiveSync` は、`board: T extends { settings: BoardSettings }` を受ける形に緩める（`NormalizedBoardData` も `NormalizedBoardMeta` も渡せる）。`mergeBacklogBoardPoll` は、すでに `TBoard extends { columns: unknown[] }` で `items` を要求しないので、変更しない。
- `Api` に `boardMeta()` と `boardMetaConditional(etag)` を追加する（どちらも `GET /api/board/meta`。後者は `If-None-Match` を付け、304 を `notModified` にする）。
- `conditional-get.ts` に、既存の `resolveBoardConditional` と同じ書き方（部分的なテストのダブルへのフォールバック）で、2 つのヘルパーを追加する。
  - `resolveBoardMetaConditional(api, etag)`（条件付き）: `api.boardMetaConditional` があればそれを使い、無ければ `api.board()` から `{ columns, settings }` を取り出して `ok`（etag は空）にする。`backlog.ts` が使う。
  - `fetchBoardMeta(api)`（条件なし）: `api.boardMeta` があればそれを使い、無ければ `api.board()` から `{ columns, settings }` を取り出す。`project-session.ts`・`item-detail.ts`・`recurring.ts` が使う。
  - 本番の `Api` は常に `boardMeta*` を持つので、フォールバックはテストのダブル専用。`board` だけを持つ `Api` のダブルが、`ProjectSession` を使う多数のスペック（`app.spec.ts` など）にあるため、それらを書き換えずに済ませる。

### 3. 切り替える呼び出し元

| 呼び出し元 | 取得の方法 | 変更 |
| --- | --- | --- |
| `project-session.ts` の `load()` | `fetchBoardMeta(api)` | `forkJoin` の `board` を `meta` にし、`normalizeBoardMeta(meta).settings.activeProjectId` を使う |
| `project-session.ts` の `delete()` 後 | `fetchBoardMeta(api)` | 同上 |
| `item-detail.ts` の `loadCardForRoute` とポーリング（`fetch`） | `fetchBoardMeta(api)` | `forkJoin` の `board` を `meta` にし、`meta.columns` を `columns` に設定する |
| `recurring.ts` の `loadColumns()` | `fetchBoardMeta(api)` | `board` を `meta` にする |
| `backlog.ts` の `load()`・`pollBacklogBoard()`・`reloadAfterProjectSwitch()` | `resolveBoardMetaConditional(api, etag)`（条件付き） | `boardGetConditional` を `boardMetaConditional` を使う形に置き換える。ETag の保持とリセット（`boardMetaEtag` に改名。位置は変えない）。`applyBoardDataWithActiveSync` には `normalizeBoardMeta` の結果を渡す |
| `favorites-session.ts` | 変更なし | アイテム本体（お気に入りの抽出）を使うので変えない |
| `board.ts`・`sprint-detail.ts`・`project-board-cache.ts` | 変更なし | アイテム本体を使うので変えない |

- 本番の経路が `boardMeta*` を使うことは、各呼び出し元の新しいテストで断言する（次の項目）。既存のスペックの `Api` のダブルは、`board` だけでも動く（フォールバック）。`HttpTestingController` を使うスペック（`project-session.spec.ts` など）は、エンドポイントの URL を `/api/board/meta` に差し替える。
- L-060（省略可能なヘルパーのフォールバックが配線漏れを隠す）に従い、切り替えた各呼び出し元の新しいテストで、`boardMeta`（または `boardMetaConditional`）が呼ばれて `board`・`boardConditional` が呼ばれないことを明示的に断言する。
- ポーリングの規則（L-040、L-775、L-860）は変えない: ポーリングの応答は、操作中（ドラッグ・保存・`switching`）には適用しない。`syncActiveFromBoard` は、ポーリングでは `clearIfMissing = false` のまま。世代番号・`activeId` の照合も、今のとおり。

## 受け入れ条件

1. バックエンド: `GET /api/board/meta` が `{ columns, settings }` を返し、`items` を含まない。`settings.activeProjectId` と `mobileBoardColumnId` の解決は、`GET /api/board` と同じ。`If-None-Match` の一致で 304。未認証は 401。無効な `projectId`（例: `?projectId=abc`）を付けても 200。
2. バックエンド: `GET /api/board` の応答は、今までと同じ（既存のテストが通る）。
3. フロントエンド: `project-session`（`load`・`delete`）、`item-detail`（初回・ポーリング）、`backlog`（`load`・ポーリング・`reloadAfterProjectSwitch`）、`recurring` が、`board()` ではなく `boardMeta*` を使う。各呼び出し元のテストで、`boardMeta*` が呼ばれて `board`・`boardConditional` が呼ばれないことを断言する。
4. フロントエンド: ポーリングの規則（操作中は適用しない、世代・`activeId` の照合、`syncActiveFromBoard` の `clearIfMissing`）が変わらない。既存のテストが通る。
5. 実ブラウザー（ネットワークの記録。新しい API は本番のボードにまだ無いので、ローカルで起動できる場合だけ測る。測れなければ、未実施と PR に明記し、自動テストの呼び出し回数の断言で代える）: ボード画面の起動で、`GET /api/board`（ボード全件）が 2 回（`board.ts` と `favorites-session.ts`）になり、`project-session` の取得が `GET /api/board/meta` になっていることを確認する（修正前は 3 回）。アイテム詳細・バックログを開いたまま 5 秒ごとのポーリングを観察し、`GET /api/board`（ボード全件）が飛ばず、`GET /api/board/meta` が飛ぶことを確認する。結果を PR に書く。

## 範囲外

- 起動時の `board.ts` と `favorites-session.ts` の、重なる 2 回のボード全件の取得を 1 回にまとめる仕組み（`Api` での飛行中の要求の共有、`ProjectBoardCache` を介した受け渡し、お気に入り専用の軽い API）。どの案も、起動時の発火順に依存して 1 回を保証できない、HTTP 層に状態を持たせる、キャッシュが古いお気に入りを返す恐れがある（プロジェクト切替）、といった別の設計判断を要する。別のチケットとして切り出す。
- `sprint-detail.ts` は、スプリントの候補にアイテム本体を使うので変えない。
- `project-board-cache.ts` の先読み（他のプロジェクトのボード）は変えない。
- 計測（件数・時間・転送量）は、チケットの出典のとおり見積もりで、このチケットでは実測を完了条件にしない（回数だけを数える）。

## 気をつける知見

- L-040: 複数の発生源の非同期取得で、古い結果が新しい状態を上書きしない（世代番号・`activeId` の照合を保つ）。
- L-775: ポーリングが、操作中（ドラッグ・保存）に応答を適用しない。
- L-860: `syncActiveFromBoard` をポーリングで `clearIfMissing = true` にしない。
- L-901: 副経路の API にも、主経路と同じ認証（`withSessionAuth`）を付ける。列と設定は ACL の対象外であることを、非管理者のセッションが 200 で同じ `columns` と `settings` を受け取るテストで確かめる。
- L-060: 省略可能なヘルパー（`resolveBoardMetaConditional` のフォールバック）が配線漏れを隠さないよう、切り替えた各呼び出し元で `boardMeta*` の呼び出しを断言する。
- L-1080: 新しい API にも ETag と 304 を付け、ポーリングの条件付き取得（`If-None-Match`）に対応させる。
