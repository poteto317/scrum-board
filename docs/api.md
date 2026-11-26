# API 案内（非規範）

**契約の正本は [OpenAPI（`docs/openapi.yaml`）](openapi.yaml) です。** フィールド仕様・ステータスコード・認証要否・バリデーションは OpenAPI を見てください。このファイルは AI／CLI 向けの短い入口だけです。

## by-number と列名 status

画面の `ITEM-007` や `/items/7` は公開タスク番号 `7` です。内部 ID とは別です。生成 AI から列を動かすときは内部 ID の `PATCH /api/items/{id}` を推測で使わず、公開番号の status API を使います。

## アーカイブ

`GET /api/archive?projectId={projectId}` で閲覧可能なプロジェクト別アーカイブを取得します。Done・Close から10日経過したアイテムは毎日 03:30（Asia/Tokyo）に自動アーカイブされ、`POST /api/items/{id}/unarchive?projectId={projectId}` で編集権限のあるユーザーが元の列（Done または Close）に戻せます。自動処理は Cloud Scheduler から `POST /api/archive/auto-archive` を呼び出し、`X-Scheduler-Token` を送信します。

## プロジェクトの AI チャット

`POST /api/projects/{id}/ai-chat` に `{"message": "...", "focusItemNumber": 12}`（`focusItemNumber` は任意）を送ると、AI がそのプロジェクトのアイテムを検索して答えます。AI が読めるのは、呼び出したユーザーが閲覧できるアイテムだけです（ゴミ箱は対象外）。アイテムは書き換えません。履歴は「プロジェクト × ユーザー」ごとで、`GET` で自分の履歴を取得し、`DELETE` で自分の履歴だけを消せます。回答までに数十秒かかることがあります（このリクエストだけ、制限時間は 50 秒）。`ANTHROPIC_API_KEY` が未設定なら `POST` は 503 です。

アイテム単位の `/api/items/by-number/{number}/ai-chat` は非推奨です（動きは変えていません）。

## 非規範の curl 例

ローカル（`http://127.0.0.1:4200`）。本番では nginx の Basic が前段に掛かることがあります（アプリの Cookie セッションとは別）。CLI では **`-u login:password`（アプリの users）** またはログイン後の `sb_session` Cookie（`-b`）でも認証できます。ブラウザは Cookie のみ。

ステータス変更:

```sh
curl --fail-with-body --request PATCH \
  --header 'Content-Type: application/json' \
  -b 'sb_session=SESSION_ID' \
  --data '{"status":"Doing"}' \
  http://127.0.0.1:4200/api/items/by-number/7/status
```

対応者:

```sh
curl --fail-with-body --request PATCH \
  --header 'Content-Type: application/json' \
  -b 'sb_session=SESSION_ID' \
  --data '{"assignee":"Cursor"}' \
  http://127.0.0.1:4200/api/items/by-number/7/assignee
```

プロジェクトの AI チャット（回答まで待つので `--max-time` を長めに）:

```sh
curl --fail-with-body --max-time 60 --request POST \
  --header 'Content-Type: application/json' \
  -b 'sb_session=SESSION_ID' \
  --data '{"message":"期限が近いアイテムは？"}' \
  http://127.0.0.1:4200/api/projects/1/ai-chat
```

詳細は OpenAPI の各 operation を参照してください。
