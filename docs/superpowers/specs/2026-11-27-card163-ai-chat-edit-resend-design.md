# AIチャット直前メッセージの編集・やり直し（#163）設計

## 背景

カード #163:

> ChatGPTなどと同様に、直前にユーザーが送ったメッセージを編集して再送信できるようにする。
>
> - 直前のユーザーメッセージに「編集」ボタンを表示する
> - 編集中は元のメッセージを入力欄に読み込み、キャンセルと再送信を選べるようにする
> - 再送信したら、その後の会話（古い返答）を置き換え、編集後の内容でAIに送り直す
> - 編集・やり直しの後も、返答が来たときの自動スクロールや入力欄の位置が崩れないことを確認する

現状: POST `/api/projects/{id}/ai-chat` は追記のみ。edit/resend 専用 API は無い。

## 決めたこと（推奨採用）

| 論点 | 採用 | 捨てた案 |
| --- | --- | --- |
| API 形 | 既存 POST に任意の `replaceFromMessageId`（正の整数）を足す | 別 PATCH ＋ 別 POST |
| 対象メッセージ | 表示中会話の、時系列で**最後の user**メッセージだけ | 任意の過去メッセージ |
| 失敗時の履歴 | **モデル失敗・保存失敗では DB を変えない**。truncate は成功保存と同一トランザクション。モデル入力はメモリ上で `id < replaceFromMessageId` の履歴だけ渡す | モデル呼び出し前に DELETE（失敗で履歴消失） |
| conversation | `replaceFromMessageId` 指定時は **`conversationId` 必須**（latest 省略不可）。`newConversation` との併用は 400 | latest 省略可 |
| FE UX | 最後の user に「編集」。draft 読込＋`editingFromMessageId`。キャンセル／再送信。編集ボタンは `settled` かつ操作可能時のみ。**成功時のみ** editing 解除・draft 空・messages 差替（失敗時は editing/draft/messages 維持。楽観 truncate 禁止＝L-001）。再送信は既存 `send()`（`event.repeat` / `composeInactive`）。編集ボタンは `detail>1` 無視（L-408） | インライン編集。失敗時にローカル履歴を先に消す |
| スクロール | stick on は既存 `send()` 開始の `stickAndScroll` のみ。`showConversation` / ID 割当は stick を触らない（L-1250）。編集開始では stick 強制なし。AC4 の「成功後も崩れない」＝送信開始の stick 経路が退行しないこと | 成功／ID 割当で stick 再有効化 |
| OpenAPI | POST body と 400 条件を契約に書く（update-api-doc） | Doc 後回し |

### `replaceFromMessageId` の契約

| 条件 | 応答 |
| --- | --- |
| 未指定 | 既存どおり追記送信 |
| `newConversation: true` と同時 | 400 |
| `conversationId` 無し | 400 |
| メッセージが無い／他ユーザー／他会話／role≠user | 400 |
| 同一会話にそれより新しい user がある（直前でない） | 400 |
| 成功 | 200。当該 id **以上**を削除したうえで新 user＋新 assistant を Append。応答 `messages` は残存＋新ターン |

### バックエンド手順（POST）

1. decode / scope / resolve conversation（replace 時は conversationId で解決済みであること）。
2. `replaceFromMessageId` があれば検証（上記）。まだ DELETE しない。
3. history 読込後、replace 時は `id < replaceFromMessageId` だけをモデル入力にする。
4. admit → モデル呼び出し（失敗なら既存どおり、DB 不変）。
5. 保存: **1 トランザクション**で `DELETE … WHERE conversation_id=? AND id >= ?` → Insert 新ターン（proposals CASCADE 削除）。
6. 応答は既存形。

### フロント手順

1. `lastEditableUserMessage`: 末尾から最初の user。表示条件: settled かつ compose 操作可能（`!composeInactive()`、ただし編集中の再送信は composeInactive の sending を除く通常ルールに従う）。
2. `startEdit` / `cancelEdit` / `send` で `replaceFromMessageId` を付与。`send` 成功時のみ editing 解除。
3. 会話切替・`startNew` で editing 解除。
4. 編集ボタン `(click)` は `event.detail > 1` なら無視。再送信は既存 Enter/`composeInactive` ガードを流用。

## 受け入れ条件

1. 直前の user にだけ「編集」が出る。送信中・未 settled・credits block 等では出ない。
2. 編集→キャンセルで draft が消え、サーバ履歴は変わらない。
3. 編集→再送信成功で、当該 user 以降（当該 id 以上）が消え、編集後本文の新 user＋新 assistant が付く。モデル失敗時は履歴が消えない。
4. 再送信は送信開始時の既存 stick 経路が効く（成功／ID 割当で stick を触らない）。編集開始だけでは list を強制スクロールしない。
5. BE/FE テストと OpenAPI が `replaceFromMessageId` と 400 条件を固定する。

## 範囲外

- 任意の過去ターンの枝分かれ編集。
- ストリーミング中の編集。
- 編集確認ダイアログ。

## 今回パック（知見）

`L-001`, `L-058`, `L-157`, `L-408`, `L-824`, `L-1250`, `L-1251`, `L-1252`, `L-792`

## 実装で触る主なファイル（予定）

- `backend/internal/kanban/ai_project_chat_post.go`、truncate／保存の repo
- `docs/openapi.yaml`
- `frontend/src/app/api.ts`, `project-ai-chat.ts/html/css`, specs
