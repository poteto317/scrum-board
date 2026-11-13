# scrumboard

スクラムを学びながら育てる、Angular + Go + MySQLのかんばんMVPです。

## できること

- Todo / Doing / Doneから始める単一ボード
- 任意のステータス列を末尾へ追加（同名不可・1〜60文字）
- カードの追加、詳細表示、編集、削除
- 詳細画面でステータスを選択して移動
- カードは列内に縦積み、列が増えたらボード内で横スクロール
- MySQLへの永続化
- APIで下書き（タイトル・説明）を渡すと、AI（Claude）が整えたTodoのカードを起票（任意。`ANTHROPIC_API_KEY`を設定したときだけで、料金が発生し、下書きがAnthropicへ送信されます。[使い方](docs/api.md#aiで整えてカードを起票する)）

Todoに「ドラッグ＆ドロップでカードの移動・並べ替えを実装する」を初期登録します。ドラッグ＆ドロップ自体は今後の実装です。

## 最短で起動（Docker）

Docker Desktopを起動してから、このディレクトリで実行してください。

```sh
cp .env.example .env
docker compose up -d --build
```

**パスワードについて:** `.env.example` の `DB_PASSWORD`（初期値 `scrum_dev`）と `MYSQL_ROOT_PASSWORD`（初期値 `root_dev_only`）はローカル Docker 専用の既定値です。共有サーバーやインターネットへ出す環境では必ず別の強いパスワードへ変更し、開発用の値をそのまま使わないでください。

**認証について:** APIに認証はありません。Composeは各ポートを `127.0.0.1` にだけ公開します。公開ネットワークやクラウドへそのままデプロイしないでください。

- アプリ: http://localhost:4200
- Go API: http://localhost:8080/api/board
- MySQL: `127.0.0.1:3307` / DB `scrumboard` / user `scrum`
- 開発用パスワード: `.env` の `DB_PASSWORD`（上記のローカル専用初期値）

画面、API、MySQLをすべてコンテナで起動します。APIの起動はMySQLのhealthcheck成功を待ちます。画面からのAPI通信はNginxがGoへ転送するため、ブラウザーのCORS設定は不要です。

```sh
docker compose ps
docker compose logs -f api
docker compose stop          # 停止。データは保持
docker compose start         # 再開
docker compose down          # コンテナを削除。データボリュームは保持
```

MySQLのデータはComposeの名前付きボリューム`mysql_data`に保存します。`database/init/001_schema.sql`は**空のデータボリュームの初回起動時だけ**実行され、再起動時にサンプルは増えません。SQLファイルの編集は既存DBへ自動反映されません。今後のスキーマ変更ではバージョン管理したマイグレーションを追加してください。

完全に初期化する必要がある場合だけ `docker compose down -v` を使用します。これは保存したカードと列もすべて削除します。既存ボリュームがある状態で`.env`のDBパスワードを書き換えても、MySQLのユーザーパスワードは変わりません。

ポートが競合する場合は`.env`の`WEB_PORT`、`API_PORT`、`MYSQL_PORT`を変更してください。画面のコンテナ間通信はポート変更の影響を受けません。

## コードを編集しながら開発する

ホストにはNode.js 24（24.14.1で確認）、npm、Go 1.26以降を用意してください。Angular 21とTypeScript 5.9を利用しています。依存は`package-lock.json`と`go.sum`に記録しています。

まずMySQLだけをDockerで起動します。全コンテナを起動済みならAPIと画面のポートを空けます。

```sh
docker compose stop web api
docker compose up -d db
```

別々のターミナルで実行します。

```sh
# ターミナル1: Go API
cd backend
go mod download
go run ./cmd/server
```

```sh
# ターミナル2: Angular（変更を自動反映）
cd frontend
npm ci
npm start
```

http://localhost:4200 を開きます。Angular開発サーバーの`proxy.conf.json`が`/api`を`127.0.0.1:8080`へ転送します。

Goの環境変数（ホストで`go run`する場合、ルートの`.env`は自動読込しません）:

| 変数 | ホスト開発の既定値 |
| --- | --- |
| `DB_ADDRESS` | `127.0.0.1:3307` |
| `DB_USER` | `scrum` |
| `DB_PASSWORD` | `scrum_dev`（ローカル専用。公開環境では変更必須） |
| `DB_NAME` | `scrumboard` |
| `LISTEN_ADDRESS` | `127.0.0.1:8080` |
| `ANTHROPIC_API_KEY` | 空（未設定ならAI起票APIだけが503） |
| `ANTHROPIC_MODEL` | 空（`claude-haiku-5-5`。`effort`に対応したモデルのみ） |

変更した値は`DB_PASSWORD=... DB_ADDRESS=127.0.0.1:3307 go run ./cmd/server`のように渡してください。APIのポートを変えた場合は`frontend/proxy.conf.json`も合わせます。

## 構成と学習の読み順

```text
frontend/src/app/
  models.ts            JSONの型
  api.ts               HttpClientによるAPIアクセス
  api-error.ts         通信失敗の表示文言
  form-validation.ts   Unicode対応のフォーム入力検証
  board.ts/html/css     ボード・列追加・カード追加
  card-detail.*        詳細・編集・ステータス変更・削除
  modal.ts             native dialogのフォーカス管理
  app.routes.ts        画面のルーティング
backend/
  cmd/server/main.go   DB接続・HTTP起動・タイムアウト・正常終了
  cmd/server/wiring.go APIキーの有無によるAI機能の組み込み
  internal/aiformat/   Claude API（公式Go SDK）で下書きを整える
  internal/kanban/
    model.go           型とRepositoryインターフェース
    handler.go         各エンドポイントの処理
    http_transport.go  JSONの受け取り・ID解析・HTTP応答
    validation.go      タイトル・説明・列名の入力検証
    status_handler.go  タスク番号と列名による状態変更（PATCH /api/cards/by-number/{number}/status）
    repository.go      プレースホルダー付きSQL、更新トランザクション
    history*.go        変更履歴の追記・移行・ページング・復元
    refined*.go        AIで整えてTodoに起票するAPI（POST /api/cards/refined）とテスト
    numbering.go       タスク番号表の作成・既存カードの採番（API起動時に実行）
    handler_test.go    DBに依存しないAPIテスト
    status_handler_test.go         状態変更APIのDBに依存しないテスト
    numbering_integration_test.go  実MySQLの採番テスト（専用DBが無ければskip）
    status_integration_test.go     実MySQLの状態変更テスト（同上）
 database/init/        初期スキーマとサンプル（番号表はAPI起動時にGoが作成）
 scripts/smoke.py      実MySQLに対するHTTP受け入れ確認
 compose.yaml         3サービスとデータボリューム
```

1. `models.ts`と`model.go`で画面とAPIの共通データを読む。
2. `board.ts`のSignalsと`computed`で一覧表示の状態を追う。
3. `card-detail.ts`のReactive Formsと`api.ts`で、入力→HTTP→画面更新を追う。
4. `handler.go`→`Repository`→`repository.go`でGo側の処理を追う。
5. SQLの外部キー・一意制約とGoのエラー応答の関係を見る。

Angularのstandalone components、Router、HttpClient、Reactive Forms、Signalsを使用。Goは標準`net/http`と`database/sql`、MySQL接続には`go-sql-driver/mysql`を使用しています。AI起票だけは公式のAnthropic Go SDK（`anthropic-sdk-go/v2`）を使います。SDKを使うのは`internal/aiformat`と、組み立てを行う`cmd/server/wiring.go`（テストで接続先を差し替えるオプションの型だけ）で、`internal/kanban`は依存しません。ORMや大規模な状態管理ライブラリは導入せず、学習で処理を追える構成にしています。

## API

生成AI・CLIからは、公開タスク番号と列名で変更できる [ステータス変更APIの使い方](docs/api.md) を参照してください。

| Method | Path | 内容 |
| --- | --- | --- |
| GET | `/api/board` | `{columns: [...], cards: [...]}` |
| POST | `/api/columns` | `{name}`で列を追加 |
| POST | `/api/cards` | `{title, description, columnId, prUrl?}`でカード追加 |
| POST | `/api/cards/refined` | `{title?, description?}`の下書きをAIが整えてTodoに起票（要`ANTHROPIC_API_KEY`、料金あり。[詳細](docs/api.md#aiで整えてカードを起票する)） |
| GET | `/api/cards/{id}` | 内部IDによるカード詳細 |
| GET | `/api/cards/by-number/{number}/history` | 変更履歴（beforeで追加取得） |
| GET | `/api/cards/by-number/{number}` | タスク番号によるカード詳細 |
| PATCH | `/api/cards/by-number/{number}/status` | `{status}`（列名）でステータスだけ変更 |
| PATCH | `/api/cards/{id}` | `{title?, description?, columnId?, prUrl?}`で部分更新 |
| DELETE | `/api/cards/{id}` | 削除（204） |
| GET | `/api/health` | 起動確認 |

タイトルは1〜200文字、説明は10000文字以内。タイトル・列名の前後の空白は削除します。絵文字を含むUnicode文字数で検証します。空のPATCH、未知のプロパティ、不正なJSONも拒否します。エラー形式は`{"message":"..."}`。不正入力400、未存在404、重複列409、内部エラー500です。

列名の重複はMySQLの`utf8mb4_0900_ai_ci`で判定するため、大文字小文字・アクセントの違いを区別しません。列内のカードは作成日時・ID順です。ステータス移動でもこの順序を維持します。

## 検証

```sh
cd backend
go test -race ./...
go vet ./...
```

```sh
cd frontend
npm test -- --watch=false
npm run build
```

smokeは実DBでCRUD、ステータス変更、部分更新、Unicode、重複列、不正入力、削除後の404を確認します。テストカードは削除しますが、追加列`Review`は再利用できるよう残します。削除したタスク番号は再利用しないため、実行のたびに番号が1つ消費されます。普段使いのスタック（既定のポート8080 / 4200）では実行せず、プロジェクト名とポートを変えた使い捨てのスタックに対して、プロジェクトルートから実行してください。

```sh
MYSQL_PORT=3317 API_PORT=8081 WEB_PORT=4201 docker compose -p scrumboard-smoke up -d --build
API_URL=http://127.0.0.1:8081 python3 scripts/smoke.py
# Web側のAPI転送（nginx経由）も確認
API_URL=http://127.0.0.1:4201 python3 scripts/smoke.py
docker compose -p scrumboard-smoke down -v
```

`-p scrumboard-smoke` のスタックは専用のデータボリュームを持つため、`down -v` は使い捨て側だけを削除します。`-p` を付け忘れると普段使いのデータボリュームを削除するので、必ず付けてください。初期サンプルカードを削除・移動した状態などでは、初期サンプルを前提とする検査に注意してください。

## 今後の拡張とMVPの範囲

今回はローカル学習用・単一ボード・認証なしの構成です。公開用の認証、権限管理、複数ボード、スプリント、担当者、期限、リアルタイム共同編集は含みません。各サービスはホストのループバックアドレスにだけ公開します。

カード数に業務上の上限は設けていません。一覧は一括取得なので、大規模データに進む段階でページングや仮想スクロールを追加できます。同時編集は最後の保存が優先です。

拡張の例:

- 並べ替え用の`position`をカードに追加し、Angular CDKのDrag and DropとAPIを接続
- ボードIDとスプリントIDを追加
- 更新競合の検出と認証を追加
- DBマイグレーションツールを導入

依存監査ではAngular CLI配下の開発ツールにmoderateの指摘が残っています（glob/minimatch系）。互換性のないCLIへの強制ダウングレードは行っていません。配信用コンテナにはNode.js/CLIを含めず、ビルド済み静的ファイルだけを配置します。

公式資料: [Angular互換表](https://angular.dev/reference/versions)、[Go標準HTTP](https://pkg.go.dev/net/http)、[MySQLドライバー](https://pkg.go.dev/github.com/go-sql-driver/mysql)、[MySQL 8.4](https://dev.mysql.com/doc/refman/8.4/en/)。

APIへ直接、不正なUTF-8や片側だけのサロゲートエスケープを送った場合は、Go標準JSONデコーダーが置換文字`�`に変換します。このような破損入力の厳密な拒否は今後の改善事項です。通常の画面入力では発生しません。

## タスク番号と既存DBの移行

画面の `TASK-001` などはAPIの `number` を表示します。`number` は詳細URLにも使い、`id` は内部の識別子として更新・削除に使用します。例として `id: 18, number: 3` のカードは `/cards/3` で `TASK-003` と表示されます。画面は `GET /api/cards/by-number/3` で取得した内部IDを使って保存・削除します。

API起動時に `card_numbers` と `card_number_sequence` を冪等に作成し、未採番カードを作成日時・内部ID順で採番します。既存カードのID・本文・ステータス・日時は書き換えません。サンプルだけのDBではサンプルが1、その後の最初の作成が2になります。作成失敗は番号を消費せず、削除した番号は再利用しません。再起動・編集・ステータス移動でも一度発行した番号を維持します。

既存データのある環境では、APIを止めてバックアップを取得してから更新してください。移行はAPI公開前に実行され、失敗した場合は起動を中止します。旧版と新版のAPIを混在させず、新版が採番を終えてから公開します。バックフィルと新規採番は同じカウンター行をロックし、トランザクションで番号とカードを一緒に確定します。初期SQLの再実行やデータボリュームの削除は不要です。

旧版へコードを戻しても `cards` 本体は維持できますが、旧画面のURLと番号表示は内部ID方式へ戻ります。番号表の削除・再作成は番号の同一性を失うため行わないでください。

実MySQLの採番テストは、使い捨てDB `scrumboard_numbering_test` と `scrumboard_numbering_test_fresh` が必要です。`KANBAN_TEST_DSN` が未指定ならskipし、別名のDBは拒否します。テストはこの2つのDB内のテーブルだけをリセットします。

```sh
cd backend
KANBAN_TEST_DSN='scrum:scrum_dev@tcp(127.0.0.1:3308)/scrumboard_numbering_test?parseTime=true' go test -race -count=1 ./...
```

利用中の `scrumboard` では実行せず、専用のMySQLコンテナにテストDBと権限を用意してください。SQLの行ロックについては [MySQL公式資料](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html) を参照できます。

既存DBの更新前バックアップ例（SQLファイルはGit除外の `backups/` に保存）:

```sh
mkdir -p backups
docker compose stop api
docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump --default-character-set=utf8mb4 -uroot --single-transaction --databases "$MYSQL_DATABASE"' > "backups/scrumboard-$(date +%Y%m%d-%H%M%S).sql"
```

ダンプの終了コードとSQLファイルが正常であることを確認してから `docker compose up -d --build api web` で更新します。ダンプに失敗した場合は更新せず `docker compose start api` で元のAPIを再開してください。UTF-8の文字列を照合するSQLクライアントにも `--default-character-set=utf8mb4` を指定します。

画面URLは表示番号として解釈します。旧画面URLを内部IDとして推測するフォールバックは行いません。例えば `/cards/18` はタスク番号18のカードを表し、内部ID18のカードを意味しません。

### カードとGitHub PRの紐付け

カード詳細のプロパティにGitHub PRのURLを入力すると自動保存され、そのPRへのリンクを残せます。1カードにつき1 URLで、空欄にすると紐付けを解除します。APIからも `prUrl` の部分更新が可能です（[APIガイド](docs/api.md#github-prの紐付け)）。

URLは起動時に `backend/internal/kanban/pr_link.go` が準備する補助表 `card_pr_links` に保存します。既存のカード・番号は変更しません。既存DBの更新では、APIを停止してバックアップを取り、新しいAPIとWebへ切り替えてください。MySQLボリュームの削除や再初期化は不要です。古いAPIに戻してもURLデータは補助表に残りますが、古い画面では表示できません。

更新前のバックアップから復元する場合は、ダンプに含まれない補助表が取り残されないよう、復元の前にAPIを止めて補助表を削除してください。取り残された行は、復元で戻ったカードやその後に作ったカードと内部IDが重なり、別のカードにPR URLや番号が付くおそれがあります。更新後に保存したPR URLは失われ、番号は次のAPI起動時に作成日時・内部ID順で採番し直されます。

```sh
docker compose stop api
docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --default-character-set=utf8mb4 -uroot "$MYSQL_DATABASE" -e "SET FOREIGN_KEY_CHECKS=0; DROP TABLE IF EXISTS card_history, card_pr_links, card_numbers, card_number_sequence;"'
docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --default-character-set=utf8mb4 -uroot' < backups/<更新前のダンプ>.sql
docker compose start api
```

### 詳細の自動保存

カード詳細には保存ボタンがありません。タイトル・説明・GitHub PR URLは入力が600ms止まると自動保存し、入力し続けても最大2秒ごとに保存します。入力欄を離れたときとステータス変更は即時保存します。日本語変換中の本文は確定まで送信しません。

保存中も編集を続けられ、変更した有効な項目だけを順番にPATCHします。不正入力はそのまま残し、他の有効な項目は保存します。通信失敗では入力を保持し「再試行」を表示します。アプリ内の移動では保存完了を待ち、不正入力や失敗が残れば破棄確認します。リロード・タブ終了でも未保存時はブラウザーの標準確認を使います。未保存の入力をオフラインで永続化する機能は含みません。

### 変更履歴

詳細画面の「変更履歴」から、作成とタイトル・説明・ステータス・PR URLの変更前後を確認できます。自動保存とAPI更新のどちらも同じトランザクションで履歴を残し、値が変わらない再送では増えません。50件ずつ追加表示します。カードを削除すると、そのカードの履歴も削除されます。

起動時の `backend/internal/kanban/history_migration.go` が補助表 `card_history` を準備し、履歴のない既存カードには「履歴機能導入時の状態」を一度だけ保存します。過去の初期値を推定するものではありません。過去記録の復元は `backend/cmd/import-history` と `history_import.go`、画面は `frontend/src/app/card-history.*` を参照してください。

復元記録は「復元した記録」と注記・根拠PRで通常の変更と区別します。バックアップ間の差分は観測時刻であり、正確な操作時刻や途中の全変更を保証しません。作成日時しか分からない場合は初期本文を捏造しません。復元方法とJSON形式は[APIガイド](docs/api.md#過去履歴の取り込み)を参照してください。

バックアップを戻すと履歴もその時点へ戻ります。上記の復元手順で補助表を削除する場合、更新後に記録した履歴も失われます。通常の更新でボリュームやテーブルを初期化する必要はありません。
