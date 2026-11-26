# scrumboard

スクラムを学びながら育てる、Angular + Go + MySQLのかんばんMVPです。

## できること

- Todo / Doing / Doneから始める単一ボード
- ワークスペース内のプロジェクトでボード／バックログの表示を切り替え（ヘッダーで作成・改名・空プロジェクトの削除、詳細から所属移動）。列と番号は共通
- 任意のステータス列を末尾へ追加（同名不可・1〜60文字）
- アイテムの追加（追加ダイアログにステータス選択は無く常に Todo）、詳細表示、編集、削除
- 詳細画面でステータスを選択して移動（移動先列の末尾へ）
- ボード上でアイテム左端中央のハンドル（`⋮⋮`）をドラッグ＆ドロップ（または上下矢印キー）し、列内の並べ替えと別ステータスへの移動（アイテム本文のクリックは詳細へ遷移、右上のボタンでリンクをコピー）
- ボードツールバーの「自由配置」トグルで、既定の上詰め（`pack`）と空きを許す自由配置（`free`）を切り替え。自由配置では列間移動しても高さを保ち、同列内ドラッグで縦位置を変えられる（上下矢印キーでの並べ替えは上詰め時のみ）
- アイテムは列内に縦積み（列ごとの縦スクロールは無く、長い列はページを縦スクロール）。列が増えたらボード内で横スクロール
- ボードは5秒ごとに最新の状態へ自動で更新（アイテムや列のドラッグ中・保存中・レイアウト切替中・追加モーダル表示中は更新しません）
- プロダクトバックログ（全ステータスの優先順位リスト。ドラッグ／キーボードで並び替え、バックログからも新規追加・常に Todo）
- Done・Closeから10日経過したアイテムのプロジェクト別アーカイブ（ヘッダーの「アーカイブ」から参照、編集権限があれば元の列へ解除）
- MySQLへの永続化
- APIで下書き（タイトル・説明）を渡すと、AI（Claude）が整えたTodoのアイテムを起票（任意。`ANTHROPIC_API_KEY`を設定したときだけで、料金が発生し、下書きがAnthropicへ送信されます。[OpenAPI: refined](docs/openapi.yaml)）

## ボード共有 URL

ログイン後に `/?project=<プロジェクトID>` を開くと、そのプロジェクトのボードが表示されます（例: `/?project=2`）。不正・未知の ID はエラー表示し、黙って別プロジェクトには切り替えません。ヘッダーでプロジェクトを切り替えると、アドレスバーの `project` も更新されます。

## 最短で起動（Docker）

Docker Desktopを起動してから、このディレクトリで実行してください。

```sh
cp .env.example .env
chmod 600 .env   # 手元の .env は所有者のみ読める権限を推奨
docker compose up -d --build
```

**パスワードについて:** `.env.example` の `DB_PASSWORD`（初期値 `scrum_dev`）と `MYSQL_ROOT_PASSWORD`（初期値 `root_dev_only`）、および初期 admin（`AUTH_USER` / `ADMIN_INITIAL_PASSWORD`、既定 `admin` / `local_dev_admin`）はローカル Docker 専用です。共有サーバーやインターネットへ出す環境では必ず別の強いパスワードへ変更し、開発用の値をそのまま使わないでください。空の DB では API 起動時に admin をシードします（`ADMIN_INITIAL_PASSWORD` は 8 文字以上。`AUTH_PASSWORD` を使う場合は必ず別値）。

**認証について:** アプリは Cookie セッションログイン（`POST /api/auth/login`）がブラウザ本線です。空の DB ではログイン名がシード時の `AUTH_USER`（既定 `admin`）、初期パスワードが `ADMIN_INITIAL_PASSWORD` です（アプリ内で変更したあとは users 行のパスワードが正）。一般 API は Cookie `sb_session` **または** users テーブルに対応する HTTP Basic のどちらかで通ります（ブラウザの XHR も Basic を送れば users 照合します。nginx edge Basic がアプリパスワードと異なる場合は通りません）。セッション免除／任意の一覧と各 operation の要否は [OpenAPI](docs/openapi.yaml)（実装は `auth_middleware.go`）を正とします。nginx Basic は本番の **UI** ゲートとして残ります（`/api/` はアプリセッション／アプリ Basic のみ。スマホの XHR が Basic を付けないため）。Composeは各ポートを `127.0.0.1` にだけ公開します。公開ネットワークやクラウドへそのままデプロイしないでください。

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

完全に初期化する必要がある場合だけ `docker compose down -v` を使用します。これは保存したアイテムと列もすべて削除します。既存ボリュームがある状態で`.env`のDBパスワードを書き換えても、MySQLのユーザーパスワードは変わりません。

ポートが競合する場合は`.env`の`WEB_PORT`、`API_PORT`、`MYSQL_PORT`を変更してください。画面のコンテナ間通信はポート変更の影響を受けません。

## コードを編集しながら開発する（画面の自動反映）

### Dockerのまま（推奨）

静的な `web`（Nginx）の代わりに、`ng serve` の `web-dev` を同じポートで起動します。CSS/HTML/TSを保存するとブラウザーへ自動反映されます。

```sh
./scripts/dev-web.sh
# または
docker compose stop web
docker compose --profile dev up -d web-dev
```

`web` と `web-dev` はどちらも `${WEB_PORT:-4200}` を使うため同時には起動できません。`docker compose --profile dev up` をサービス名なしで実行すると両方上がってポートが衝突することがあるので、上記のとおり `web` を止めてから `web-dev` だけを起動してください（`./scripts/dev-web.sh` 推奨）。

- アプリ: http://localhost:4200
- コンテナ起動のたびに `npm ci` が走るため、数十秒かかることがあります（`docker compose --profile dev logs -f web-dev`）
- 静的配信に戻す: `docker compose --profile dev stop web-dev && docker compose up -d web`

### ホストで Angular / Go を動かす場合

ホストにはNode.js 24（24.14.1で確認）、npm、Go 1.26以降を用意してください。Angular 21とTypeScript 5.9を利用しています。依存は`package-lock.json`と`go.sum`に記録しています。

まずMySQLだけをDockerで起動します。全コンテナを起動済みならAPIと画面のポートを空けます。

```sh
docker compose stop web api
docker compose --profile dev stop web-dev
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

http://localhost:4200 を開きます。Angular開発サーバーの`proxy.conf.json`が`/api`を`127.0.0.1:8080`へ転送します。コンテナ内の `web-dev` は `proxy.docker.json` で `api` サービスへ転送します。

Goの環境変数（ホストで`go run`する場合、ルートの`.env`は自動読込しません）:

| 変数 | ホスト開発の既定値 |
| --- | --- |
| `DB_ADDRESS` | `127.0.0.1:3307`（`DB_SOCKET` 未設定時の TCP 接続先） |
| `DB_SOCKET` | 空（未設定時は TCP。Cloud SQL などでは例: `/cloudsql/PROJECT:REGION:INSTANCE`） |
| `DB_USER` | `scrum` |
| `DB_PASSWORD` | `scrum_dev`（ローカル専用。公開環境では変更必須） |
| `DB_NAME` | `scrumboard` |
| `LISTEN_ADDRESS` | `127.0.0.1:8080` |
| `ANTHROPIC_API_KEY` | 空（未設定ならAI起票APIだけが503） |
| `ANTHROPIC_MODEL` | 空（`claude-haiku-5-5`。`effort`に対応したモデルのみ） |
| `AI_RATE_LIMIT_PER_MINUTE` ほか | 既定オフ／長さ・maxTokens 上書きは [docs/ai-ops-limits.md](docs/ai-ops-limits.md) |
| `ATTACHMENT_GCS_BUCKET` | 空（未設定なら画像アップロードは503。ローカルテストは MemoryBlobStorage） |

変更した値は`DB_PASSWORD=... DB_ADDRESS=127.0.0.1:3307 go run ./cmd/server`のように渡してください。APIのポートを変えた場合は`frontend/proxy.conf.json`も合わせます。

## 構成と学習の読み順

```text
frontend/src/app/
  models.ts            JSONの型
  api.ts               HttpClientによるAPIアクセス
  api-error.ts         通信失敗の表示文言
  form-validation.ts   Unicode対応のフォーム入力検証
  board.ts/html/css     ボード・列追加・アイテム追加
  archive.*             プロジェクト別アーカイブ一覧・解除
  item-detail.*        詳細・編集・ステータス変更・削除
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
    status_handler.go  タスク番号と列名による状態変更（PATCH /api/items/by-number/{number}/status）
    assignee*.go       対応者ラベルの正規化・専用PATCH・起動時マイグレーション
    repository.go      プレースホルダー付きSQL、更新トランザクション
    history*.go        変更履歴の追記・移行・ページング・復元
    refined*.go        AIで整えてTodoに起票するAPI（POST /api/items/refined）とテスト
    numbering.go       タスク番号表の作成・既存アイテムの採番（API起動時に実行）
    handler_test.go    DBに依存しないAPIテスト
    status_handler_test.go         状態変更APIのDBに依存しないテスト
    assignee_handler_test.go       対応者APIのDBに依存しないテスト
    numbering_integration_test.go  実MySQLの採番テスト（専用DBが無ければskip）
    status_integration_test.go     実MySQLの状態変更テスト（同上）
 database/init/        初期スキーマとサンプル（番号表はAPI起動時にGoが作成）
 scripts/smoke.py      実MySQLに対するHTTP受け入れ確認
 compose.yaml         3サービスとデータボリューム
```

1. `models.ts`と`model.go`で画面とAPIの共通データを読む。
2. `board.ts`のSignalsと`computed`で一覧表示の状態を追う。
3. `item-detail.ts`のReactive Formsと`api.ts`で、入力→HTTP→画面更新を追う。
4. `handler.go`→`Repository`→`repository.go`でGo側の処理を追う。
5. SQLの外部キー・一意制約とGoのエラー応答の関係を見る。

Angularのstandalone components、Router、HttpClient、Reactive Forms、Signalsを使用。Goは標準`net/http`と`database/sql`、MySQL接続には`go-sql-driver/mysql`を使用しています。AI起票だけは公式のAnthropic Go SDK（`anthropic-sdk-go/v2`）を使います。SDKを使うのは`internal/aiformat`と、組み立てを行う`cmd/server/wiring.go`（テストで接続先を差し替えるオプションの型だけ）で、`internal/kanban`は依存しません。ORMや大規模な状態管理ライブラリは導入せず、学習で処理を追える構成にしています。

## API

HTTP API の**契約正本**は [OpenAPI（`docs/openapi.yaml`）](docs/openapi.yaml) です。AI／CLI 向けの短い入口は [docs/api.md](docs/api.md)（非規範）です。

| Method | Path | 目的 |
| --- | --- | --- |
| GET | `/api/board` | ボード取得 |
| POST | `/api/columns` | 列追加 |
| POST | `/api/items` | アイテム追加 |
| PUT | `/api/items/order` | アイテム並び替え・列間移動 |
| PATCH | `/api/board/settings` | ボード設定の部分更新 |
| POST | `/api/items/refined` | AI 整形して Todo 起票 |
| GET/POST/DELETE | `/api/projects/{id}/ai-chat` | プロジェクト単位の AI チャット（いちばん新しい会話の取得・質問・自分の会話を全部消す。AI はそのプロジェクトのアイテムを検索して答える） |
| GET | `/api/projects/{id}/ai-conversations` | プロジェクト単位の AI チャットの会話の一覧（自分の会話だけ。更新の新しい順） |
| GET/DELETE | `/api/projects/{id}/ai-conversations/{cid}` | 会話 1 つの取得（メッセージ付き）・削除 |
| GET | `/api/items/{id}` | アイテム詳細（内部 ID） |
| GET | `/api/items/by-number/{number}/history` | 変更履歴 |
| GET | `/api/items/by-number/{number}` | アイテム詳細（公開番号） |
| PATCH | `/api/items/by-number/{number}/status` | ステータス（列名）変更 |
| PATCH | `/api/items/by-number/{number}/assignee` | 対応者変更 |
| PATCH | `/api/items/{id}` | アイテム部分更新 |
| DELETE | `/api/items/{id}` | 削除 |
| GET | `/api/archive?projectId={id}` | プロジェクト別アーカイブ一覧 |
| POST | `/api/items/{id}/unarchive?projectId={id}` | アーカイブ解除して元の列（Done または Close）へ戻す |
| POST | `/api/archive/auto-archive` | Done・Closeから10日経過したアイテムを自動アーカイブ（Scheduler token または管理者セッション） |
| GET | `/api/command-templates` | コマンドテンプレート一覧 |
| POST | `/api/command-templates` | コマンドテンプレート追加 |
| PATCH | `/api/command-templates/{id}` | コマンドテンプレート更新 |
| DELETE | `/api/command-templates/{id}` | コマンドテンプレート削除 |
| GET/PUT | `/api/items/by-number/{n}/command-templates` | アイテムの表示セット |
| GET/PUT | `/api/command-template-defaults` | 新規アイテム初期テンプレート |
| POST | `/api/command-templates/apply-to-all-items` | 全アイテム表示セット置換 |
| GET | `/api/health` | 起動確認 |

フィールド・ステータスコード・認証要否の詳細は OpenAPI を参照してください。

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

smokeは実DBでCRUD、ステータス変更、部分更新、Unicode、重複列、不正入力、削除後の404を確認します。ボード等の API はアプリログイン（Cookie）が追加で必要なため、smoke を動かす場合は事前ログインで `sb_session` を付与してください。テストアイテムは削除しますが、追加列`Review`は再利用できるよう残します。削除したタスク番号は再利用しないため、実行のたびに番号が1つ消費されます。普段使いのスタック（既定のポート8080 / 4200）では実行せず、プロジェクト名とポートを変えた使い捨てのスタックに対して、プロジェクトルートから実行してください。

```sh
MYSQL_PORT=3317 API_PORT=8081 WEB_PORT=4201 docker compose -p scrumboard-smoke up -d --build
API_URL=http://127.0.0.1:8081 python3 scripts/smoke.py
# Web側のAPI転送（nginx経由）も確認
API_URL=http://127.0.0.1:4201 python3 scripts/smoke.py
docker compose -p scrumboard-smoke down -v
```

`-p scrumboard-smoke` のスタックは専用のデータボリュームを持つため、`down -v` は使い捨て側だけを削除します。`-p` を付け忘れると普段使いのデータボリュームを削除するので、必ず付けてください。初期サンプルアイテムを削除・移動した状態などでは、初期サンプルを前提とする検査に注意してください。

## 今後の拡張とMVPの範囲

今回はローカル学習用・単一ボードの構成です。アプリにはセッションログインとロール／ACL があります（詳細は最短起動節と `SECURITY.md`）。複数テナント、リアルタイム共同編集などは含みません。各サービスはホストのループバックアドレスにだけ公開します。

アイテム数に業務上の上限は設けていません。一覧は一括取得なので、大規模データに進む段階でページングや仮想スクロールを追加できます。同時編集は最後の保存が優先です。

拡張の例:

- ボードIDとスプリントIDを追加
- 更新競合の検出とより細かい認可を追加
- DBマイグレーションツールを導入

依存監査ではAngular CLI配下の開発ツールにmoderateの指摘が残っています（glob/minimatch系）。互換性のないCLIへの強制ダウングレードは行っていません。配信用コンテナにはNode.js/CLIを含めず、ビルド済み静的ファイルだけを配置します。

公式資料: [Angular互換表](https://angular.dev/reference/versions)、[Go標準HTTP](https://pkg.go.dev/net/http)、[MySQLドライバー](https://pkg.go.dev/github.com/go-sql-driver/mysql)、[MySQL 8.4](https://dev.mysql.com/doc/refman/8.4/en/)。

APIへ直接、不正なUTF-8や片側だけのサロゲートエスケープを送った場合は、Go標準JSONデコーダーが置換文字`�`に変換します。このような破損入力の厳密な拒否は今後の改善事項です。通常の画面入力では発生しません。

## タスク番号と既存DBの移行

画面の `ITEM-001` などはAPIの `number` を表示します。`number` は詳細URLにも使い、`id` は内部の識別子として更新・削除に使用します。例として `id: 18, number: 3` のアイテムは `/items/3` で `ITEM-003` と表示されます。画面は `GET /api/items/by-number/3` で取得した内部IDを使って保存・削除します。

API起動時に `item_numbers` と `item_number_sequence` を冪等に作成し、未採番アイテムを作成日時・内部ID順で採番します。既存アイテムのID・本文・ステータス・日時は書き換えません。サンプルだけのDBではサンプルが1、その後の最初の作成が2になります。作成失敗は番号を消費せず、削除した番号は再利用しません。再起動・編集・ステータス移動でも一度発行した番号を維持します。

既存データのある環境では、APIを止めてバックアップを取得してから更新してください。移行はAPI公開前に実行され、失敗した場合は起動を中止します。旧版と新版のAPIを混在させず、新版が採番を終えてから公開します。バックフィルと新規採番は同じカウンター行をロックし、トランザクションで番号とアイテムを一緒に確定します。初期SQLの再実行やデータボリュームの削除は不要です。

旧版へコードを戻しても `items` 本体は維持できますが、旧画面のURLと番号表示は内部ID方式へ戻ります。番号表の削除・再作成は番号の同一性を失うため行わないでください。

実MySQLの採番テストは、使い捨てDB `scrumboard_numbering_test` と `scrumboard_numbering_test_fresh` が必要です。`KANBAN_TEST_DSN` が未指定ならskipし、別名のDBは拒否します。テストはこの2つのDB内のテーブルだけをリセットします。

```sh
cd backend
KANBAN_TEST_DSN='scrum:scrum_dev@tcp(127.0.0.1:3308)/scrumboard_numbering_test?parseTime=true' go test -race -count=1 ./...
```

利用中の `scrumboard` では実行せず、専用のMySQLコンテナにテストDBと権限を用意してください。SQLの行ロックについては [MySQL公式資料](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html) を参照できます。

既存DBの更新前バックアップ例（SQLファイルはGit除外の `backups/` に保存）:

```sh
umask 077
mkdir -p backups
docker compose stop api
docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump --default-character-set=utf8mb4 -uroot --single-transaction --databases "$MYSQL_DATABASE"' > "backups/scrumboard-$(date +%Y%m%d-%H%M%S).sql"
```

ダンプの終了コードとSQLファイルが正常であることを確認してから `docker compose up -d --build api web` で更新します。ダンプに失敗した場合は更新せず `docker compose start api` で元のAPIを再開してください。UTF-8の文字列を照合するSQLクライアントにも `--default-character-set=utf8mb4` を指定します。

画面URLは表示番号として解釈します。旧画面URLを内部IDとして推測するフォールバックは行いません。例えば `/items/18` はタスク番号18のアイテムを表し、内部ID18のアイテムを意味しません。

### アイテムとGitHub PRの紐付け

アイテム詳細のプロパティでGitHub PRのURLを追加・削除・並べ替え（ドラッグまたは上下ボタン）できます。1アイテムに複数URLを登録でき（件数上限なし）、削除で解除します。APIからは `prUrls` 配列の部分更新が可能です（[OpenAPI](docs/openapi.yaml)）。関連アイテムも同様に並べ替えできます。

URLは起動時に `backend/internal/kanban/pr_link.go` が準備する補助表 `item_pr_links` に保存します（1アイテム複数行）。既存のアイテム・番号は変更しません。既存DBの更新では、APIを停止してバックアップを取り、新しいAPIとWebへ切り替えてください。起動時に旧スキーマ（1アイテム1行）から自動移行します。MySQLボリュームの削除や再初期化は不要です。古いAPIに戻してもURLデータは補助表に残りますが、古い画面では表示できません。

更新前のバックアップから復元する場合は、ダンプに含まれない補助表が取り残されないよう、復元の前にAPIを止めて補助表を削除してください。取り残された行は、復元で戻ったアイテムやその後に作ったアイテムと内部IDが重なり、別のアイテムにPR URLや番号が付くおそれがあります。更新後に保存したPR URLは失われ、番号は次のAPI起動時に作成日時・内部ID順で採番し直されます。

```sh
docker compose stop api
docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --default-character-set=utf8mb4 -uroot "$MYSQL_DATABASE" -e "SET FOREIGN_KEY_CHECKS=0; DROP TABLE IF EXISTS item_history, item_pr_links, item_numbers, item_number_sequence;"'
docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --default-character-set=utf8mb4 -uroot' < backups/<更新前のダンプ>.sql
docker compose start api
```

### 詳細の自動保存

アイテム詳細には保存ボタンがありません。タイトル・説明は入力が600ms止まると自動保存し、入力し続けても最大2秒ごとに保存します。入力欄を離れたときとステータス変更は即時保存します。GitHub PRの追加・削除は操作のたびに即時保存します。日本語変換中の本文は確定まで送信しません。

保存中も編集を続けられ、変更した有効な項目だけを順番にPATCHします。不正入力はそのまま残し、他の有効な項目は保存します。通信失敗では入力を保持し「再試行」を表示します。アプリ内の移動では保存完了を待ち、不正入力や失敗が残れば破棄確認します。リロード・タブ終了でも未保存時はブラウザーの標準確認を使います。未保存の入力をオフラインで永続化する機能は含みません。

### 変更履歴

詳細画面の「変更履歴」から、作成とタイトル・説明・ステータス・PR URLの変更前後を確認できます。自動保存とAPI更新のどちらも同じトランザクションで履歴を残し、値が変わらない再送では増えません。50件ずつ追加表示します。アイテムを削除すると、そのアイテムの履歴も削除されます。

起動時の `backend/internal/kanban/history_migration.go` が補助表 `item_history` を準備し、履歴のない既存アイテムには「履歴機能導入時の状態」を一度だけ保存します。過去の初期値を推定するものではありません。過去記録の復元は `backend/cmd/import-history` と `history_import.go`、画面は `frontend/src/app/item-history.*` を参照してください。

復元記録は「復元した記録」と注記・根拠PRで通常の変更と区別します。バックアップ間の差分は観測時刻であり、正確な操作時刻や途中の全変更を保証しません。作成日時しか分からない場合は初期本文を捏造しません。復元方法とJSON形式は `backend/cmd/import-history` および `history_import.go` を参照してください（HTTP API ではないため OpenAPI 外）。

バックアップを戻すと履歴もその時点へ戻ります。上記の復元手順で補助表を削除する場合、更新後に記録した履歴も失われます。通常の更新でボリュームやテーブルを初期化する必要はありません。

## 本番へのデータ移行（ローカル → Cloud SQL）

ローカル Compose の MySQL に溜まったアイテムを Cloud SQL へ載せる手順です。**インポートが終わってから**、DB 内テキストに残っている `http://127.0.0.1:4200` / `http://localhost:4200` を本番オリジンへ置き換えます。

### 1. ローカルからダンプを取得

API を止めてから、既存 README のバックアップ例と同様に `mysqldump` します（`/docker-entrypoint-initdb.d` の再実行は不要です）。

```sh
umask 077
mkdir -p backups
docker compose stop api
docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump --default-character-set=utf8mb4 -uroot --single-transaction --databases "$MYSQL_DATABASE"' > "backups/scrumboard-cloud-$(date +%Y%m%d-%H%M%S).sql"
```

終了コードと出力ファイルの先頭（`CREATE DATABASE` など）を確認してから次へ進みます。

### 2. Cloud SQL へインポート

Cloud SQL for MySQL 8 上に、本番と同じ DB 名・ユーザー（例: `scrumboard` / `scrum`）を用意したうえでインポートします。公式の [Cloud SQL への SQL インポート](https://cloud.google.com/sql/docs/mysql/import-export/importing) に従い、GCS 経由または `gcloud sql import sql` でアップロードしてください。インスタンスが起動していること、文字セットは `utf8mb4` であることを確認します。

**アイテム #42 の実施記録:** 一時的な authorized network + `mysql` クライアント（TCP）でインポートした。手順の正本は `docs/superpowers/specs/2026-11-15-prod-data-deploy-design.md`。実施結果は `docs/production-deploy-status.md`。GCS は未使用。

### 3. オリジン置換 CLI（インポート後・必須）

本番の `PUBLIC_ORIGIN`（末尾スラッシュなし、例: `https://scrum-board-xxxxx.asia-northeast1.run.app`）を **必ず** 設定してから `rewrite-origins` を実行します。未設定・空は更新せず非0終了です。

対象カラム: `items.title` / `items.description` / `item_history.note` / `item_history.evidence_url` / `command_templates.template`（`{{url}}` プレースホルダはそのまま。展開済み localhost のみ置換）。

**最初は必ずドライラン**で件数を確認します。

```sh
cd backend
export PUBLIC_ORIGIN='https://YOUR-SERVICE.asia-northeast1.run.app'
# Cloud SQL Auth Proxy または Cloud Shell 経由の接続例（DSN は環境に合わせる）
export KANBAN_IMPORT_DSN='scrum:YOUR_DB_PASSWORD@tcp(127.0.0.1:3306)/scrumboard?parseTime=true'
go run ./cmd/rewrite-origins --dry-run
go run ./cmd/rewrite-origins
```

`KANBAN_IMPORT_DSN` の代わりに `DB_USER` / `DB_PASSWORD` / `DB_NAME` と、Cloud SQL ユニックスソケットなら `DB_SOCKET=/cloudsql/PROJECT:REGION:INSTANCE` も使えます（API サーバーと同じ規則）。

置換は冪等です（同じ localhost パターンが無ければ更新 0 件で成功）。インポート直後に本番 URL が決まっていない場合は、Cloud Run を一度デプロイして `PUBLIC_ORIGIN` を確定してから CLI を走らせてください。

## 本番デプロイ（GCP: Cloud Run + Cloud SQL）

個人利用向けに **nginx Basic Auth 付き** でスマホから開く構成です。ローカル Compose の既定（`127.0.0.1`・アプリ認証あり・nginx Basic なし・`PUBLIC_ORIGIN` 不要）は変えません。本番専用の同居イメージは `deploy/Dockerfile`（nginx + Go API）です。

### 前提

- [Google Cloud SDK（`gcloud`）](https://cloud.google.com/sdk/docs/install) が入り、`gcloud auth login` 済み
- 課金が有効な GCP プロジェクト（`GCP_PROJECT` に自分のプロジェクト ID を必ず指定。スクリプトに本番既定は無い）
- ローカルに Docker（イメージのビルド・push 用）

### 1. API の有効化

プロジェクトで次を有効にします（初回のみ数分かかることがあります）。

```sh
export GCP_PROJECT=YOUR_GCP_PROJECT_ID   # 必須。自分のプロジェクト ID に置き換える
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  servicenetworking.googleapis.com \
  --project="$GCP_PROJECT"
```

### 2. Cloud SQL（MySQL 8・最小構成）

小規模利用なら Enterprise エディションの `db-f1-micro` など最小ティアから始めます（新規プロジェクトでは `--edition=enterprise` が必要なことがあります）。**常時起動のためクレジットを継続消費**します。試験後はインスタンス停止または削除でコストを抑えてください（README 末尾「停止・削除」）。

例（パスワードは強いランダム値を自分で生成し、Git やチャットに載せない）:

```sh
export GCP_REGION=asia-northeast1
gcloud sql instances create scrumboard-mysql \
  --database-version=MYSQL_8_4 \
  --edition=enterprise \
  --tier=db-f1-micro \
  --region="$GCP_REGION" \
  --project="$GCP_PROJECT"
gcloud sql databases create scrumboard --instance=scrumboard-mysql --project="$GCP_PROJECT"
gcloud sql users create scrum \
  --instance=scrumboard-mysql \
  --password='STRONG_DB_PASSWORD' \
  --project="$GCP_PROJECT"
```

接続名は `PROJECT:REGION:scrumboard-mysql` 形式です（`gcloud sql instances describe scrumboard-mysql --format='value(connectionName)'`）。

ローカルデータがある場合は上記「本番へのデータ移行」の dump → インポート → `rewrite-origins` を行います。空の新規 DB なら、初回 API 起動時のマイグレーションと `database/init` 相当のスキーマをインポートするか、一度ローカルからダンプしたスキーマ＋サンプル無し SQL を流します。

### 3. Artifact Registry とイメージのビルド・デプロイ

リポジトリルートで `scripts/deploy-gcp.sh` を使います。必須環境変数（少なくとも `GCP_PROJECT`・`CLOUDSQL_INSTANCE`・DB/AUTH/ADMIN/SCHEDULER 系）が欠けると **即終了** します。`.env.example` の GCP 行は例示のみで、スクリプトの本番既定ではありません。

**秘密の正本は Secret Manager です。** `export` した `DB_PASSWORD` / `AUTH_PASSWORD` / `ADMIN_INITIAL_PASSWORD` / `SCHEDULER_JOB_TOKEN`（および任意の `ANTHROPIC_API_KEY`）はスクリプトが SM に載せる一時入力であり、Cloud Run の平文環境変数には残りません（`--set-secrets` + 平文の `--remove-env-vars`）。必須 4 秘密は **再デプロイでも毎回 require**（シード後もキーを残し、値はローテ可）。`ANTHROPIC_API_KEY` は **任意**: 非空なら SM（既定 `scrum-board-anthropic-api-key`）へ載せてマウントし、空なら `--set-secrets` から除外して既存マウントも外れ AI は 503 のままです。

```sh
export GCP_PROJECT=YOUR_GCP_PROJECT_ID   # 必須。自分のプロジェクト ID に置き換える
export GCP_REGION=asia-northeast1
export CLOUDSQL_INSTANCE="${GCP_PROJECT}:${GCP_REGION}:scrumboard-mysql"
export DB_USER=scrum
export DB_PASSWORD='STRONG_DB_PASSWORD'   # → SM scrum-board-db-password
export DB_NAME=scrumboard
export AUTH_USER=kanban
export AUTH_PASSWORD='STRONG_AUTH_PASSWORD'   # nginx Basic。→ SM scrum-board-auth-password
export ADMIN_INITIAL_PASSWORD='STRONG_ADMIN_INITIAL_PASSWORD'  # 初期 admin。AUTH と別値必須 → SM scrum-board-admin-initial-password
# 任意: AI を有効にするときだけ。→ SM scrum-board-anthropic-api-key（平文 Cloud Run env には残さない）
# export ANTHROPIC_API_KEY='YOUR_ANTHROPIC_API_KEY'
# 任意: SM リソース名の上書き
# export SECRET_ID_DB_PASSWORD=...
# export SECRET_ID_AUTH_PASSWORD=...
# export SECRET_ID_ADMIN_INITIAL_PASSWORD=...
# export SECRET_ID_ANTHROPIC_API_KEY=...
# 省略可: 未設定ならスクリプトが https://example.com で起動し、デプロイ後に実 URL へ自動更新する
# export PUBLIC_ORIGIN='https://scrum-board-xxxxx.asia-northeast1.run.app'

# 初回のみ（スクリプトも幂等に enable する）
gcloud services enable secretmanager.googleapis.com --project="$GCP_PROJECT"

./scripts/deploy-gcp.sh
```

スクリプトは `secretmanager.googleapis.com` を有効化し、必須 4 秘密（DB / AUTH / ADMIN / SCHEDULER。と非空なら Anthropic）を create / versions add し、Cloud Run ランタイム SA に `secretAccessor` を付与したうえでイメージをビルド・push・デプロイします。Cloud SQL は **Unix ソケット** `DB_SOCKET=/cloudsql/INSTANCE_CONNECTION_NAME` で接続します。

アーカイブ・ゴミ箱 purge・recurring run の Cloud Scheduler ジョブは、デプロイ時には作成・実行されません。ゴミ箱 purge のジョブは、ゴミ箱の一覧が削除をしないため、実質必須です（#130）。ほかのジョブは必要なものだけ、デプロイ後に同じ `GCP_PROJECT` / `GCP_REGION` と Cloud Run の `SCHEDULER_JOB_TOKEN`、`PUBLIC_ORIGIN` を設定して個別スクリプトを実行してください。アーカイブは毎日 03:30（Asia/Tokyo）です。ゴミ箱 purge のジョブが無い環境では、保持期間（30 日）を過ぎた行は一覧に出なくなりますが、DB と添付の実体には残ります（ゴミ箱の一覧は読み取りだけで、削除しません）。

```sh
SCHEDULER_JOB_TOKEN=... PUBLIC_ORIGIN="$SERVICE_URL" ./scripts/ensure-archive-scheduler.sh
```

**イメージタグとハードニング:** `deploy/Dockerfile` のベースイメージは digest 固定、API プロセスはコンテナ内の非 root ユーザーで起動します。`deploy-gcp.sh` は **クリーンな git 作業ツリー** 上で `git rev-parse HEAD` を Artifact Registry のタグにし、Cloud Run デプロイもその **SHA タグ** を参照します（`:latest` は併記 push のみ）。デプロイ／nginx／ルート `.dockerignore`／Actions ピン／stylesheet onload／GCP_PROJECT フォールバック／任意 Anthropic SM を直す前後で `./scripts/check-deploy-image-hardening.sh`・`./scripts/check-nginx-tls-headers.sh`・`./scripts/check-nginx-gzip.sh`・`./scripts/check-nginx-cache.sh`・`./scripts/check-root-dockerignore.sh`・`./scripts/check-workflow-action-pins.sh`・`./scripts/check-no-deferred-stylesheet-onload.sh`・`./scripts/check-no-gcp-project-fallback.sh`・`./scripts/check-deploy-anthropic-optional.sh` を実行してください（`secret-scan` workflow の `deploy-guards` job でも同セット＋該当 `--selftest` を実行。gzip は `./scripts/check-nginx-gzip.sh --selftest`、キャッシュ指定は `./scripts/check-nginx-cache.sh --selftest`、Anthropic 任意マウントは `./scripts/check-deploy-anthropic-optional.sh --selftest` も）。ロールバックは過去のコミット SHA タグを `--image` に指定して再デプロイします。

**`PUBLIC_ORIGIN`:** entrypoint は `http://` / `https://` 必須（`placeholder.invalid` は拒否）。未指定時は一時値 `https://example.com` で起動し、`deploy-gcp.sh` がデプロイ後にサービス URL へ自動更新します。リンクコピーと `rewrite-origins` の置換先はこの値と一致させます。

`.env` に本番秘密を書かないでください。移行後は Basic / DB / 初期 admin の値をローテすることを推奨します（DB ユーザー変更は Cloud SQL 側とセット）。不要な旧リビジョンは削除すると、過去メタデータに残った平文 env の露出面を減らせます。

検証（最新リビジョンに平文が無いこと）:

```sh
gcloud run services describe scrum-board \
  --region="$GCP_REGION" --project="$GCP_PROJECT" \
  --format='yaml(spec.template.spec.containers[0].env)'
# DB_PASSWORD / AUTH_PASSWORD / ADMIN_INITIAL_PASSWORD に value: 平文が無く、secret 参照であること
# ANTHROPIC_API_KEY を渡してデプロイした場合も value: 平文が無く、secret 参照であること（空ならキー自体が無い）
```

### 4. 動作確認

```sh
# UI は nginx Basic 必須（AUTH_*）。API はアプリ認証のみ（Cookie または users のアプリ Basic）
curl -sS -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/"   # 401（nginx）
curl -sS -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/api/board"  # 401（アプリ JSON）

# アプリログイン Cookie（初期シード時は ADMIN_INITIAL_PASSWORD。変更後は admin の現在のパスワード）
# パスワードは argv に出さず stdin で渡す。UI 用 Basic は API には不要。
curl -sS -c /tmp/sb.ck -b /tmp/sb.ck \
  -H 'Content-Type: application/json' \
  --data-binary @- "$SERVICE_URL/api/auth/login" <<EOF
{"loginName":"$AUTH_USER","password":"$ADMIN_INITIAL_PASSWORD"}
EOF
curl -sS -b /tmp/sb.ck "$SERVICE_URL/api/board" | head

# ヘルスチェックは認証なしで 200（nginx の /health。Cloud Run は /healthz を予約するため使わない）
curl -sS -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/health"
```

`ADMIN_INITIAL_PASSWORD` は users が空の初回シードに使われます。`deploy-gcp.sh` は再デプロイでも同変数を require するため、キーは残し値をローテし、Secret Manager / IAM で閲覧を制限してください（アプリ側でパスワード変更後はシード値と一致しなくてよい）。

スマホのブラウザーでも同じ URL を開き、nginx Basic（UI）のあとアプリにログインしてボードが表示されることを確認します。API は Cookie のみで通ること（Basic を XHR に付けない Safari 等）も見る（`*.run.app` の URL をブックマーク）。

### 5. 停止・削除（コスト管理）

試験終了後:

```sh
gcloud run services delete scrum-board --region=asia-northeast1 --project="$GCP_PROJECT" --quiet
gcloud sql instances patch scrumboard-mysql --activation-policy=NEVER --project="$GCP_PROJECT"
# 完全に不要なら:
# gcloud sql instances delete scrumboard-mysql --project="$GCP_PROJECT"
```

Artifact Registry の古いイメージも容量に応じて削除できます。

### デプロイ試行の記録

実環境での試行結果は `docs/production-deploy-status.md` を参照してください（成功 URL またはブロック理由）。

### 本番イメージのビルドキャッシュ

`./scripts/deploy-gcp.sh` は Docker BuildKit と buildx（Docker Desktop標準）を使い、`linux/amd64` のイメージをローカルへロードしてからpushします。Node/Goのビルド段はホストCPUで動き、GoはターゲットCPUへクロスコンパイルします。

同じbuilderではnpmダウンロード、Goモジュール、Goコンパイルのキャッシュを再利用します。ソースだけの変更では依存取得レイヤーを再利用し、Goの変更したパッケージとリンクだけを再実行します。キャッシュの削除・GC・builder変更後は依存を再取得します。`.dockerignore` はローカルの依存・ビルド成果物・秘密ファイルを本番ビルドコンテキストから除外します。

### web-devの再起動

`web-dev` は `node scripts/start-docker.mjs` で起動します。依存のmanifest/lock、Node/npmのバージョンとCPU、インストール済みlockが前回成功時と一致し、`npm ls --all` が成功すると `npm ci` を省略します。空ボリュームや不一致・依存欠落時は再インストールし、失敗した場合は画面サーバーを起動しません。

成功記録は依存用ボリューム内の `node_modules/.web-dev-install.json` に保存します。依存ファイル自体の破損などで再インストールしたい場合は、web-devを停止してからこの記録を削除して再起動してください。同じボリュームを複数のweb-devで同時に更新しないでください。変更検知は1000ms間隔でポーリングします（CPU負荷は環境によって変わります）。起動処理のテストは `cd frontend && npm run test:docker-start` です。
