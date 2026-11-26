# AI の履歴を会話ごとに保存し、選んで見たり続けたりできるようにする（#149）設計

## 背景

カード #149 は「AI の履歴を保存できるようにする。過去の AI とのやりとりの履歴を持てるようにして、選択したらその内容を見れたり、続きのチャットをできるようにする」。

いま（#146・#148 の後）の AI チャットは、プロジェクト × ユーザーごとに **1 本の履歴** を持つ。

- テーブルは `project_ai_messages(project_id, user_id, role, body, …)`。200 件を超えた分は古い順に消える。
- API は `GET / POST / DELETE /api/projects/{id}/ai-chat`。`DELETE` は履歴を全部消す。
- 画面は `ProjectAiChat`（右のドックと、専用画面 `/ai-chat`）。「履歴をクリア」で全部消える。

このため、話題を変えたいときは、履歴を消すか、同じ 1 本に続けるしかない。前の話題のやりとりを残したまま新しい話を始めること、前の話題に戻って続けることができない。

## 決めたこと

確認が要る選択は無いと判断し、次のとおりに決めた（推奨案）。

- **履歴を「会話」の単位に分ける。** 会話は、プロジェクト × ユーザーに属する。会話の一覧から選ぶと、そのやりとりが表示され、続きを送れる。「新しい会話」で、前の会話を残したまま新しく始められる。
- **開いたときは、いちばん新しい会話を表示する。** 続きをそのまま送れる（いまの使い勝手を保つ）。会話が 1 つも無ければ、空の新しい会話。「いちばん新しい」は、この文書を通して、一覧の先頭（`updated_at` の降順、同じなら `id` の降順）のこと。
- **会話のタイトルは、最初のメッセージから自動で付ける。** 空白の並びを 1 つの空白にし、先頭の 40 文字（超えたら末尾に「…」）。名前の変更は範囲外。
- **会話は、最初のやりとりが保存されたときに作る。** 「新しい会話」を押しただけでは、サーバーには何も作らない（空の会話が溜まらない）。
- **上限。** 会話はプロジェクト × ユーザーごとに 100 件まで。会話を作った後で 100 件を超えていたら、超えた分を、更新が古い順に全部消す（いま作ったもの以外）。1 つの会話のメッセージは 200 件まで（いまと同じ。超えた分は古い順に消す）。
- **これまでの履歴は、1 つの会話として引き継ぐ。** 起動時の初期化で、会話に属していないメッセージを、プロジェクト × ユーザーごとに 1 つの会話にまとめる。

### データ

新しいテーブルと、既存のテーブルへの列の追加。どちらも `database/init/001_schema.sql` と、起動時の `InitializeProjectAIChat`（冪等）に入れる。

```sql
CREATE TABLE IF NOT EXISTS project_ai_conversations (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  title VARCHAR(120) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_project_ai_conversation_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_ai_conversation_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX project_ai_conversations_scope (project_id, user_id, updated_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
```

- `project_ai_messages` に、次の 3 つを足す。
  - 列 `conversation_id BIGINT NULL`
  - 索引 `project_ai_messages_conversation (conversation_id, created_at, id)`
  - 外部キー `fk_project_ai_message_conversation`（`conversation_id` → `project_ai_conversations(id)`、`ON DELETE CASCADE`）
- `001_schema.sql` では、`project_ai_conversations` を `project_ai_messages` より前に置き、3 つを `project_ai_messages` の `CREATE TABLE` の定義に入れる。
- 起動時（`InitializeProjectAIChat`）は、全体を `GET_LOCK('scrumboard_project_ai_conversations_migrate', 30)` で囲んで（既存の `sprint_migrate.go` と同じ形。本番は最大 2 インスタンスが同時に起動しうる）、次の順に行う。どれも `TABLE_SCHEMA = DATABASE()` の `information_schema` で有無を確かめ、あれば何もしない。
  1. `project_ai_conversations` の `CREATE TABLE IF NOT EXISTS`
  2. `project_ai_messages` の `CREATE TABLE IF NOT EXISTS`（新しい定義。既存のテーブルには効かない）
  3. 列（`COLUMNS` で確かめる。既存の `ensureAIUsageLimitTokensColumn` と同じやり方）
  4. 索引（`STATISTICS` で確かめる。既存の `card_position.go` と同じやり方）
  5. 外部キー（`TABLE_CONSTRAINTS` を `CONSTRAINT_NAME` で確かめる。既存の `item_acl_migrate.go` と同じやり方）。索引を先に足すので、MySQL が外部キー用の索引を別に作らず、新しく作ったテーブルと同じ形になる。
  6. 引き継ぎ（下）
  7. 空の会話の掃除（下）
- `updated_at` は、やりとりを保存するたびに、その時刻にする（アプリが書く。`ON UPDATE` は使わない）。一覧の並びに使う。
- **列は NULL を許したままにする。** 入れ替えの途中（古い版のサーバーがまだ動いている間）に、古い版が `conversation_id` なしでメッセージを足すことがある。その行は、次の起動時の引き継ぎで会話にまとめられる。新しい版のコードは、必ず `conversation_id` を付けて書き、読むときは `conversation_id` で絞る（NULL の行は、引き継がれるまでどの会話にも出ない）。
- **引き継ぎ（起動のたびに実行、冪等）。** `conversation_id IS NULL` のメッセージを、`(project_id, user_id)` ごとに 1 つのトランザクションで処理する。会話を 1 件作り（タイトルは、その中の最初の `user` のメッセージから。無ければ「これまでの会話」。`created_at` は最初のメッセージの時刻、`updated_at` は最後のメッセージの時刻）、その組の NULL の行すべてに `conversation_id` を付ける。NULL の行が無ければ何もしない。会話を作った後の UPDATE が 0 行だったら（ほかの実行が先に引き継いだ）、そのトランザクションは巻き戻す（空の会話を残さない）。途中で失敗したら、その組は巻き戻る。失敗がロックの競合（デッドロック 1213、ロック待ちの時間切れ 1205）なら、その組をやり直し（全部で 3 回まで）、それ以外の失敗と、やり直しても競合が続いたときは、起動は失敗する（次の起動でやり直せる）。引き継ぎでは 100 件の上限の刈り込みをしない（すでに 100 件ある組では、一時的に 101 件になる。一覧は `LIMIT 100` で、次に会話を作るときに 100 件に戻る）。メッセージの ID と `created_at` は変えない。
- **空の会話の掃除（起動のたびに実行、冪等）。** メッセージが 1 件も無い会話を消す。新しい版は会話とメッセージを同じトランザクションで作るので、空の会話は、下の「古い版のクリア」でしか生まれない。動いているサーバーが保存している途中（未コミット）の会話は、その行のロックが外れるまで待ってから判定するので、消さない。待つ間にロックの競合（1213・1205）になったら、引き継ぎと同じ規則でやり直す。
- プロジェクトやユーザーが消えたときは、外部キーで会話とメッセージも消える。

### 入れ替えの途中と巻き戻し

デプロイの間は、古い版と新しい版のサーバーが同時に動く。新しい版から古い版へ戻すこともある。古い版が新しいスキーマの上で動いたときの動きは次のとおりで、どれも受け入れる（データの形は壊れず、次に新しい版が起動したときに整う）。

- **読み取り。** 古い版は `project_id + user_id` で読むので、全部の会話が 1 本に混ざって出る。失うものは無い。
- **送信。** 古い版は `conversation_id` なしでメッセージを足す。その行は、新しい版の次の起動時の引き継ぎまで、新しい版ではどの会話にも出ない。また、古い版は、組の全体で 200 件に刈り込むので、会話をまたいで古いメッセージが消えることがある（合計が 198 件を超えている組だけ）。
- **「履歴をクリア」。** 古い版はメッセージだけを消し、会話の行を残す。残った空の会話は、新しい版の次の起動時の掃除で消える。それまでは、タイトルだけの空の会話が一覧に出ることがある。
- 列は NULL を許し、外部キーは NULL の行に効かないので、古い版の書き込みは失敗しない。
- **新しい画面から古い版への送信。** 新しい画面は、送信に必ず `conversationId` か `newConversation` を付ける。古い版は、本文の未知のフィールドを 400（「入力を確認してください。有効なJSONが必要です。」）にするので、入れ替えの途中に古い版へ届いた送信は 400 になる。本文の検査は、回数制限とモデルの呼び出しより前なので、回数も費用も使わない。画面は下書きを残して文言を出すので、送り直せば、新しい版に届いた時点で通る。古い版がいなくなれば起きない（巻き戻したときは、古い画面が配られるまで続く）。

### API

`{id}` はプロジェクト ID、`{cid}` は会話 ID（正の整数。数値でない・0 以下は 400「会話IDが不正です。」）。どれもログインが必要（未ログインは既存のミドルウェアが 401）。プロジェクト ID の検査は、既存の `projectChatScope` と同じ（不正は 400、無ければ 404）。

会話は、**呼び出したユーザー自身の、そのプロジェクトのもの** だけが対象。無い・別のユーザーのもの・別のプロジェクトのもの、は区別せず、どれも 404 `{"message":"会話が見つかりません。"}` にする（存在を漏らさない）。リポジトリの `ErrNotFound` を既存の `fail` にそのまま渡すと「アイテムが見つかりません。」になるので、`failProject` と同じ形の、会話用の関数で 404 に変える。

- `GET /api/projects/{id}/ai-conversations` → `200 {"conversations": ProjectAIConversation[]}`。更新が新しい順（同じ時刻は ID の大きい順）。最大 100 件。メッセージは含めない。
- `GET /api/projects/{id}/ai-conversations/{cid}` → `200 {"conversation": ProjectAIConversation, "messages": ProjectAIMessage[]}`（メッセージは古い順）。
- `DELETE /api/projects/{id}/ai-conversations/{cid}` → `204`。その会話とメッセージを消す。
- `POST /api/projects/{id}/ai-chat` — 本文に `conversationId?: number` を足す。
  - 省略（または `null`）: いちばん新しい会話に続ける。会話が 1 つも無ければ、新しく作る。これまでの API の意味（1 本の履歴に続ける）を保つ。デプロイの前から開いたままの古い画面は `conversationId` を送らないので、こうしておけば、1 通ごとに別の会話に分かれない。
  - `"newConversation": true`: 新しい会話を作って、そこに保存する。`conversationId` と一緒に指定したら 400「conversationId と newConversation は同時に指定できません。」。
  - 指定: その会話に続ける。0 以下は、本文の検査（`decodeProjectChatRequest`）で 400「会話IDが不正です。」。整数でない値は、既存の `decode` の 400（文言は既存のまま）。会話が見つからなければ 404（プロジェクトの検査の直後、503 `ai_not_configured` より前。モデルは呼ばない）。
  - 応答は `200 {"conversation": ProjectAIConversation, "assistant": ProjectAIMessage, "messages": ProjectAIMessage[]}`。`messages` は、その会話の全部。
  - モデルに渡す履歴は、**保存先の会話の** 直近の `AI_CHAT_HISTORY_TURNS` 往復。新しい会話なら履歴なし。どの会話に保存するか（指定・いちばん新しい・新規）は、モデルを呼ぶ前に決め、履歴の読み込みと保存で同じ会話を使う。
- `GET /api/projects/{id}/ai-chat` → `200 {"conversation": ProjectAIConversation | null, "messages": ProjectAIMessage[]}`。いちばん新しい会話とそのメッセージ。会話が無ければ `conversation: null`、`messages: []`。画面を開いたときの最初の表示に使う（これまでは 1 本の履歴を返していた。`messages` の形は同じ）。
- `DELETE /api/projects/{id}/ai-chat` → `204`。呼び出したユーザーの、そのプロジェクトの会話を全部消す（これまでと同じ意味）。

型:

- `ProjectAIConversation` = `{id, projectId, title, createdAt, updatedAt}`。
- `ProjectAIMessage` に `conversationId` を足す（ほかは同じ）。

### 保存の流れ

- リポジトリの関数（`Repository`、`MySQLRepository`、テスト用の `memoryRepo`。署名が変わるので、`backend/cmd/server/wiring_test.go` の `smallRepo` と `projectChatRepo` も合わせる）。
  - `ListProjectAIConversations(ctx, projectID, userID) ([]ProjectAIConversation, error)`
  - `GetProjectAIConversation(ctx, projectID, userID, conversationID) (ProjectAIConversation, error)` — 無ければ `ErrNotFound`。
  - `LatestProjectAIConversation(ctx, projectID, userID) (*ProjectAIConversation, error)` — 無ければ `nil`。
  - `ListProjectAIMessages(ctx, projectID, userID, conversationID)` — いまの関数に会話 ID を足す。必ず 3 つで絞る。
  - `AppendProjectAITurn(ctx, projectID, userID, conversationID *int64, turn ProjectAITurn) (ProjectAIConversation, error)` — `ProjectAITurn` は 1 回のやりとり（`Title`、`UserBody`、`AssistantBody`、`InputTokens`、`OutputTokens`。`Title` は、新しく会話を作るときだけ使う）。1 つのトランザクションで、次を行う。最初に、会話の行を `SELECT … WHERE id=? AND project_id=? AND user_id=? FOR UPDATE` で読む。行があれば、その間の削除は待たされ（確認と INSERT の間に消されて外部キーの違反になる、を防ぐ）、同じ会話への同時の保存も直列になる。行が無ければ、新しく作る。
    1. `conversationID` が `nil`、または、その会話がもう無い（モデルを待つ間に消された）なら、会話を作る（`title` を使う）。作った後で 100 件を超えていたら、超えた分を、更新が古い順に全部消す（いま作ったもの以外）。
    2. 足す 2 件を含めて 200 件に収まるように、その会話のメッセージを古い順に消す（いまと同じ計算）。
    3. ユーザーのメッセージと回答を足し、会話の `updated_at` をいまの時刻にする。
    4. 保存した会話を返す。
  - `DeleteProjectAIConversation(ctx, projectID, userID, conversationID) error` — 無ければ `ErrNotFound`。
  - `ClearProjectAIConversations(ctx, projectID, userID)` — そのユーザーの、そのプロジェクトの会話を全部消す（会話に属していない古い行も消す）。
- モデルを待つ間に会話が消されても、支払った回答は捨てない。新しい会話として保存する（上の 1）。
- 保存の後の読み直しに失敗したときの代替の応答（既存の `unstoredProjectChatTurn`）には、保存で返った `conversation` を入れる。代替の 2 件（質問と回答）の `conversationId` も、返った会話の ID にする。返った会話の ID が、送られた `conversationId` と違う（新しく作られた）ときは、前の履歴（`before`）を付けずに、その 2 件だけを返す（消された会話のメッセージを、新しい会話のものとして返さない）。
- タイトルを作る純粋な関数 `projectAIConversationTitle(message string) string`（空白の並びを 1 つの空白に、前後の空白を除く、40 文字を超えたら 40 文字 + 「…」、空なら「新しい会話」）。

### 画面

`ProjectAiChat`（ドックと専用画面で共通）を、会話を扱えるようにする。

- **見出しの操作。** 「新しい会話」「履歴」「この会話を削除」。いまの「履歴をクリア」は「この会話を削除」に置き換える（消すのは表示中の会話だけ。確認の文言は「この会話を削除しますか？」）。保存されていない新しい会話では、削除は押せない。
- **履歴の一覧。** 会話のタイトルと、最後に更新した日時を、新しい順に並べる。表示中の会話には `aria-current="true"` を付ける。行を押すとその会話を開く。各行に「削除」（確認あり）。
  - ドック（`layout="dock"`）: 「履歴」を押すと、メッセージの欄の代わりに一覧を出す（もう一度押すか、会話を選ぶと戻る）。
  - 専用画面（`layout="page"`）: 幅が 768px 以上なら、一覧を左の列に常に出す。それより狭ければ、ドックと同じ切り替え。
- **状態。** `conversationId: number | null`（`null` は、まだ保存されていない新しい会話）、`messages`、`conversations`。
  - 開いたとき（`projectId`・ログイン中のユーザーが変わったときも）: `GET …/ai-chat`（いちばん新しい会話）と、`GET …/ai-conversations`（一覧）を読む。
  - 「新しい会話」: `conversationId` を `null`、`messages` を空にし、入力欄へフォーカスを移す。サーバーは呼ばない。
  - 会話を選ぶ: `GET …/ai-conversations/{cid}` を読み、成功したら表示を切り替える。404 なら、一覧を読み直して「会話が見つかりません。」を出す。
  - 送信: `conversationId` があれば付け、無ければ（新しい会話）`newConversation: true` を付ける。応答の `conversation` と `messages` で表示を更新する。一覧は、応答の `conversation.id` が送った会話 ID と同じなら、手元でその会話を先頭に置く。違うとき（新しい会話、または、待つ間に送った先が消されて新しく作られた）は、手元で書き換えずに一覧を読み直す（サーバーが、上限を超えた会話や送った先の会話を消しているため）。
  - 削除: 成功したら一覧から外す。表示中の会話を消したときは、新しい会話（空）にする。404（別のタブなどで既に消えていた）も、成功と同じ扱いにする。
  - 送信が 404（表示中の会話が、別のタブでの削除や上限の刈り込みで消えていた）のとき: 一覧を読み直し、下書きを残したまま新しい会話（`conversationId = null`）に切り替えて、「この会話は見つかりませんでした。新しい会話として送り直せます。」を出す。
- **一覧の 3 つの状態。** 読み込み中（「読み込み中…」）、失敗（文言と「再読み込み」）、読めた。「会話はまだありません。」は、読めて 0 件のときだけ出す（初期値の空の配列のまま出さない）。
- **会話の切り替えの失敗（404 以外）。** 前の会話を表示したまま、`error` に文言を出す（入力欄ごと隠す `loadError` は、最初の読み込みの失敗だけに使う）。
- **表示中の会話が決まっていない間は送れない。** 最初の読み込み中、その失敗の後、会話の切り替え中は、入力欄を無効にする（読み込みの前に送って、意図しない会話に入るのを防ぐ）。
- **一覧の応答の順序。** 送信の応答で一覧を更新した後に、それより前に始めた一覧の読み込みが返っても、古い一覧で上書きしない（一覧の読み込みにも世代を持ち、送信の応答で世代を進める）。
- **送信中・読み込み中は、会話の切り替え・新しい会話・削除を押せなくする。** 応答が別の会話の表示に入るのを防ぐ。あわせて、送信の応答を反映する条件に、会話の検査を新しく足す: 「送ったときの `conversationId`」と「いま表示中の `conversationId`」が同じときだけ反映する（比べるのは応答の `conversation.id` ではない。新しい会話や、消された会話への送信では、応答の ID は送った ID と違う）。この検査は、送信だけに重ねる別の純粋な関数（例: `sameConversation(sent, current)`）にする。既存の `ChatScope` / `sameChatScope` には `conversationId` を足さない（クレジット・一覧・読み込みも同じ検査を使っているので、足すと、最初の読み込みで会話が決まった後に返る応答が捨てられ、入力欄が無効のまま固まる）。会話が違って応答を捨てるときも、`sending` は必ず戻す。
- 古い応答を捨てる規則（`projectId`・ユーザーの `generation`）は、会話の一覧・会話の読み込みにも同じように掛ける。
- **ドックから専用画面へ。** 「全画面」で `/ai-chat?project=…&conversation=<表示中の会話の ID>` へ移る。保存されていない新しい会話のときは `conversation=new` を付ける（付けないと「指定なし」と区別できず、専用画面に別の会話が出て、意図しない会話に続けてしまう）。専用画面は、`conversation` が ID ならその会話、`new` なら空の新しい会話、無ければいちばん新しい会話を開く。このために、`ProjectAiChat` に入力 `initialConversationId`（`number | 'new' | null`）と、出力 `conversationChange`（表示中の会話が変わるたび。値は ID か `'new'`）、出力 `sendingChange`（送信中かどうか）を足す。
  - `conversationChange` は、最初の読み込みが終わるまで出さない（読み込みの前の状態で URL の `conversation` を消さない）。
  - **送信中は「全画面」を押せなくする**（`AiChatFab` が `sendingChange` を見る）。送信中に移ると、ドックが破棄されて応答が捨てられ、専用画面に回答の無い会話や別の会話が出るため。`AiChatFab` が持つ「送信中」と「表示中の会話」は、チャットの部品が無くなったとき（パネルを閉じたときだけでなく、開いたまま入口が消えたとき）と、プロジェクトが変わったときに捨てる。
  - `initialConversationId` が `'new'` なら、**最初の読み込みだけ**、会話は読まずに空の新しい会話にする（一覧は読む）。正の整数なら、**最初の読み込みだけ**、`GET …/ai-chat` の代わりに `GET …/ai-conversations/{cid}` を読む。404 なら `GET …/ai-chat`（いちばん新しい会話）に落ちる。それ以外の失敗（500、通信の失敗）は、既存の読み込みの失敗（`loadError` と「再読み込み」）と同じ扱い。不正な値（数値でない、0 以下）は、無いものとして扱う。
  - `projectId`・ユーザーが変わった後の読み直しでは、`initialConversationId` を使わない（いちばん新しい会話を読む）。
  - 専用画面は、`conversationChange` を受けたら、URL の `conversation` を書き換える（`replaceUrl`、`queryParamsHandling: 'merge'` で `project` を保つ。新しい会話では `conversation=new`）。再読み込みしても、同じ会話が開く。
- `Api`: `listProjectAIConversations(projectId)`、`getProjectAIConversation(projectId, conversationId)`、`deleteProjectAIConversation(projectId, conversationId)` を足す。`getLatestProjectAIChat` は `{conversation, messages}` を返す形に、`postProjectAIChat` は `conversationId` を受け取り `conversation` を返す形にする。`clearProjectAIChat` は、画面から使わなくなるので消す。
- 判定（一覧の更新、タイトルと日時の表示、押せるかどうか）は、純粋な関数（`project-ai-chat-rules.ts` か新しい `project-ai-conversations.ts`）に置き、部品はイベントと API の呼び出しだけを持つ。

### 文書

`docs/openapi.yaml`（新しい 3 操作、`POST` の `conversationId` と応答、`GET …/ai-chat` の応答、スキーマ）、`docs/api.md`、`docs/ai-ops-limits.md`（会話 100 件・メッセージ 200 件の上限）。

## 実装で決めたこと（設計との差）

- **起動時のロックは、1 本の接続で取って返す。** 名前付きロック（`GET_LOCK`）は接続に属するので、プール越しに呼ぶと排他にならない。`r.DB.Conn()` の 1 本の接続で、ロック・7 つの手順・解放を全部行う（`sprint_migrate.go` はプール越しに呼んでいて、同じ理由で排他になっていない可能性が高い。そちらは今回の範囲外）。解放に失敗したら、その接続は捨てる。待ち時間は、内部の関数（`initializeProjectAIChat(ctx, lockWaitSeconds)`）の引数にして、テストから短くできる（本番は 30 秒のまま）。待ち時間が過ぎたら（`GET_LOCK` が 0）、`errProjectAIChatMigrateLockBusy` で失敗し、テーブルに触らない。
- **`conversation_id` は末尾の列にする。** `ADD COLUMN` は末尾に足すので、`001_schema.sql` と起動時の DDL でも `created_at` の後に置き、新しく作ったテーブルと移行したテーブルの形（`SHOW CREATE TABLE`）を一致させる。
- **`updated_at` は、UPDATE 文で `CURRENT_TIMESTAMP(6)` を書く。** メッセージの `created_at` と同じ MySQL の時計なので、引き継ぎの「最後のメッセージの時刻」とも揃う。
- **`AppendProjectAITurn` は、デッドロック（1213）とロック待ちの時間切れ（1205）のとき、最大 3 回やり直す。** 支払った回答を、ロックの競合で失わないため。やり直しの判定と繰り返し（`projectAILockRetry`、`retryProjectAILockRace`。`ai_project_lock_retry.go`）は、起動時の引き継ぎ（組ごとのトランザクション）と空の会話の掃除でも使う。動いているサーバーの保存と競合しても、起動を失敗させないため。
- **会話の経路の検査の順序は、プロジェクト（400／404）→ 会話 ID（400）→ 会話（404）。**
- **`conversationId` と `"newConversation": false` の組み合わせは、ID の指定として通す。** `"conversationId": null` は省略と同じ。
- **画面: 一覧をまだ読めていないとき（読み込み中・失敗）は、送信や削除の後に手元の配列を書き換えず、一覧を読み直す。** 欠けた一覧を「読めた」として出さないため。読めているときは、設計どおり手元で更新する。
- **画面: 最初の読み込みが失敗した後は、「再読み込み」が成功するまで、「新しい会話」・切り替え・削除も押せない**（「表示中の会話が決まっていない」を 1 つの状態として扱う）。削除中は送信もできない。
- **画面: `GET …/ai-chat` が `conversation` なしでメッセージだけを返したとき**（入れ替えの途中の古い版のサーバー）は、メッセージを出さずに、空の新しい会話として扱う。
- **画面: 最初の読み込みの「再読み込み」は、`initialConversationId` の会話をもう一度読む**（「最初の読み込みだけ」を、成功するまで、と解釈する）。
- **画面: 専用画面を `conversation` なしで開くと、読み込みの後に URL が `conversation=<ID>` に書き換わる**（履歴は増えない）。ドックで「履歴」を開いている間も、入力欄とエラーの文言は出したままにする。幅の判定は `matchMedia('(min-width: 768px)')` で、窓の幅の変化に追従する。
- **引き継ぎは、起動のたびに、会話に属していない行を組ごとに新しい会話 1 件にまとめる。** 入れ替えの途中に古い版が足した行は、既存の会話には足されず、別の会話になる。
- **画面: ドックの「送信中」と「表示中の会話」は、チャットの部品と寿命を揃える。** 破棄される部品は `sendingChange(false)` を出さず、作り直された部品は最初から送信中でないので出さない。このため、`AiChatFab` は、入口の有無（`showEntry`）とプロジェクト（`projectId`）を見る effect で、変わるたびに 2 つを初期値に戻す。ボードで送信中にカードを開いても（パネルは開いたまま、チャットは作り直される）、「全画面」は押せ、前の会話の ID は専用画面に渡らない。effect は、チャットを生成するテンプレートより前に走るので、新しいチャットが伝えた値は消えない。
- **画面: 送信の応答が、送った会話と違う会話を返したら、一覧を読み直す。** 判定は純粋な関数 `storedInSentConversation(sent, stored)`。100 件あるときに新しい会話を送ると、サーバーはいちばん古い会話を消す。手元で先頭に足すだけでは、消えた会話が残って 101 件になる。読み直す間、一覧は「読み込み中…」になる。
- **画面: いちばん新しい会話を読む `Api` の関数は、`getLatestProjectAIChat` という名前にする（#146 のときの名前は `listProjectAIChat`）。** 返すのは一覧ではなく、いちばん新しい会話 1 件とそのやりとりで、`listProjectAIConversations`（会話の一覧）と紛らわしいため。経路（`GET …/ai-chat`）と返す形は、上の「画面」の節のとおり。
- **画面: 一覧の読み込み・世代・手元の書き換えは `ProjectAiConversationList` が持ち、スコープ（projectId・ユーザー）の検査は呼び出す側が渡す。** `ProjectAiChat` は、応答を反映してよいか（読み込みを始めたときと同じプロジェクト・ユーザーか）を判定する関数を渡すだけで、一覧の状態は持たない。
- **`DELETE …/ai-chat` のリポジトリの関数は、`ClearProjectAIConversations` という名前にする（#146 のときの名前は `ClearProjectAIMessages`）。** 消すのはメッセージだけでなく、会話の全部であるため。

## 受け入れ条件

1. `POST …/ai-chat` を `"newConversation": true` で送ると、新しい会話ができ、応答に `conversation` が入る。タイトルは最初のメッセージから作られる。どちらも付けずに送ると、いちばん新しい会話に続き、会話が無ければ新しく作られる。両方を付けると 400。
2. `conversationId` を付けて送ると、その会話に続き、モデルにはその会話の履歴だけが渡る（ほかの会話の履歴は渡らない）。
3. 会話の一覧は、呼び出したユーザーの、そのプロジェクトのものだけで、更新の新しい順。
4. 別のユーザー・別のプロジェクトの会話 ID は、取得・削除・続きの送信のどれでも 404 で、存在しない ID と同じ応答。
5. 会話の削除で、その会話のメッセージも消える。ほかの会話は残る。`DELETE …/ai-chat` は、自分のそのプロジェクトの会話を全部消す。
6. 101 件目の会話を作ると、更新がいちばん古い会話が消える。1 つの会話のメッセージは 200 件を超えない。
7. モデルを待つ間に会話が消されても、回答は新しい会話として保存される。会話の確認と保存の間に削除が割り込んでも、保存は失敗しない（MySQL のテストで固定）。
8. 起動時の引き継ぎ: 会話に属していないメッセージが、プロジェクト × ユーザーごとに 1 つの会話になる。2 回実行しても増えない。列・制約・索引の追加は、既にあれば何もしない。
9. `GET …/ai-chat` は、いちばん新しい会話とそのメッセージを返す。無ければ `conversation: null`。
10. 画面: 開くと、いちばん新しい会話が出て、続きを送れる。「新しい会話」で空になり、送ると一覧の先頭に新しい会話が増える。
11. 画面: 一覧から会話を選ぶと、そのやりとりが出て、続きを送れる。会話を削除できる。表示中の会話を消すと、空の新しい会話になる。
12. 画面: 送信中・読み込み中は、切り替え・新しい会話・削除が押せない。
13. 画面: ドックの「全画面」で、同じ会話が専用画面に出る。
14. 起動時の初期化を並行して 2 回実行しても、会話は組ごとに 1 件で、空の会話が残らない。メッセージの無い会話は、起動時に消える。
15. 画面: 最初の読み込みの後にクレジットと一覧が返っても反映され、入力欄が使える。表示中の会話が決まるまでは送れない。
16. 画面: 表示中の会話が外で消えていたとき、送信は新しい会話への切り替え（下書きは残る）になり、削除は成功と同じ扱いになる。
17. 画面: 一覧は、読み込み中・失敗・0 件を区別して出す。会話の切り替えに失敗（404 以外）しても、前の会話が残る。
18. 画面: 新しい会話のまま「全画面」にすると、専用画面も空の新しい会話になる。送信中は「全画面」を押せない。専用画面で会話を切り替えると URL の `conversation` が変わり、`project` は保たれる。
19. 既存のプロジェクトのチャットのテスト（権限、ツール、上限、失敗の扱い）は、会話の引数を足したうえで通る。

## 範囲外

- 会話の名前の変更、検索、ピン留め、並べ替え。
- 会話の一覧のページ送り（100 件まで）。
- 会話をほかのメンバーと共有すること（履歴は自分のものだけ）。
- アイテム単位の API と `item_ai_messages` の削除。
- `conversation_id` を NOT NULL にすること（入れ替えの途中の行を引き継ぐため、NULL を許したままにする）。

## 気をつける知見

レビュー（2 周）で確かめた項目。

- L-001（操作の結果を見て後続を決める）: 保存した会話を返す。画面は、送信と削除の 404 の後続を決めている。
- L-002（「無い」「失敗」を「空」として扱わない）: URL の `conversation` の「指定なし」と `new` を分ける。一覧は、読み込み中・失敗・0 件を分ける。
- L-023（同じ事実が複数の場所にあるとき、片方だけ検証しない）: 持ち主（`project_id`・`user_id`）は、会話の行とメッセージの行の両方にある。メッセージの INSERT では会話の行と同じ値を書き、読み取りと削除は、会話 ID・プロジェクト・ユーザーの 3 つで絞る。保存のトランザクションの中は、ロックした（または、いま作った）会話の ID で絞る（`trimProjectAIMessages`、`touchProjectAIConversation`。その ID は、同じトランザクションで `lockProjectAIConversation` が持ち主を確かめたか、いま作ったもの）。
- L-456（既存データの移行で ID や作成日時を作り直さない）: メッセージの ID と `created_at` は変えない。会話の時刻は、最初と最後のメッセージの時刻。
- L-571（非同期の前後でのユーザー・世代の検査）: 一覧と会話の読み込みにも `generation` を掛ける。会話の検査は送信だけに重ねる。
- L-669（読み込みの完了前の保存）: 表示中の会話が決まるまで送れない。
- L-1198（dev-flow-kit の `feat/lesson-pack-effectiveness` ブランチ。権限で絞る一覧の件数や打ち切りの印に、見えないものの情報を残さない）: 一覧は、SQL の WHERE で持ち主に絞ってから `LIMIT 100`。無い・他人のもの・別のプロジェクトのものは、同じ 404。
- L-1199（同ブランチ。ツールを使う長いリクエストの、時間・利用量・切断・失敗の扱い）: 会話の 404 はモデルを呼ぶ前。保存は切断から切り離したまま。動きを変えたら、運用の文書と API の仕様も直す。

## 実装プラン

バックエンドとフロントエンドは、上の「API」の節を境に独立して進められる。タスクはこの節にまとめ、別の実装プランの文書は作らない。

1. **バックエンド: データ。** DDL（スキーマと起動時）、列・制約・索引の追加、引き継ぎ。MySQL のテスト（冪等、引き継ぎ、既存の DB から）。
2. **バックエンド: 保存。** リポジトリの関数と `memoryRepo`。上限（100 / 200）、スコープ、消された会話への保存のテスト（メモリと MySQL）。
3. **バックエンド: API。** 3 つの経路、`POST` の `conversationId`、`GET` / `DELETE …/ai-chat` の変更、タイトルの関数。ハンドラーのテスト。
4. **フロントエンド。** `Api`、`ProjectAiChat`（一覧、切り替え、新しい会話、削除）、`AiChatFab` と `AiChatPage`（会話の受け渡し）。テスト。
5. **文書。** OpenAPI、api.md、ai-ops-limits.md。
