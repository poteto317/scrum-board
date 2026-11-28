# API 案内（非規範）

**契約の正本は [OpenAPI（`docs/openapi.yaml`）](openapi.yaml) です。** フィールド仕様・ステータスコード・認証要否・バリデーションは OpenAPI を見てください。このファイルは AI／CLI 向けの短い入口だけです。

## by-number と列名 status

画面の `ITEM-007` や `/items/7` は公開タスク番号 `7` です。内部 ID とは別です。生成 AI から列を動かすときは内部 ID の `PATCH /api/items/{id}` を推測で使わず、公開番号の status API を使います。

## アーカイブ

`GET /api/archive?projectId={projectId}` で閲覧可能なプロジェクト別アーカイブを取得します。Done・Close から10日経過したアイテムは毎日 03:30（Asia/Tokyo）に自動アーカイブされ、`POST /api/items/{id}/unarchive?projectId={projectId}` で編集権限のあるユーザーが元の列（Done または Close）に戻せます。自動処理は Cloud Scheduler から `POST /api/archive/auto-archive` を呼び出し、`X-Scheduler-Token` を送信します。

## プロジェクトの AI チャット

`POST /api/projects/{id}/ai-chat` に `{"message": "...", "focusItemNumber": 12}`（`focusItemNumber` は任意）を送ると、AI がそのプロジェクトのアイテムを検索して答えます。AI が読めるのは、呼び出したユーザーが閲覧できるアイテムだけです（ゴミ箱は対象外）。アイテムは書き換えません（書き換えは「提案」として返し、利用者が画面で適用します。下記）。回答までに数十秒かかることがあります（このリクエストだけ、制限時間は 50 秒）。`ANTHROPIC_API_KEY` が未設定なら `POST` は 503 です。

履歴は「プロジェクト × ユーザー」ごとの **会話** に分かれています（自分の会話だけが見えます）。

- `POST` の本文に `"conversationId": 3` を付けると、その会話に続けます。`"newConversation": true` を付けると、新しい会話を作ります（両方は 400）。どちらも付けなければ、いちばん新しい会話に続けます（会話が無ければ作ります）。
- 応答は `{"conversation": {...}, "assistant": {...}, "messages": [...]}` で、`messages` はその会話の全部です。続きを送るときは、応答の `conversation.id` を `conversationId` に使います。
- AI に渡る履歴は、続ける会話のものだけです。会話のタイトルは、最初のメッセージから自動で付きます。
- `GET /api/projects/{id}/ai-chat` は、いちばん新しい会話とそのメッセージ（無ければ `"conversation": null`）。`DELETE /api/projects/{id}/ai-chat` は、自分のそのプロジェクトの会話を全部消します。
- `GET /api/projects/{id}/ai-conversations` は会話の一覧（更新の新しい順、最大 100 件）。`GET` / `DELETE /api/projects/{id}/ai-conversations/{cid}` で、1 つの会話を取得・削除します。
- 自分の会話でない ID（無い・別のユーザーのもの・別のプロジェクトのもの）は、どれも 404「会話が見つかりません。」です。
- 会話は 100 件まで、1 つの会話のメッセージは 200 件までで、超えた分は古い順に消えます。

### 提案（#150）

AI は、頼まれたときに、アイテムの操作を **提案** します。提案はアイテムを変えません。

- 種類は 3 つ: `status_change`（アイテム番号と移動先の列）、`description_edit`（アイテム番号と、置き換え後の説明の全文。提案のときの説明 `baseDescription` も持つ）、`item_create`（タイトルと説明。列は常に Todo）。
- 提案は回答のメッセージの `proposals` に入り、会話と一緒に保存されます（`GET` で読み直しても残ります）。1 回の質問で 5 件まで。
- 提案を作れるのは、呼び出したユーザーが閲覧・編集できる、アーカイブされていない、そのプロジェクトのアイテムだけです。
- 状態は `pending`（未処理）・`applied`（適用済み）・`dismissed`（破棄）。`PATCH /api/projects/{id}/ai-proposals/{pid}` に `{"state": ...}` を送って変えます（遷移は OpenAPI を参照。二重の確保は 409）。
- 画面の適用は、提案を確保（`applied`）してから、既存の `PATCH /api/items/{id}`・`POST /api/items` を利用者の権限で呼び、失敗したら `pending` に戻します。説明の編集は、適用の直前に今の説明が `baseDescription` と違えば適用しません。

アイテム単位の `/api/items/by-number/{number}/ai-chat` は非推奨です（動きは変えていません）。

## 非規範の curl 例

ローカル（`http://127.0.0.1:4200`）。本番では nginx の Basic が前段に掛かることがあります（アプリの Cookie セッションとは別）。CLI では **`-u login:password`（アプリの users）** またはログイン後の `sb_session` Cookie（`-b`）でも認証できます。ブラウザは Cookie のみ。

`-u` の Basic も、ログインと同じく 5 回失敗で 15 分ロックされます（ログイン名ごと・接続元 IP ごと。フォームのログインとは別のカウンタ）。ロック中は、ログインが必要な API では正しいパスワードでも 401 です（公開アイテムの詳細は匿名として返ります）。本番では接続元 IP が全利用者で共通になる場合があります（[SECURITY.md](../SECURITY.md) の既知の制限）。同じ接続元のブラウザがエッジ Basic を `/api/` に送り続けてロックされた場合は、`POST /api/auth/login` で得た `sb_session` Cookie を `-b` で送ってください。

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

会話を指定して続ける・新しい会話を始める・会話の一覧:

```sh
curl --fail-with-body --max-time 60 --request POST \
  --header 'Content-Type: application/json' \
  -b 'sb_session=SESSION_ID' \
  --data '{"message":"その中で担当が未定のものは？","conversationId":3}' \
  http://127.0.0.1:4200/api/projects/1/ai-chat

curl --fail-with-body --max-time 60 --request POST \
  --header 'Content-Type: application/json' \
  -b 'sb_session=SESSION_ID' \
  --data '{"message":"別の話題です","newConversation":true}' \
  http://127.0.0.1:4200/api/projects/1/ai-chat

curl --fail-with-body -b 'sb_session=SESSION_ID' \
  http://127.0.0.1:4200/api/projects/1/ai-conversations
```

詳細は OpenAPI の各 operation を参照してください。
