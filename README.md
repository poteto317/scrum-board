# scrumboard

スクラムを学びながら育てる、Angular + Go + MySQLのかんばんMVPです。

## できること

- Todo / Doing / Doneから始める単一ボード
- 任意のステータス列を末尾へ追加（同名不可・1〜60文字）
- カードの追加、詳細表示、編集、削除
- 詳細画面でステータスを選択して移動
- カードは列内に縦積み、列が増えたらボード内で横スクロール
- MySQLへの永続化

Todoに「ドラッグ＆ドロップでカードの移動・並べ替えを実装する」を初期登録します。ドラッグ＆ドロップ自体は今後の実装です。

## 最短で起動（Docker）

Docker Desktopを起動してから、このディレクトリで実行してください。

```sh
cp .env.example .env
docker compose up -d --build
```

- アプリ: http://localhost:4200
- Go API: http://localhost:8080/api/board
- MySQL: `127.0.0.1:3307` / DB `scrumboard` / user `scrum`
- 開発用パスワード: `.env` の `DB_PASSWORD`（初期値 `scrum_dev`）

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
| `DB_PASSWORD` | `scrum_dev` |
| `DB_NAME` | `scrumboard` |
| `LISTEN_ADDRESS` | `127.0.0.1:8080` |

変更した値は`DB_PASSWORD=... DB_ADDRESS=127.0.0.1:3307 go run ./cmd/server`のように渡してください。APIのポートを変えた場合は`frontend/proxy.conf.json`も合わせます。

## 構成と学習の読み順

```text
frontend/src/app/
  models.ts            JSONの型
  api.ts               HttpClientと入力検証
  board.ts/html/css     ボード・列追加・カード追加
  card-detail.*        詳細・編集・ステータス変更・削除
  modal.ts             native dialogのフォーカス管理
  app.routes.ts        画面のルーティング
backend/
  cmd/server/main.go   DB接続・HTTP起動・タイムアウト・正常終了
  internal/kanban/
    model.go           型とRepositoryインターフェース
    handler.go         HTTPの受け取り・入力検証・JSON応答
    repository.go      プレースホルダー付きSQL、更新トランザクション
    handler_test.go    DBに依存しないAPIテスト
 database/init/        初期スキーマとサンプル
 scripts/smoke.py      実MySQLに対するHTTP受け入れ確認
 compose.yaml         3サービスとデータボリューム
```

1. `models.ts`と`model.go`で画面とAPIの共通データを読む。
2. `board.ts`のSignalsと`computed`で一覧表示の状態を追う。
3. `card-detail.ts`のReactive Formsと`api.ts`で、入力→HTTP→画面更新を追う。
4. `handler.go`→`Repository`→`repository.go`でGo側の処理を追う。
5. SQLの外部キー・一意制約とGoのエラー応答の関係を見る。

Angularのstandalone components、Router、HttpClient、Reactive Forms、Signalsを使用。Goは標準`net/http`と`database/sql`、MySQL接続には`go-sql-driver/mysql`を使用しています。ORMや大規模な状態管理ライブラリは導入せず、学習で処理を追える構成にしています。

## API

| Method | Path | 内容 |
| --- | --- | --- |
| GET | `/api/board` | `{columns: [...], cards: [...]}` |
| POST | `/api/columns` | `{name}`で列を追加 |
| POST | `/api/cards` | `{title, description, columnId}`でカード追加 |
| GET | `/api/cards/{id}` | カード詳細 |
| PATCH | `/api/cards/{id}` | `{title?, description?, columnId?}`で部分更新 |
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

Dockerで全サービスを起動した状態で、プロジェクトルートから:

```sh
python3 scripts/smoke.py
# Web側のAPI転送も確認
API_URL=http://127.0.0.1:4200 python3 scripts/smoke.py
```

smokeは実DBでCRUD、ステータス変更、部分更新、Unicode、重複列、不正入力、削除後の404を確認します。テストカードは削除しますが、追加列`Review`は再利用できるよう残します。初期サンプルカードを削除・移動した状態などでは、初期サンプルを前提とする検査に注意してください。

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
