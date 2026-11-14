# 生成AI・CLIからステータスを変更する

タスク番号とステータス名を指定する、ローカル用のAPIです。画面のTASK-007と `/cards/7` はどちらもタスク番号7を表します。内部IDとは区別してください。

## ステータス変更

```sh
curl --fail-with-body --request PATCH \
  --header 'Content-Type: application/json' \
  --data '{"status":"Doing"}' \
  http://127.0.0.1:4200/api/cards/by-number/7/status
```

- `7` は画面と同じタスク番号です。
- `status` は移動先の列名です。Todo・Doing・Doneのほか、自分で追加した列も指定できます。
- 日本語の列もそのまま指定します。例: `{"status":"レビュー待ち"}`。
- 列名の前後空白は除去します。1〜60 Unicode文字。名前の照合は列作成時と同じMySQLの照合順序（大文字小文字・アクセントを区別しない）です。
- 成功時はHTTP 200と更新後のカードJSONを返します。既存のタイトル・説明・番号・作成日時を保持し、columnIdと更新日時を変更します。
- 同じステータスへ再送しても成功し、カードを追加したり番号を消費したりしません。更新日時は保存時刻になります。

Goへ直接アクセスする場合はポート8080でも同じパスを利用できます。Dockerの公開ポートを変更した場合はURLも合わせてください。

## 対象と結果の確認

変更前に、番号とカードの内容が目的のものか確認できます。

```sh
curl --fail-with-body http://127.0.0.1:4200/api/cards/by-number/7
```

列一覧はボードJSONのcolumnsにあります。

```sh
curl --fail-with-body http://127.0.0.1:4200/api/board
```

応答カードのnumberが対象番号、columnIdが目的の列のidであることを確認してください。GETで再取得しても同じステータスを確認できます。HTTPエラーを成功扱いしないよう、例では `--fail-with-body` を付けています。

## リクエストと応答

`PATCH /api/cards/by-number/{number}/status`

入力はstatusだけです。

```json
{"status":"Doing"}
```

number・id・title・description・columnIdなどを混ぜて送ると400になります。本文編集は従来の更新APIで行います。

応答形式は他のカードAPIと同じです。例えばタスク番号7の内部IDが22の場合、numberは7、idは22となります。列Doingのidが2ならcolumnIdは2です。APIが内部IDを解決するので、このエンドポイントを使う側は内部IDを調べる必要がありません。

## エラー

| HTTP | 条件 |
| --- | --- |
| 400 | numberが不正、statusが空・空白・null・非文字列・60文字超、不正JSON、未知のフィールド、存在しないステータス |
| 404 | タスク番号が存在しない・削除済み |
| 500 | DBなどで処理に失敗 |

エラーの本文は `{"message":"..."}` です。存在しない列を送っても自動作成しません。入力検証・取得・列の解決に失敗した場合はカードを変更しません。保存が失敗した場合は既存トランザクションがロールバックします。

## 既存APIとの違い

| API | 指定する番号・値 |
| --- | --- |
| `GET /api/cards/by-number/{number}` | 公開タスク番号 |
| `PATCH /api/cards/by-number/{number}/status` | 公開タスク番号とステータス名 |
| `GET /api/cards/{id}` | 内部ID |
| `PATCH /api/cards/{id}` | 内部IDとtitle/description/columnId/prUrlの部分更新 |

番号とIDを推測で読み替えません。例のカードに `PATCH /api/cards/7` を送ると、内部ID7を対象にしてしまいます。生成AIから画面のタスクを変更するときはby-numberを使ってください。

このアプリはローカル学習用の認証なし構成です。MCPや外部公開用の認証は別機能で、今回のAPI追加には含みません。同時更新は従来どおり最後の保存が優先されます。

## GitHub PRの紐付け

カードのJSONには `prUrl`（未登録は空文字）が含まれます。詳細画面の「GitHub PR」欄でも登録でき、保存済みのPRは別タブで開けます。1カードにつき1 URLです。

内部IDは番号から取得した応答の `id` を使います。例えばタスク番号3の内部IDが18なら次のように更新します。

```sh
curl --fail-with-body --request PATCH \
  --header 'Content-Type: application/json' \
  --data '{"prUrl":"https://github.com/owner/repo/pull/2"}' \
  http://127.0.0.1:4200/api/cards/18
```

`prUrl` だけのPATCHはタイトル・説明・ステータス・番号を保持します。省略またはnullは変更せず、空文字 `""` で解除します。作成APIの任意プロパティとしても使えます。前後の空白は取り除きます。

受け付ける形式は `https://github.com/{owner}/{repo}/pull/{正の整数}`、ASCIIで2048文字以内です。owner/repoは英数字・`_`・`-`・`.`（`.`／`..` 単独は不可）。末尾スラッシュ、先頭0の番号、query、fragment、credentials、port、他ホスト、制御文字、バックスラッシュは400になります。PRの実在や閲覧権限の確認、GitHubとの同期は行いません。

## 変更履歴

`GET /api/cards/by-number/{number}/history` は `{events: [...], nextBefore: 0}` を返します。eventsにはid、kind、occurredAt、recordedAt、changes（field/before/after）、note、evidenceUrlがあります。kindはcreated/updated/baseline/restoredです。statusの値は列名です。

日時降順・同時刻はID降順で最大50件。nextBeforeが0以外なら `?before={nextBefore}` で続けます。別カードのカーソルや未存在カードは404、不正カーソルは400です。更新成功後は先頭から再取得してください。履歴取得の失敗はカード編集を妨げません。

## 過去履歴の取り込み

通常のHTTPから過去記録を追加するAPIはありません。APIの初期化後に、確認済みマニフェストをCLIで追加します。カード本体のID・number・createdAtが一致しない場合や、不正フィールド・日時・根拠URLは拒否します。全体をtxで処理し、同じカードの同じkeyは同一内容なら再実行しても増えず、異なる内容なら拒否します。

```json
[{
  "number": 3,
  "cardId": 18,
  "createdAt": "2026-11-11T11:42:21.869108Z",
  "key": "pr-merged-2",
  "occurredAt": "2026-11-12T00:00:00Z",
  "changes": [],
  "note": "形式例です。実際の日時は根拠資料で確認して置き換えてください。",
  "evidenceUrl": "https://github.com/owner/repo/pull/2"
}]
```

```sh
cd backend
KANBAN_IMPORT_DSN='scrum:scrum_dev@tcp(127.0.0.1:3307)/scrumboard?parseTime=true' \
  go run ./cmd/import-history --file /absolute/path/reviewed-history.json
```

DBの接続設定は利用環境に合わせ、バックアップを取得してから実行してください。対象が履歴初期化済みであることを確認します。JSONは最大2MiB/10000件で、changesはtitle/description/status/prUrlの最大4項目です。各記録の必須項目はnumber・cardId・createdAt・key・occurredAt・noteで、空にできるのはchangesとevidenceUrlだけです（noteは1〜4000文字）。keyは英数字と`_.:-`の1〜128文字、changesの値はtitle 200・description 10000・status 60・prUrl 2048文字以内で同じfieldを重複できません。未知のキーは拒否します。失敗時のメッセージは原因の項目を示さないため、このとおりに確認してください。復元登録日時はDBが記録し、kindはrestored固定です。マニフェストやSQLダンプはGitへ追加しないでください。CLIは実在しない操作者、分からない変更前の値、正確な操作時刻を推測する道具ではありません。

occurredAtはMySQLのDATETIME(6)に合わせてマイクロ秒未満を切り捨てて保存・比較します。occurredAtは取り込み時刻より5分を超える未来の値を拒否し、1件でも不正なら全体を書き込みません（誤記すると一覧の最上位に残り、追記専用のため直せないためです）。カードのcreatedAtより前の値は、作成前にマージされたPRなどがあるため拒否しません。createdAtは対象カードの応答値をそのまま指定してください。取り込みはカード・履歴を書く前に、ほかのカード書き込み（作成・ステータス変更・削除・並び替え）と同じ全列ロックを取るので、ボードの更新とデッドロックしません（取り込み中はそれらの書き込みが待たされます）。同時バッチでもカードID順のロックとREAD COMMITTEDのキー確認で、異なる内容の同一キーを黙って無視しません。

# AIで整えてカードを起票する

`POST /api/cards/refined` は、タイトルと説明の下書きをClaude APIで整え、**Todo列**のカードとして起票します。生成AIやCLIから「下書きを渡すだけ」で起票できます。

## 準備

- Anthropic APIキーを用意し、`.env` の `ANTHROPIC_API_KEY` に設定してから `docker compose up -d --build` します（ホストで `go run` する場合は環境変数として渡します。ルートの `.env` は自動で読みません）。キーはGit管理外の `.env` にだけ書いてください。
- `ANTHROPIC_MODEL` で使うモデルを変更できます（空なら軽量な `claude-haiku-5-5`）。リクエストには `effort` を付けるため、`effort` に対応しないモデルを指定すると上流が400を返し、502（ログの種別は `invalid_request`）になります。
- `ANTHROPIC_API_KEY` と `ANTHROPIC_MODEL` の前後の空白や改行は取り除きます。空白だけのキーは未設定として扱います。
- Docker Composeは `${ANTHROPIC_API_KEY:-}` で値を補間するため、シェルに `ANTHROPIC_API_KEY` をexportしていると `.env` が空でもその値が使われ、この機能が有効になります。使わないときはシェル側を `unset` してください。
- キーが未設定でもアプリは通常どおり動きます。このエンドポイントだけが503（`ai_not_configured`）を返します。
- **料金が発生します。** Anthropicコンソール側で月額の利用上限を設定することを推奨します。サーバー側の制限は同時に処理する件数（4件）だけで、時間あたりや総額の上限ではありません。
- **下書きの本文はAnthropicへ送信されます。** 機密情報を含めないでください。
- AnthropicのSDKは、環境変数`ANTHROPIC_BASE_URL`などが設定されていると接続先をそれに切り替え、設定されたURLへ`ANTHROPIC_API_KEY`を送ります。ホストで`go run`するときは、意図しない`ANTHROPIC_BASE_URL`がシェルに残っていないか確認してください（Docker Composeでは渡さないので影響しません）。
- このAPIには認証がありません。既定は `127.0.0.1` のみに公開しています。公開ネットワークへ出さないでください（誰でも課金を伴う呼び出しができてしまいます）。

## 使い方

```sh
curl --fail-with-body --request POST \
  --header 'Content-Type: application/json' \
  --data '{"title":"ログイン画面のバグ","description":"パスワードを間違えると画面が固まる"}' \
  http://127.0.0.1:4200/api/cards/refined
```

- `Content-Type: application/json` が必須です（違うと415）。
- `title`・`description` はどちらも省略できますが、前後の空白を除いた結果の少なくとも一方は空でないことが必要です。`title` は200文字以内、`description` は2000文字以内（Unicodeの文字数）。未知のフィールド（`columnId` や `prUrl` など）は400です。ステータスは常にTodoで、PR URLは空です。
- `title` が空なら、AIが `description` から短い題名を作ります。`description` が空なら、保存される説明も空です（AIが説明を書いてきても採用しません）。
- 成功すると201と、作成されたカード（`POST /api/cards` と同じ形）を返します。履歴には `created` が記録されます。
- 整えた結果は、タイトル1〜200文字・説明10000文字以内の検証を通ったものだけを保存します。切り詰めません。説明のある下書きからAIが空の説明を返した場合は、内容の欠落として502にします。
- AIの指示は、意味を変えない・事実を足さない・下書きの言語を保つ・タイトルは1行・説明はプレーンテキスト（画面がMarkdownを描画しないため）、です。**意味が保たれているかはプロンプトで担保するだけで、サーバーは機械的に検証できません**（形式と長さだけを検証します）。起票後の内容は確認してください。下書きに信頼できない文章（外部のissue本文やWebページなど）を含める場合、その中の指示（「前の指示を無視して…」など）が整形結果に紛れ込む可能性があり、サーバーは検知できません。プロンプトで従わないよう指示していますが、保証ではありません。影響は作られる1枚のTodoカードの題名と説明に限られ（列・PR URL・他のカードは変わりません）、認証のない`POST /api/cards`でも同じ内容は書けますが、別のエージェントにそのカードを読ませる前には内容を確認してください。

## AI起票のエラー

失敗時の本文は `{"message": "...", "code": "..."}` です（400は既存と同じ `{"message"}`）。AIの応答・下書き・キーは含みません。

| HTTP | code | 条件 |
| --- | --- | --- |
| 400 | なし | 不正なJSON、未知のフィールド、タイトルと説明がどちらも空、文字数の超過。不正なJSONと未知のフィールド・型の違いは、既存のAPIと共通の文言「入力を確認してください。有効なJSONが必要です。」になります |
| 415 | `unsupported_media_type` | Content-Typeがapplication/jsonでない |
| 429 | `ai_busy` | 同時に処理中のAI呼び出しが4件に達している。少し待って再試行 |
| 502 | `ai_failed` | AIの失敗全般（認証、レート制限、サーバーエラー、タイムアウト、接続失敗、拒否、`max_tokens`での打ち切り、読めない・検証に通らない応答）。**カードは作られていないので再試行して構いません** |
| 503 | `ai_not_configured` | `ANTHROPIC_API_KEY` が未設定 |
| 500 | `server_error` | Todo列が無い、DBの失敗など |

- 全体のタイムアウト（15秒）を超えると、`code` のない固定本文の503が返ります。**この503を受けたときは、再試行する前にボードを確認してください**（カードが作られている可能性があり、そのまま再試行すると重複して作られ、AIの料金も再度かかります）。`ai_not_configured` の503とは `code` で区別できます。
- AI呼び出しは最大10秒（全体の残り時間が少ないときはそれより短く）で打ち切り、SDKの自動再試行はしません。
- 上限（説明2000文字、`max_tokens` 8192、10秒）は暫定の値です。上限内でも長い下書きは時間切れや打ち切りで502になりえます。実際のAPIでの確認は未実施のため、運用しながら調整してください。

## 実機確認の手順（未実施）

この機能は、偽のAnthropic APIサーバー（リクエストの形と各種応答）でだけ検証しています。実際のClaude APIでの動作は**未確認**です。鍵を設定した利用者が、次を一度確認してください。

1. 通常のスタックとは別の環境で `ANTHROPIC_API_KEY` を設定して起動する。通常のスタックを止めるか、`.env` の `WEB_PORT`/`API_PORT`/`MYSQL_PORT` を変えて `docker compose -p 名前 up -d --build` で分ける（ポートが衝突しないようにし、以降のcurlのURLとログの確認にも同じポート・`-p 名前` を使う）。
2. 上の「使い方」のcurlを実行し、201で、整った題名・説明のTodoカードができること（SDKが送る `Authorization: Bearer` による認証が受け入れられること、`output_config` の構造化出力が受け入れられることを含む）。
3. 説明だけ・タイトルだけの下書き、2000文字に近い長い下書きでも期待どおりか。長い下書きが502になる場合は上限を調整する。
4. 鍵を間違えたとき502になり、ログに鍵が出ないこと（`docker compose -p 名前 logs api`）。

# 列の並び替え

`PUT /api/columns/order` でボード上の全列の表示順を更新します。リクエストボディには現在のボードに存在するすべての列IDを新しい順で配列指定します。

```sh
curl --fail-with-body --request PUT \
  --header 'Content-Type: application/json' \
  --data '{"columnIds":[1,2,9,3]}' \
  http://127.0.0.1:4200/api/columns/order
```

- 成功時はHTTP 200で `{"columns":[...]}`（各列の新しい `position` 付きの配列）を返します。`GET /api/board` の `columns` もこの順（`position` 昇順・同値は `id` 昇順）になります。
- 新規列の作成（`POST /api/columns`）は現在の最大 `position + 1` を付与するため、並び替え後も常に末尾に追加されます。
- HTTP 400: `columnIds` 未指定・`null`・空配列、0以下のID、重複ID、不正JSON、未知のフィールド。
- HTTP 409: DBに存在する列の集合と一致しない場合（不足または存在しない列IDの指定）。
- HTTP 500: DB更新に失敗した場合（トランザクションはロールバックされます）。

# カードの並び替え・列間移動

`PUT /api/cards/order` で、影響する列ごとのカード順を一括更新します。リクエストには、対象列に現在属するカード ID の完全な集合を新しい順で含めます。列間移動では、ソース列とデスト列の両方を同じリクエストに含めます。

```sh
curl --fail-with-body --request PUT \
  --header 'Content-Type: application/json' \
  --data '{"columns":[{"columnId":1,"cardIds":[2,1]},{"columnId":2,"cardIds":[3]}]}' \
  http://127.0.0.1:4200/api/cards/order
```

- 成功時は HTTP 200 で `{"cards":[...]}`（ボードと同じく `position`・`id` 昇順の**全カード**）を返します。各カードに `position` が含まれます。`GET /api/board` のカード順もこれに従います。
- 空配列の `cardIds` は「その列にカードが0枚」を表します。
- 列（ステータス）が変わったカードだけ履歴に `updated`（status 変更）が追加され、更新日時（`updatedAt`）も更新されます。列内の並び替えや、他のカードの移動に伴う位置のずれでは、履歴も更新日時も変わりません。
- カードの新規作成、および詳細画面や `PATCH .../status` による列変更では、移動先列の末尾（`MAX(position)+1`）に配置されます。
- `position` は列内の並び順を表すだけで、連続した値や 0 始まりとは限りません（カードの削除で欠番ができます。並び替えのたびに、対象の列は 0 から振り直されます）。クライアントは `position`、同値は `id` の昇順で順序を決め、`position` を添字として使わないでください。
- HTTP 400: `columns` 未指定・`null`・空配列、`columnId` の重複や 0 以下、`cardIds` が `null`、カード ID の重複や 0 以下、不正 JSON、未知のフィールド。
- HTTP 409: 指定列に現在属するカード集合と `cardIds` の和集合が一致しない場合、または存在しない列・カード ID。
- HTTP 500: DB 更新に失敗した場合（トランザクションはロールバックされます）。

`position`（列内の並び順。カードの並び替え・列間移動が更新する）と `backlogPosition`（プロダクトバックログ全体の優先順位。`/api/backlog/order` が更新する）は独立した値で、一方を変えても他方は変わりません。どちらも各カードに含まれます。

# プロダクトバックログ

全カードを `backlog_position` 昇順（同値は `id` 昇順）で返します。ステータス（列）に関係なく Done も含みます。

```sh
curl --fail-with-body http://127.0.0.1:4200/api/backlog
```

成功時は HTTP 200 で `{"cards":[...]}`（各カードに `backlogPosition` 付き）を返します。

`PUT /api/backlog/order` で全カードの優先順位を更新します。リクエストボディには現在存在するすべてのカードIDを新しい順で配列指定します。

```sh
curl --fail-with-body --request PUT \
  --header 'Content-Type: application/json' \
  --data '{"cardIds":[3,1,2]}' \
  http://127.0.0.1:4200/api/backlog/order
```

- 成功時は HTTP 200 で `{"cards":[...]}`（新しい `backlogPosition` 付き）。
- 新規カード作成（`POST /api/cards`）は現在の最大 `backlog_position + 1` を付与するため、並び替え後も常に末尾に追加されます。
- HTTP 400: `cardIds` 未指定・`null`・空配列、0以下のID、重複ID、不正JSON、未知のフィールド。
- HTTP 409: DBに存在するカードの集合と一致しない場合（不足または存在しないカードIDの指定）。
- HTTP 500: DB更新に失敗した場合（トランザクションはロールバックされます）。
