# 生成AI・CLIからステータスを変更する

タスク番号とステータス名を指定する、ローカル用のAPIです。画面のITEM-007と `/items/7` はどちらもタスク番号7を表します。内部IDとは区別してください。

## ステータス変更

```sh
curl --fail-with-body --request PATCH \
  --header 'Content-Type: application/json' \
  --data '{"status":"Doing"}' \
  http://127.0.0.1:4200/api/items/by-number/7/status
```

- `7` は画面と同じタスク番号です。
- `status` は移動先の列名です。Todo・Doing・Doneのほか、自分で追加した列も指定できます。
- 日本語の列もそのまま指定します。例: `{"status":"レビュー待ち"}`。
- 列名の前後空白は除去します。1〜60 Unicode文字。名前の照合は列作成時と同じMySQLの照合順序（大文字小文字・アクセントを区別しない）です。
- 成功時はHTTP 200と更新後のアイテムJSONを返します。既存のタイトル・説明・番号・作成日時を保持し、columnIdと更新日時を変更します。
- 同じステータスへ再送しても成功し、アイテムを追加したり番号を消費したりしません。更新日時は保存時刻になります。

## 対応者（assignee）

アイテムJSONの `assignee` は対応者ラベルです。未設定は空文字 `""` です。前後空白は除去します。プリセットは `Cursor` / `Claude` / `Codex` / `Antigravity`（ASCIIの大小無視で正規化）。それ以外は1〜60 Unicode文字の自由テキストです。

```sh
curl --fail-with-body --request PATCH \
  --header 'Content-Type: application/json' \
  --data '{"assignee":"Cursor"}' \
  http://127.0.0.1:4200/api/items/by-number/7/assignee
```

クリアは `{"assignee":""}` です。`null`・未知フィールド・61文字超・制御文字は400です（`PATCH /api/items/{id}` で他フィールドと同居しても `assignee:null` は400で、他フィールドも適用しません）。既存の `PATCH /api/items/{id}` でも `assignee` を部分更新できます。作成時の任意プロパティとしても送れます。

## アイテム権限（ACL）

アイテム JSON に `viewAccess`（`public`|`open`|`restricted`）、`editAccess`（`open`|`restricted`）、`createdByUserId` があります。詳細／作成／更新／ACL PATCH 応答には当該セッション向けの `canEdit` / `canManage` が付きます。`acl: { viewUserIds, editUserIds }` は manage 可能な応答にだけ含まれます。

- ボード／バックログ一覧は閲覧可のアイテムだけを返します。
- 閲覧不可の詳細 GET はログイン済みなら 403（固定文「閲覧権限がありません。」）、未ログインかつ非 public は 401。編集不可の書込は 403（「編集権限がありません。」）。
- `PATCH /api/items/{id}` に `viewAccess` / `editAccess` / `viewUserIds` / `editUserIds` / `acl` / `createdByUserId` を含めると 400 です。ACL は専用 API のみです。

```sh
curl --fail-with-body --request PATCH --header 'Content-Type: application/json' \
  --data '{"viewAccess":"restricted","editAccess":"restricted","viewUserIds":[2],"editUserIds":[2]}' \
  http://127.0.0.1:4200/api/items/22/acl
```

`PUT /api/items/order` と `PUT /api/backlog/order` は、クライアントから見えない restricted アイテムをサーバ側で元のスロットへ戻してから適用し、応答は閲覧可だけにフィルタします。並び替え対象（クライアントが送った ID）には編集権限が必要です。

## お気に入り（favorite）

アイテムJSONの `favorite` はお気に入り状態です。未設定相当は `false` です（キーはボード／バックログ／単体／by-number の GET と POST／PATCH 応答に含めます）。値は JSON boolean のみです。

```sh
curl --fail-with-body --request PATCH --header 'Content-Type: application/json' \
  --data '{"favorite":true}' \
  http://127.0.0.1:4200/api/items/22
```

省略は変更しません。`null`・文字列・数値は400です。解除は `false` を送ります。作成時の任意プロパティとしても送れます（省略時 `false`）。`PATCH .../status` や assignee 専用 API は `favorite` を変えません。履歴の field は `favorite` で、before/after は文字列 `true` / `false` です。

## ソリューション（solution）

アイテムJSONの `solution` は実装整理用の本文です。未設定は空文字 `""` です。説明（description）と同じく UTF-8 かつ Unicode 文字数最大 10000 で、内容の trim はしません。ボード GET・単体 GET・by-number GET・POST／PATCH 応答にキーを含めます。編集 UI は `/items/{number}/solution` です（詳細本文には埋め込みません）。

```sh
curl --fail-with-body --request PATCH \
  --header 'Content-Type: application/json' \
  --data '{"solution":"## 方針\n..."}' \
  http://127.0.0.1:4200/api/items/18
```

省略または `null` は変更しません。空文字 `""` でクリアします。10001文字超・不正UTF-8・未知フィールドは400です。作成時の任意プロパティとしても送れます。履歴の field は `solution` です。

## Close 理由（closeReason）

アイテムJSONの `closeReason` は Close 列向けの任意メモです。未設定は空文字 `""` です。前後空白は除去し、trim 後の Unicode 文字数は最大 2000（説明と同じ数え方）です。空文字でも Close できます。`PATCH /api/items/by-number/{number}/status` では理由を付けません（列移動だけ）。理由の入力・編集は詳細画面、または次の部分更新で行います。

```sh
curl --fail-with-body --request PATCH \
  --header 'Content-Type: application/json' \
  --data '{"closeReason":"要件が取り下げられたため"}' \
  http://127.0.0.1:4200/api/items/18
```

省略または `null` は変更しません。文字列を送ると trim 後に保存し、空文字 `""` でクリアします。2001文字超・不正UTF-8・未知フィールドは400です。作成時の任意プロパティとしても送れます。他列へ戻しても値は保持されます。

## 期限（dueAt）

アイテムJSONの `dueAt` は任意の期限です。未設定は JSON `null`（キーはボード GET・単体 GET・PATCH 応答のいずれにも必ず含まれます）。保存・応答は常に UTC の ISO8601（例 `2026-11-17T08:30:00Z`）で、秒は常に `00` です。

```sh
curl --fail-with-body --request PATCH \
  --header 'Content-Type: application/json' \
  --data '{"dueAt":"2026-11-17T17:30:00+09:00"}' \
  http://127.0.0.1:4200/api/items/18
```

`PATCH /api/items/{id}` での扱い:

- **省略**: 変更しない
- **`null`**: クリア（未設定にする）
- **`""`（空文字）**: 400（クリアは `null` のみ）
- **文字列**: 受理するのは (a) `Z` 付き UTC（例 `2026-11-17T08:30:00Z`）または (b) 数値オフセット付き RFC3339（例 `2026-11-17T17:30:00+09:00`）のみ。いずれも UTC に正規化し、秒・未満を 00 に揃えて保存・応答する。タイムゾーン無し・日付のみ・暦として無効な値は 400

履歴の field は `dueAt` です。before/after は API 応答と同型の UTC `…Z`（秒 00）、未設定は空文字 `""` です。

Goへ直接アクセスする場合はポート8080でも同じパスを利用できます。Dockerの公開ポートを変更した場合はURLも合わせてください。

## 対象と結果の確認

変更前に、番号とアイテムの内容が目的のものか確認できます。

```sh
curl --fail-with-body http://127.0.0.1:4200/api/items/by-number/7
```

列一覧はボードJSONのcolumnsにあります。

```sh
curl --fail-with-body http://127.0.0.1:4200/api/board
```

応答は `columns` / `items` に加え、`settings: { "cardLayout": "pack" | "free", "mobileBoardColumnId": number, "activeProjectId": number }` を含みます（`cardLayout` 既定は `pack`。`mobileBoardColumnId` はスマホ1列表示用の列 ID。未保存・無効値は Todo 列、無ければ `position` 昇順・同点は `id` 昇順の先頭。列が無いときは `0`。`activeProjectId` は解決後のアクティブプロジェクト。保存値が欠落・0以下・存在しない id のときは、名称に依存せず `position` 昇順・同点は `id` 昇順の先頭プロジェクト。プロジェクトが0件なら `0`。GET は DB を書き換えません）。`items` は省略時は解決後アクティブに属するアイテムだけです。任意クエリ `projectId`（正の整数・存在するプロジェクト）を付けると、`items` だけそのプロジェクトに切り替えます（`settings.activeProjectId` と DB のアクティブは変えません。先読み用）。`projectId` が 0 以下・非数・不存在のときは HTTP 400 です。各アイテムには所属 `projectId`、列内の並び `position` に加え、自由配置用の `offsetY`（列カードリスト上端からの CSS px・整数 0〜100000。欠落時は 0）が含まれます。応答アイテムのnumberが対象番号、columnIdが目的の列のidであることを確認してください。GETで再取得しても同じステータスを確認できます。HTTPエラーを成功扱いしないよう、例では `--fail-with-body` を付けています。

## 公開オリジン（本番リンク用）

```sh
curl --fail-with-body http://127.0.0.1:4200/api/public-config
```

応答は `{"publicOrigin":"<PUBLIC_ORIGIN または空文字>"}` です。環境変数 `PUBLIC_ORIGIN` が設定されていればその値（前後空白と末尾 `/` を除去）、未設定なら空文字です。フロントのアイテムリンク／コマンドの `{{url}}` は、非空ならこのオリジンを優先し、空なら `location.origin` を使います（取得失敗時はコピー失敗）。ローカル Compose の既定では空のままです。

## リクエストと応答

`PATCH /api/items/by-number/{number}/status`

入力はstatusだけです。

```json
{"status":"Doing"}
```

number・id・title・description・columnIdなどを混ぜて送ると400になります。本文編集は従来の更新APIで行います。

応答形式は他のアイテムAPIと同じです。例えばタスク番号7の内部IDが22の場合、numberは7、idは22となります。列Doingのidが2ならcolumnIdは2です。APIが内部IDを解決するので、このエンドポイントを使う側は内部IDを調べる必要がありません。

## エラー

| HTTP | 条件 |
| --- | --- |
| 400 | numberが不正、statusが空・空白・null・非文字列・60文字超、不正JSON、未知のフィールド、存在しないステータス |
| 404 | タスク番号が存在しない・削除済み |
| 500 | DBなどで処理に失敗 |

エラーの本文は `{"message":"..."}` です。存在しない列を送っても自動作成しません。入力検証・取得・列の解決に失敗した場合はアイテムを変更しません。保存が失敗した場合は既存トランザクションがロールバックします。

## 既存APIとの違い

| API | 指定する番号・値 |
| --- | --- |
| `GET /api/items/by-number/{number}` | 公開タスク番号（閲覧可。`viewAccess=public` ならセッション任意） |
| `PATCH /api/items/by-number/{number}/status` | 公開タスク番号とステータス名（編集可） |
| `PATCH /api/items/by-number/{number}/assignee` | 公開タスク番号と対応者ラベル（編集可） |
| `GET /api/items/{id}` | 内部ID（閲覧可。public ならセッション任意） |
| `PATCH /api/items/{id}` | 内部IDとtitle/description/solution/columnId/projectId/prUrls/assignee/closeReason/favorite/dueAtの部分更新（編集可。ACL キーは不可） |
| `PATCH /api/items/{id}/acl` | 閲覧／編集ポリシーと allowlist の置換（manage＝admin または作成者） |

番号とIDを推測で読み替えません。例のアイテムに `PATCH /api/items/7` を送ると、内部ID7を対象にしてしまいます。生成AIから画面のタスクを変更するときはby-numberを使ってください。

このアプリはローカル学習用の認証なし構成です。MCPや外部公開用の認証は別機能で、今回のAPI追加には含みません。同時更新は従来どおり最後の保存が優先されます。

## GitHub PRの紐付け

アイテムのJSONには `prUrls`（文字列配列。未登録は `[]`）が含まれます。詳細画面の「GitHub PR」欄で追加・削除・並べ替え（ドラッグまたは上下）ができ、保存済みのPRは配列順で別タブに開けます。件数の上限は設けません。同一アイテム内の重複URLと空要素は400です。配列順が `position` です（専用 reorder API はありません）。

内部IDは番号から取得した応答の `id` を使います。例えばタスク番号3の内部IDが18なら次のように更新します。

```sh
curl --fail-with-body --request PATCH \
  --header 'Content-Type: application/json' \
  --data '{"prUrls":["https://github.com/owner/repo/pull/2","https://github.com/owner/repo/pull/3"]}' \
  http://127.0.0.1:4200/api/items/18
```

`prUrls` だけのPATCHはタイトル・説明・ステータス・番号を保持します。省略またはnullは変更せず、空配列 `[]` で全解除します。配列を送ると全体置換です。作成APIの任意プロパティとしても使えます。各要素の前後空白は取り除きます。旧キー `prUrl` は未知フィールドとして400です。

受け付ける各URLの形式は `https://github.com/{owner}/{repo}/pull/{正の整数}`、ASCIIで2048文字以内です。owner/repoは英数字・`_`・`-`・`.`（`.`／`..` 単独は不可）。末尾スラッシュ、先頭0の番号、query、fragment、credentials、port、他ホスト、制御文字、バックスラッシュは400になります。PRの実在や閲覧権限の確認、GitHubとの同期は行いません。

## コメント

アイテム詳細向けのフラットなコメントです。`item_history` には記録しません。ルートは by-number のみです（任意 query `projectId` は既存と同じ解決）。

| 方法 | パス | 応答 |
|------|------|------|
| GET | `/api/items/by-number/{number}/comments` | `{ "comments": [ ... ] }`（`created_at` ASC, `id` ASC） |
| POST | `/api/items/by-number/{number}/comments` | 201 + 1件。body: `{ "author"?: string, "body": string }` |
| PATCH | `/api/items/by-number/{number}/comments/{id}` | 200 + 1件。`author` / `body` の少なくとも一方 |
| DELETE | `/api/items/by-number/{number}/comments/{id}` | 204 |

各コメント JSON: `id`, `itemId`, `author`, `body`, `createdAt`, `updatedAt`（RFC3339 UTC）。`author` / `body` は受信後に trim。`author` 省略・空白のみは `""`（最大60・制御文字禁止）。`body` は trim 後 1〜4000。制御文字は禁止だが改行（`\n`/`\r`）は許可。PATCH の空オブジェクト・`null`・未知キーは400。別アイテムの comment id は404。アイテム削除で CASCADE。

```bash
curl -u "$USER:$PASS" -X POST -H 'Content-Type: application/json' \
  --data '{"author":"Alice","body":"メモ"}' \
  http://127.0.0.1:4200/api/items/by-number/7/comments
```

## 画像添付

説明・ソリューション・コメント本文へ埋め込む画像です。バイト列は GCS（`ATTACHMENT_GCS_BUCKET`）、メタは `item_attachments`。本文への挿入はクライアント。DELETE 時のみサーバが description／solution／全 comment body から該当マークアップを除去します。

| 方法 | パス | 認証 | 応答 |
|------|------|------|------|
| GET | `/api/items/by-number/{n}/attachments` | 閲覧可 | `{ "attachments": [ ... ] }` |
| POST | `/api/items/by-number/{n}/attachments` | セッション＋編集可 | 201 + メタ。multipart: `file` + `field`（`description`\|`solution`\|`comment`）+ 任意 `commentId` |
| GET | `/api/items/by-number/{n}/attachments/{id}/content` | 閲覧可（item GET と同規則） | バイナリ。他 item の id は 404 |
| DELETE | `/api/items/by-number/{n}/attachments/{id}` | セッション＋編集可 | 204。GCS＋DB＋本文掃除。他 item id は 404 |

制約: MIME は `image/jpeg|png|gif|webp`（宣言とマジックバイト一致）、1枚 ≤5MiB、1 item ≤20枚。未知 multipart フィールド・`file` 欠落・不正 `field` は 400。バケット未設定時の POST は 503。マークアップ形: `![alt](/api/items/by-number/{n}/attachments/{id}/content)`。

```bash
curl -u "$USER:$PASS" -X POST \
  -F 'field=description' -F 'file=@shot.png;type=image/png' \
  http://127.0.0.1:4200/api/items/by-number/7/attachments
```

## 変更履歴

`GET /api/items/by-number/{number}/history` は `{events: [...], nextBefore: 0}` を返します。eventsにはid、kind、occurredAt、recordedAt、changes（field/before/after）、note、evidenceUrlがあります。kindはcreated/updated/baseline/restoredです。statusの値は列名、assigneeは対応者ラベル、closeReasonはClose理由、solutionはソリューション本文、favoriteは`true`/`false`文字列、dueAtはUTCの期限（未設定は空文字）です。

日時降順・同時刻はID降順で最大50件。nextBeforeが0以外なら `?before={nextBefore}` で続けます。別アイテムのカーソルや未存在アイテムは404、不正カーソルは400です。更新成功後は先頭から再取得してください。履歴取得の失敗はアイテム編集を妨げません。

## 過去履歴の取り込み

通常のHTTPから過去記録を追加するAPIはありません。APIの初期化後に、確認済みマニフェストをCLIで追加します。アイテム本体のID・number・createdAtが一致しない場合や、不正フィールド・日時・根拠URLは拒否します。全体をtxで処理し、同じアイテムの同じkeyは同一内容なら再実行しても増えず、異なる内容なら拒否します。

```json
[{
  "number": 3,
  "itemId": 18,
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

DBの接続設定は利用環境に合わせ、バックアップを取得してから実行してください。対象が履歴初期化済みであることを確認します。JSONは最大2MiB/10000件で、changesはtitle/description/solution/status/prUrls/relatedItems/assignee/closeReason/favorite/dueAtの最大10項目です。各記録の必須項目はnumber・itemId・createdAt・key・occurredAt・noteで、空にできるのはchangesとevidenceUrlだけです（noteは1〜4000文字）。旧キー`cardId`は`itemId`の別名として受理します。keyは英数字と`_.:-`の1〜128文字、changesの値はtitle 200・description/solution 10000・status 60・assignee 60・closeReason 2000・dueAtは空またはUTC …Z・prUrls/relatedItemsは65536バイト以内のJSON（prUrlsの各要素は非空のGitHub PR URL）で同じfieldを重複できません。旧フィールド名`prUrl`や未知のキーは拒否します。失敗時のメッセージは原因の項目を示さないため、このとおりに確認してください。復元登録日時はDBが記録し、kindはrestored固定です。マニフェストやSQLダンプはGitへ追加しないでください。CLIは実在しない操作者、分からない変更前の値、正確な操作時刻を推測する道具ではありません。

occurredAtはMySQLのDATETIME(6)に合わせてマイクロ秒未満を切り捨てて保存・比較します。occurredAtは取り込み時刻より5分を超える未来の値を拒否し、1件でも不正なら全体を書き込みません（誤記すると一覧の最上位に残り、追記専用のため直せないためです）。アイテムのcreatedAtより前の値は、作成前にマージされたPRなどがあるため拒否しません。createdAtは対象アイテムの応答値をそのまま指定してください。取り込みはアイテム・履歴を書く前に、ほかのアイテム書き込み（作成・ステータス変更・PR リンクの書き換え・削除・並び替え）と同じ全列ロックを取るので、ボードの更新とデッドロックしません（取り込み中はそれらの書き込みが待たされます）。同時バッチでもアイテムID順のロックとREAD COMMITTEDのキー確認で、異なる内容の同一キーを黙って無視しません。

# AIで整えてアイテムを起票する

`POST /api/items/refined` は、タイトルと説明の下書きをClaude APIで整え、**Todo列**のアイテムとして起票します。生成AIやCLIから「下書きを渡すだけ」で起票できます。

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
  http://127.0.0.1:4200/api/items/refined
```

- `Content-Type: application/json` が必須です（違うと415）。
- `title`・`description` はどちらも省略できますが、前後の空白を除いた結果の少なくとも一方は空でないことが必要です。`title` は200文字以内、`description` は2000文字以内（Unicodeの文字数）。未知のフィールド（`columnId` や `prUrls` など）は400です。ステータスは常にTodoで、`prUrls` は空配列です。
- `title` が空なら、AIが `description` から短い題名を作ります。`description` が空なら、保存される説明も空です（AIが説明を書いてきても採用しません）。
- 成功すると201と、作成されたアイテム（`POST /api/items` と同じ形）を返します。履歴には `created` が記録されます。
- 整えた結果は、タイトル1〜200文字・説明10000文字以内の検証を通ったものだけを保存します。切り詰めません。説明のある下書きからAIが空の説明を返した場合は、内容の欠落として502にします。
- AIの指示は、意味を変えない・事実を足さない・下書きの言語を保つ・タイトルは1行・説明はプレーンテキスト（画面がMarkdownを描画しないため）、です。**意味が保たれているかはプロンプトで担保するだけで、サーバーは機械的に検証できません**（形式と長さだけを検証します）。起票後の内容は確認してください。下書きに信頼できない文章（外部のissue本文やWebページなど）を含める場合、その中の指示（「前の指示を無視して…」など）が整形結果に紛れ込む可能性があり、サーバーは検知できません。プロンプトで従わないよう指示していますが、保証ではありません。影響は作られる1枚のTodoアイテムの題名と説明に限られ（列・PR URL・他のアイテムは変わりません）、認証のない`POST /api/items`でも同じ内容は書けますが、別のエージェントにそのアイテムを読ませる前には内容を確認してください。

## AI起票のエラー

失敗時の本文は `{"message": "...", "code": "..."}` です（400は既存と同じ `{"message"}`）。AIの応答・下書き・キーは含みません。

| HTTP | code | 条件 |
| --- | --- | --- |
| 400 | なし | 不正なJSON、未知のフィールド、タイトルと説明がどちらも空、文字数の超過。不正なJSONと未知のフィールド・型の違いは、既存のAPIと共通の文言「入力を確認してください。有効なJSONが必要です。」になります |
| 415 | `unsupported_media_type` | Content-Typeがapplication/jsonでない |
| 429 | `ai_busy` | 同時に処理中のAI呼び出しが4件に達している。少し待って再試行 |
| 502 | `ai_failed` | AIの失敗全般（認証、レート制限、サーバーエラー、タイムアウト、接続失敗、拒否、`max_tokens`での打ち切り、読めない・検証に通らない応答）。**アイテムは作られていないので再試行して構いません** |
| 503 | `ai_not_configured` | `ANTHROPIC_API_KEY` が未設定 |
| 500 | `server_error` | Todo列が無い、DBの失敗など |

- 全体のタイムアウト（15秒）を超えると、`code` のない固定本文の503が返ります。**この503を受けたときは、再試行する前にボードを確認してください**（アイテムが作られている可能性があり、そのまま再試行すると重複して作られ、AIの料金も再度かかります）。`ai_not_configured` の503とは `code` で区別できます。
- AI呼び出しは最大10秒（全体の残り時間が少ないときはそれより短く）で打ち切り、SDKの自動再試行はしません。
- 上限（説明2000文字、`max_tokens` 8192、10秒）は暫定の値です。上限内でも長い下書きは時間切れや打ち切りで502になりえます。実際のAPIでの確認は未実施のため、運用しながら調整してください。

## 実機確認の手順（未実施）

この機能は、偽のAnthropic APIサーバー（リクエストの形と各種応答）でだけ検証しています。実際のClaude APIでの動作は**未確認**です。鍵を設定した利用者が、次を一度確認してください。

1. 通常のスタックとは別の環境で `ANTHROPIC_API_KEY` を設定して起動する。通常のスタックを止めるか、`.env` の `WEB_PORT`/`API_PORT`/`MYSQL_PORT` を変えて `docker compose -p 名前 up -d --build` で分ける（ポートが衝突しないようにし、以降のcurlのURLとログの確認にも同じポート・`-p 名前` を使う）。
2. 上の「使い方」のcurlを実行し、201で、整った題名・説明のTodoアイテムができること（SDKが送る `Authorization: Bearer` による認証が受け入れられること、`output_config` の構造化出力が受け入れられることを含む）。
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

# アイテムの並び替え・列間移動

`PUT /api/items/order` で、影響する列ごとのアイテム順を一括更新します。リクエストには、対象列に現在属し、かつ解決後アクティブプロジェクトに属するアイテム ID の完全な集合を新しい順で含めます。他プロジェクトの ID は含めません。列間移動では、ソース列とデスト列の両方を同じリクエストに含めます。任意で各列に `offsetYs`（`itemIds` と同長の整数配列、各値は 0 以上 100000 以下）を付けられます。省略時は既存の `offset_y` を維持し `position` だけ更新します（上詰め DnD 互換）。サーバはアクティブ外のカードを更新しません。

```sh
curl --fail-with-body --request PUT \
  --header 'Content-Type: application/json' \
  --data '{"columns":[{"columnId":1,"itemIds":[2,1]},{"columnId":2,"itemIds":[3]}]}' \
  http://127.0.0.1:4200/api/items/order
```

自由配置の保存例（`offsetYs` 付き）:

```sh
curl --fail-with-body --request PUT \
  --header 'Content-Type: application/json' \
  --data '{"columns":[{"columnId":1,"itemIds":[2,1],"offsetYs":[40,120]}]}' \
  http://127.0.0.1:4200/api/items/order
```

- 成功時は HTTP 200 で `{"items":[...]}`（解決後アクティブプロジェクトのアイテム。`position`・`id` 昇順）を返します。各アイテムに `position`・`offsetY`・`projectId` が含まれます。`GET /api/board` のアイテム順もこれに従います。
- 空配列の `itemIds` は「その列にアイテムが0枚」を表します。
- 列（ステータス）が変わったアイテムだけ履歴に `updated`（status 変更）が追加され、更新日時（`updatedAt`）も更新されます。列内の並び替えや、他のアイテムの移動に伴う位置のずれでは、履歴も更新日時も変わりません。
- アイテムの新規作成、および詳細画面や `PATCH .../status` による列変更では、移動先の同一プロジェクト×列の末尾（その集合の `MAX(position)+1`）に配置されます。`cardLayout` が `free` のときは、同じ集合の `offsetY = COALESCE(MAX(offset_y), -160) + 160`（空なら 0）も付与します。`POST /api/items` の `projectId` を省略すると解決後アクティブに所属します。存在する id を指定できます。0以下・存在しない id は 400。`PATCH /api/items/{id}` の `projectId` で別プロジェクトへ移せます。移動先ではそのプロジェクト×列の `position` 末尾と、そのプロジェクトの `backlogPosition` 末尾に付きます。移動元の `position` / `backlogPosition` は詰めません。
- `position` は列内の並び順を表すだけで、連続した値や 0 始まりとは限りません（アイテムの削除で欠番ができます。並び替えのたびに、対象の列は 0 から振り直されます）。クライアントは `position`、同値は `id` の昇順で順序を決め、`position` を添字として使わないでください。
- HTTP 400: `columns` 未指定・`null`・空配列、`columnId` の重複や 0 以下、`itemIds` が `null`、アイテム ID の重複や 0 以下、`offsetYs` があるとき長さ不一致・負数・非整数・100000 超、不正 JSON、未知のフィールド（トップレベルおよび `columns[]` 要素）。
- HTTP 409: 指定列の解決後アクティブなアイテム集合と `itemIds` の和集合が一致しない場合（他プロジェクトの ID、不足、存在しない列・アイテム ID）。
- HTTP 500: DB 更新に失敗した場合（トランザクションはロールバックされます）。

`position`（所属プロジェクト×列の並び順。アイテムの並び替え・列間移動が更新する）と `backlogPosition`（所属プロジェクト内の優先順位。`/api/backlog/order` が更新する）は独立した値で、一方を変えても他方は変わりません。どちらも各アイテムに含まれます。

# プロジェクト

アイテムはちょうど1つのプロジェクトに属します。ボードとバックログの表示・並び替えは、解決後アクティブプロジェクトのアイテムだけが対象です。列・番号・`cardLayout`・モバイル列・リストフィルタはプロジェクトを分けません。

```sh
curl --fail-with-body http://127.0.0.1:4200/api/projects
curl --fail-with-body --request POST \
  --header 'Content-Type: application/json' \
  --data '{"name":"次の仕事"}' \
  http://127.0.0.1:4200/api/projects
curl --fail-with-body --request PATCH \
  --header 'Content-Type: application/json' \
  --data '{"name":"改名"}' \
  http://127.0.0.1:4200/api/projects/2
curl --fail-with-body --request DELETE \
  http://127.0.0.1:4200/api/projects/2
```

- `GET /api/projects` は `{ "projects": [ { "id", "name", "position", "createdAt", "updatedAt" } ] }`。順は `position` 昇順、同点は `id` 昇順。
- `POST` は 201 と Project。`name` は trim 後 1〜80 Unicode 文字。空白のみは 400。同名は許可（識別は id）。`position` は末尾。削除した id は再利用しません。
- `PATCH /api/projects/{id}` は `{ "name" }` で改名し、Project を返します。未知フィールド・空名は 400。無い id は 404。
- `DELETE` は 204。アイテムが1件でもある、または残るプロジェクトがこの1件だけのときは 409。アイテムが0件のときは残っているスプリント（completed 含む）を同一トランザクションで削除してからプロジェクトを削除します。
- マイグレーションは表示名「メイン」を1件作り、既存アイテムの id / createdAt は変えずにそこへ所属させます。

# スプリント

スプリントはプロジェクトに属します。クエリの `projectId` を省略すると解決後アクティブプロジェクトが対象です。状態は `planned` → `active`（`POST .../activate`）→ `completed`（`POST .../complete`）のみ。`PATCH` で `status` は変えられません。

```sh
curl --fail-with-body 'http://127.0.0.1:4200/api/sprints?projectId=1'
curl --fail-with-body --request POST \
  --header 'Content-Type: application/json' \
  --data '{"name":"Sprint 12","goal":"主要バグを潰す","startDate":"2026-11-21","endDate":"2026-12-04","projectId":1}' \
  http://127.0.0.1:4200/api/sprints
curl --fail-with-body http://127.0.0.1:4200/api/sprints/1
curl --fail-with-body --request PATCH \
  --header 'Content-Type: application/json' \
  --data '{"goal":"更新","startDate":"2026-11-22"}' \
  http://127.0.0.1:4200/api/sprints/1
curl --fail-with-body --request PUT \
  --header 'Content-Type: application/json' \
  --data '{"itemIds":[10,11]}' \
  http://127.0.0.1:4200/api/sprints/1/items
curl --fail-with-body --request POST \
  http://127.0.0.1:4200/api/sprints/1/activate
curl --fail-with-body --request POST \
  --header 'Content-Type: application/json' \
  --data '{"velocity":5}' \
  http://127.0.0.1:4200/api/sprints/1/complete
curl --fail-with-body --request DELETE \
  http://127.0.0.1:4200/api/sprints/1
```

- `GET /api/sprints` は `{ "sprints": [ SprintSummary ] }`。並びは `startDate` 降順、同日は `id` 降順。各行の `itemCount` は生存・同一プロジェクトかつ呼び出し元が view 可能なメンバー数。
- `POST` は 201 相当で詳細形。初期 `status` は `planned`、`velocity` は `null`。`name` は trim 後 1〜120。`goal` は trim せず Unicode スカラー 2000 以内（省略時 `""`）。日付は `YYYY-MM-DD` のみ、`startDate <= endDate`。
- `GET /api/sprints/{id}` はメンバー付き詳細。`suggestedVelocity` はメンバーのうち列名が正確に `Done` の件数（`Close` 除外。Done 列なしは 0）。メンバーは view 可能なものだけ。
- `PATCH` は `name` / `goal` / `startDate` / `endDate` / `velocity`。`velocity` は **completed のみ**（省略＝変更なし、`null`＝クリア、非負整数＝設定）。planned / active で `velocity` キーがあれば 400。
- `PUT .../items` は planned / active のみ。本文 `{ "itemIds": number[] }` は可視メンバーの完全集合（省略した可視メンバーはスプリントから外す）。送信 ID と、外す可視メンバー双方に edit 権限が必要。サーバは view 不可の既存メンバーを維持する。最終 `position` は可視 ID の順のあと、不可視を置換前の相対順で密に付与。他未完了スプリントへの重複は 409。他プロジェクト・ゴミ箱・不存在は 400/404。
- `POST .../activate` は planned→active（1 TX）。同一プロジェクトに他 active があれば 409。
- `POST .../complete` は active→completed のみ（1 TX）。本文任意 `{ "velocity"?: number }`。planned は 409。応答に `suggestedVelocity`。
- `DELETE` は planned / active のみ 204。completed は 409（履歴保持）。
- アイテムの soft delete および `projectId` 変更時は、当該 `item_id` の `sprint_items` をすべて削除する。
- HTTP 400: 不正日付・範囲・空白名・goal 超過・未知フィールド・未完了での velocity・不正 ID。
- HTTP 409: 状態遷移不可・メンバー重複・completed 削除/PUT・アイテム残存時のプロジェクト削除。

# 繰り返しルール（CRUD）

アクティブプロジェクトの繰り返しルールを管理します。**セッション必須**（`POST /api/recurring/run` のみセッション免除）。

```sh
curl --fail-with-body http://127.0.0.1:4200/api/recurring-rules
curl --fail-with-body --request POST \
  --header 'Content-Type: application/json' \
  --data '{"name":"週次ライブラリ更新","title":"ライブラリのアップデート","description":"依存関係を確認する","cron":"0 9 * * 1","columnId":1}' \
  http://127.0.0.1:4200/api/recurring-rules
curl --fail-with-body --request PATCH \
  --header 'Content-Type: application/json' \
  --data '{"enabled":false}' \
  http://127.0.0.1:4200/api/recurring-rules/1
curl --fail-with-body --request DELETE \
  http://127.0.0.1:4200/api/recurring-rules/1
```

- `GET /api/recurring-rules` は `{ "rules": [ RecurringRule ] }`。**アクティブプロジェクトのみ**。並びは `id` 昇順。`?projectId=` 先読みは初版対象外。
- `POST` は 201 で作成行。必須: `name`（trim 後 1〜80）、`title`（アイテム title と同じ規則）、`cron`（5 フィールド）、`columnId`（存在する列）。任意: `description`（省略時 `""`、空文字可）、`timezone`（**キー省略時** `Asia/Tokyo`。**空文字は 400**。未知 IANA も 400）、`enabled`（省略時 `true`）、`projectId`（省略時はサーバがアクティブを付与。指定時はアクティブと一致必須、不一致は 400）。
- `PATCH /api/recurring-rules/{id}` は部分更新（省略＝変更なし。L-002）。`description` の明示 `""` は空文字に更新、明示 `null` は 400。`enabled: false` で無効化可。不正 cron／空・未知 timezone／未知 columnId は 400。他プロジェクトの id・欠落は 404。
- `DELETE` は成功時 204。他プロジェクト／欠落は 404。
- ルール JSON: `id`, `projectId`, `name`, `title`, `description`, `cron`, `timezone`, `columnId`, `enabled`, `lastFiredAt`, `createdAt`, `updatedAt`。

# 繰り返し起票（run）

Cloud Scheduler 向けに、有効な繰り返しルールを評価してアイテムを自動起票します。**セッション不要**（Basic 認証ゲート前提。`POST /api/trash/purge` と同型）。CRUD は上記「繰り返しルール（CRUD）」節（セッション必須）。

```sh
curl --fail-with-body --request POST \
  http://127.0.0.1:4200/api/recurring/run
```

- 成功時は HTTP 200 と `{ "created": number, "skipped": number, "failed": number }`。
- `created`: アイテム作成に成功したルール数。
- `skipped`: ロック後に評価し、次回発火時刻がまだ来ていないルール数。
- `failed`: 列欠落・起票失敗・実行時の不正 cron／timezone など、起票を試みたが成功しなかった数。1 件の失敗でも他ルールは続行する。
- 起点は `lastFiredAt`（未発火なら `createdAt`）。成功時のみ `lastFiredAt` を更新する。1 ティックあたり最大 1 起票（キャッチアップ複数なし）。
- 自動起票の `createdByUserId` は `null`。`dueAt` は付けない。所属 `projectId` はルールのプロジェクト。

# ボード設定（カード配置・モバイル表示列・アクティブプロジェクト）

`PATCH /api/board/settings` でボード設定を更新します。本文は `cardLayout`（`"pack"` | `"free"`）、`mobileBoardColumnId`（正の列 ID）、`activeProjectId`（正のプロジェクト ID）を **それぞれ任意**（少なくとも1つ必須。未知フィールドは 400）。省略したキーは変更しません。設定は Basic Auth 共有のボード共通です。マージの基点は DB の生値です。

```sh
curl --fail-with-body --request PATCH \
  --header 'Content-Type: application/json' \
  --data '{"cardLayout":"free"}' \
  http://127.0.0.1:4200/api/board/settings
curl --fail-with-body --request PATCH \
  --header 'Content-Type: application/json' \
  --data '{"mobileBoardColumnId":2}' \
  http://127.0.0.1:4200/api/board/settings
curl --fail-with-body --request PATCH \
  --header 'Content-Type: application/json' \
  --data '{"activeProjectId":2}' \
  http://127.0.0.1:4200/api/board/settings
```

- 成功時は常に `{ "settings": { "cardLayout": "...", "mobileBoardColumnId": number, "activeProjectId": number } }` を返します（変更していないキーも含む）。`activeProjectId` は応答では解決済みの値です。無効な生値は、ユーザーが有効な id で PATCH したときだけ書き換わります。
- `free` → `pack` の遷移のときだけ同一トランザクションで全列のアイテムを `offset_y, position, id` 順に `position` を振り直し、応答に **`items`（解決後アクティブのアイテム）** も含めます（クライアントは再 GET 不要）。`offsetY` の値自体は残します。`mobileBoardColumnId` のみ、`activeProjectId` のみの PATCH や、すでに `pack` のままの更新では `items` を付けません。`activeProjectId` だけの PATCH は `cardLayout` とモバイル列を変えません。
- `pack` → `free` は settings 行のみ更新し、`items` は省略できます。画面上の上詰め結果から `offsetY` を測って先に `PUT /api/items/order`（`offsetYs` 付き）してからこの PATCH する想定です。途中失敗で設定だけ `free` にしないでください。
- HTTP 400: 3キーすべて欠落、`cardLayout` 不正値・空文字、`mobileBoardColumnId` が 0 以下または存在しない列、`activeProjectId` が 0 以下または存在しないプロジェクト、未知フィールド、不正 JSON。
- HTTP 500: DB 更新に失敗した場合（トランザクションはロールバックされます）。

# 一覧フィルタ（ボード／バックログ分離）

`GET` / `PUT /api/list-filter` で、かんばん（`board`）とプロダクトバックログ（`backlog`）それぞれの絞り込み状態を読み書きします。Basic Auth 共有のワークスペース共通 1 行で、**ビューごとに独立**です。一覧 API 自体は絞らず、クライアントが各ビューの `query`（タイトル／説明の部分一致）と `statusIds`（列 ID の複数選択。空配列＝全列）で表示を絞ります。

```sh
curl --fail-with-body http://127.0.0.1:4200/api/list-filter
curl --fail-with-body --request PUT \
  --header 'Content-Type: application/json' \
  --data '{"board":{"query":"ログイン","statusIds":[]},"backlog":{"query":"","statusIds":[1]}}' \
  http://127.0.0.1:4200/api/list-filter
```

- 応答は常に `{ "board": { "query", "statusIds" }, "backlog": { "query", "statusIds" } }`。
- 初期（行なし／Initialize）: `board.statusIds` は `[]`（全列）。`backlog.statusIds` は列名が Todo（大小無視・trim）の先頭列 ID。Todo 列が無ければ `[]`。
- 旧形式（単一 query/statusIds）からの移行: 旧値は `board` へ。`backlog` は上記 Todo 初期。旧カラムは DROP する。
- PUT は `board` と `backlog` の両方必須（全体置換）。各ネストの `query` は trim 後 200 文字以内。`statusIds` は正の整数配列（重複除去、存在しない列 ID は無視、最大 64 要素）。未知キーや null フィールドは 400。
- クリア後の空 `statusIds` は全列表示として保存され、再 GET で Todo を再シードしない。
- 壊れた DB の JSON は GET で安全なデフォルトを返すが、行を空で上書きしない。

# ヘッダーメニュー

`GET` / `PUT /api/header-menu` で、ページ種別（`board` / `backlog` / `itemDetail`）ごとにヘッダーのハンバーガーメニューから隠す項目 ID を読み書きします。Basic Auth 共有のワークスペース共通 1 行です。

```sh
curl --fail-with-body http://127.0.0.1:4200/api/header-menu
curl --fail-with-body --request PUT \
  --header 'Content-Type: application/json' \
  --data '{"board":{"hiddenIds":[]},"backlog":{"hiddenIds":["project_delete"]},"itemDetail":{"hiddenIds":[]}}' \
  http://127.0.0.1:4200/api/header-menu
```

- 応答は常に `{ "board": { "hiddenIds": string[] }, "backlog": { "hiddenIds": string[] }, "itemDetail": { "hiddenIds": string[] } }`。
- 初期（行なし）: 3 キーとも `hiddenIds` は `[]`（カタログ既定ですべて表示）。
- カタログ ID: `board` / `backlog` は `project_add`, `project_rename`, `project_delete`, `open_trash`, `open_users`, `open_recurring`。`itemDetail` は `open_trash`, `open_users`, `open_recurring`, `item_history`, `item_solution`, `item_favorite`。ラベル例: `open_recurring` → 「繰り返し」。
- PUT は 3 キーすべて必須（全体置換）。各ネストは `hiddenIds` のみ。要素は当該 pageKind のカタログ ID のみ（未知・他種別は 400）。重複 ID は除去して受理。未知トップキー・欠落キー・null・型不正は 400。
- GET は壊れた／欠落した保存値を正規化して返すが、DB 行は書き換えない（余分キー無視、欠落キー補完、不正型はそのキーだけ空、未知・非 string 要素は除去してユニーク化）。

# プロダクトバックログ

解決後アクティブプロジェクトのアイテムを `backlog_position` 昇順（同値は `id` 昇順）で返します。ステータス（列）に関係なく Done も含みます。他プロジェクトのアイテムは含めません。任意クエリ `projectId`（正の整数・存在するプロジェクト）を付けると、そのプロジェクトの items だけを返し、DB／ボードのアクティブは変えません（先読み用。不正値は HTTP 400）。

```sh
curl --fail-with-body http://127.0.0.1:4200/api/backlog
curl --fail-with-body 'http://127.0.0.1:4200/api/backlog?projectId=2'
```

成功時は HTTP 200 で `{"items":[...]}`（各アイテムに `backlogPosition` 付き）を返します。

`PUT /api/backlog/order` で解決後アクティブプロジェクトの優先順位を更新します。リクエストボディには、そのプロジェクトに現在存在するすべてのアイテムIDを新しい順で配列指定します。他プロジェクトの ID は含めず、それらの `backlogPosition` は変えません。

```sh
curl --fail-with-body --request PUT \
  --header 'Content-Type: application/json' \
  --data '{"itemIds":[3,1,2]}' \
  http://127.0.0.1:4200/api/backlog/order
```

- 成功時は HTTP 200 で `{"items":[...]}`（新しい `backlogPosition` 付き）。
- 新規アイテム作成（`POST /api/items`）は、所属プロジェクト内の最大 `backlog_position + 1` を付与するため、並び替え後もそのプロジェクトの末尾に追加されます。
- HTTP 400: `itemIds` 未指定・`null`・空配列、0以下のID、重複ID、不正JSON、未知のフィールド。
- HTTP 409: 解決後アクティブのアイテム集合と一致しない場合（不足、他プロジェクト、または存在しないアイテムIDの指定）。
- HTTP 500: DB更新に失敗した場合（トランザクションはロールバックされます）。

# コマンドテンプレート

ボードとアイテム詳細から、登録済みのコマンド文字列をワンクリックでクリップボードへ入れるためのテンプレートです。アイテム JSON とボード JSON には含めません。一覧は次の GET だけで取ります。

サーバーは `name` と `template` を UTF-8 文字列として保存するだけです。シェル、`eval`、`Function` には渡しません。`{{url}}` の置換もしません。置換はクライアントがコピー直前に行う文字列置換だけです。対象はリテラル `{{url}}`（大文字小文字を区別）で、アイテム詳細の絶対 URL（`origin + /items/{number}`）に置き換えます。他の `{{…}}` はそのまま残します。

## 一覧

```sh
curl --fail-with-body http://127.0.0.1:4200/api/command-templates
```

成功時は HTTP 200 で `{"templates":[...]}` です。各要素は `id`、`name`、`template`、`position` です。並びは `position` 昇順、同値は `id` 昇順です。0 件のときは `{"templates":[]}` です。

## 作成

```sh
curl --fail-with-body --request POST \
  --header 'Content-Type: application/json' \
  --data '{"name":"gh","template":"gh pr view {{url}}"}' \
  http://127.0.0.1:4200/api/command-templates
```

- 成功時は HTTP 201 と作成行（`id`、`name`、`template`、`position`）です。
- `position` は現在の末尾（最大 `position + 1`。0 件のときは 0）です。
- 本文の `{{url}}` は置換せず、送った文字列のまま保存します。

## 更新

`name` と `template` の少なくとも一方を送ります。省略した方は変わりません。

```sh
curl --fail-with-body --request PATCH \
  --header 'Content-Type: application/json' \
  --data '{"name":"gh pr"}' \
  http://127.0.0.1:4200/api/command-templates/1
```

成功時は HTTP 200 と更新後の行です。

## 削除

```sh
curl --fail-with-body --request DELETE \
  http://127.0.0.1:4200/api/command-templates/1
```

成功時は HTTP 204 で本文はありません。

## アイテムごとの表示セット

カタログとは別に、各アイテムのコピーメニューに出すテンプレートを選びます。未選択のアイテムのメニューは空です。

```sh
curl --fail-with-body http://127.0.0.1:4200/api/items/by-number/3/command-templates
curl --fail-with-body --request PUT \
  --header 'Content-Type: application/json' \
  --data '{"templateIds":[1,2]}' \
  http://127.0.0.1:4200/api/items/by-number/3/command-templates
```

- GET/PUT 成功時は HTTP 200 で `{"templates":[...]}`（アイテム内 `position` 昇順）。
- 存在しないアイテムは 404。`templateIds` にカタログに無い id があると 400（部分適用なし）。空配列 `[]` でそのアイテムを空にできます。重複 id は順序を保って一意化します。
- Go ServeMux の制約で内部 id パスは置かず、by-number のみです。

## 新規アイテムの初期セット

```sh
curl --fail-with-body http://127.0.0.1:4200/api/command-template-defaults
curl --fail-with-body --request PUT \
  --header 'Content-Type: application/json' \
  --data '{"templateIds":[1]}' \
  http://127.0.0.1:4200/api/command-template-defaults
```

成功時は HTTP 200 で `{"templateIds":[...]}` です。`POST /api/items`（および refined 作成）の成功時に、この一覧を新しいアイテムの表示セットへコピーします。あとからデフォルトを変えても既存アイテムは変わりません。

## 全アイテムへ適用

```sh
curl --fail-with-body --request POST \
  --header 'Content-Type: application/json' \
  --data '{"templateIds":[1,2]}' \
  http://127.0.0.1:4200/api/command-templates/apply-to-all-items
```

成功時は HTTP 204 です。全アイテムの表示セットを指定した id で**置き換え**ます（マージしません）。空配列で全アイテムを空にできます。トランザクションで行い、不正 id があれば 400 で何も変わりません。

## 制約

- `name` と `template` は JSON 文字列だけです。`null`、数値、配列、オブジェクトは 400 です。未知フィールド、不正な JSON、JSON を 2 つ続けた送信も 400（`入力を確認してください。有効なJSONが必要です。` または `JSONは1つだけ送信してください。`）です。
- `name` は前後の空白を除去します。除去後に空、または 60 Unicode 文字を超えると 400 です。メッセージは `名前は1〜60文字で、制御文字を含めず入力してください。` です。
- `template` は前後空白を保持します。空、または 2000 Unicode 文字を超えると 400 です。メッセージは `テンプレートは1〜2000文字で、制御文字を含めず入力してください。` です。LF/TAB等の制御文字は400です。
- `unicode.IsControl` に当たる rune（NUL、CR、LF、TAB など）を含む値は 400 です。
- 全体で最大 50 件です。51 件目の作成は 400 で `{"message":"コマンドテンプレートは50件までです。"}` です。
- PATCH で `name` も `template` も無い（`{}`）ときは 400 で `name か template を指定してください。` です。どちらかが `null` の PATCH も 400 です。送った方だけを検証し、もう一方は保持します。
- 存在しない id の PATCH と DELETE は 404 で `テンプレートが見つかりません。` です。id が 0 以下、または整数でないときは 400 で `テンプレートIDが不正です。` です。
- 保存はプレースホルダクエリだけです。テンプレート本文を SQL へ連結しません。エラー応答とログにテンプレート全文は出しません。
- HTTP 500 は `処理に失敗しました。時間をおいて再試行してください。` です。

Go へ直接アクセスする場合はポート 8080 でも同じパスです。Docker の公開ポートを変えた場合は URL も合わせてください。
