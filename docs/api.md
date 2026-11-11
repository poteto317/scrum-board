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
| `PATCH /api/cards/{id}` | 内部IDとtitle/description/columnIdの部分更新 |

番号とIDを推測で読み替えません。例のカードに `PATCH /api/cards/7` を送ると、内部ID7を対象にしてしまいます。生成AIから画面のタスクを変更するときはby-numberを使ってください。

このアプリはローカル学習用の認証なし構成です。MCPや外部公開用の認証は別機能で、今回のAPI追加には含みません。同時更新は従来どおり最後の保存が優先されます。
