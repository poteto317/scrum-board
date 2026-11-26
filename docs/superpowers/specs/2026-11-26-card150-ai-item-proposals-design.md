# AI チャットから、アイテムの操作を「提案」し、利用者がボタンで適用できるようにする（#150）設計

## 背景

カード #150 は「AIチャットから、アイテムの操作をできるようにする」。対象は次の 3 つ。

- アイテムのステータス変更
- 説明の編集（どこを置き換えたのかが、差分で分かるようにする。Notion AI のように）
- アイテムを Todo として新規作成

いま（#146・#148・#149 の後）のプロジェクトの AI チャットは、読み取りのツール `search_items` と `get_item` だけを持つ。回答を書き込みに使うのは、アイテム詳細で利用者が「説明に反映」「コメント追加」を押したときだけ。

## 決めたこと

カードで決めてある方針（変えない）と、この設計で推奨案を採用した事項。

### カードで決めてあること

1. **AI は書き込まない。** モデルのツールは「提案」を作るだけ。実際の変更は、利用者が「適用」を押したときに、フロントが既存の API（`PATCH /api/items/{id}`、`POST /api/items`）を利用者自身の権限で呼ぶ。サーバーの権限の検査（`requireActiveEdit` など）が適用のたびに効く。
2. **提案は 3 種類**: ステータスの変更、説明の編集（置き換え後の全文）、アイテムの新規作成（タイトルと説明。**列は Todo に固定**。ツールの入力に列は無い）。
3. **説明の編集は、行単位の差分を見せる**（追加・削除を色分け）。差分の計算は純粋な関数。
4. **古い提案で上書きしない。**
5. **提案の状態を保存する**（未処理・適用済み・破棄）。適用は 1 回だけ。
6. **権限と範囲**は、閲覧できるそのプロジェクトのアイテムだけ。
7. **1 回の質問で作れる提案は 5 件まで。**
8. **画面**: メッセージの下のカード、「適用」「破棄」、結果の表示、キーボード・読み上げ、適用中は無効。ドックと専用画面の両方。
9. **範囲外**: 削除、担当・期限・ソリューション・コメントの変更、一括変更、提案の編集、元に戻す。

### この設計で決めたこと（推奨案を採用）

- **保存は別テーブル `project_ai_proposals`。** 提案は回答のメッセージ（`project_ai_messages` の assistant の行）に外部キーで紐づき、`ON DELETE CASCADE` でメッセージと一緒に消える。`project_ai_messages` に列は足さない。理由: 古い版のサーバーはこのテーブルを知らずに動き（読みも書きもしない）、古い版がメッセージを削る・消すと、提案も外部キーで一緒に消える。新旧が同居しても壊れない。
- **提案の状態の変更は、新しい API `PATCH /api/projects/{id}/ai-proposals/{proposalId}` で行う。** 本体の変更（ステータス・説明・作成）は既存の API のまま。この API は提案の状態だけを書く。
- **適用は「先に確保（claim）してから、既存の API を呼ぶ」。** 二重適用を防ぐため、フロントは既存の API を呼ぶ前に、提案を `pending → applied` にする（条件付き UPDATE。既に `pending` でなければ 409）。既存の API が失敗したら、`applied → pending` に戻して（release）、失敗の理由を出す。新規作成が成功したら、作成したアイテムの番号を記録する。
  - 新規作成で、`POST /api/items` は成功したのに結果を記録する PATCH が失敗した場合は、release しない（`applied` のまま。再適用で二重に作らない）。画面には「#n を作成しました（結果の記録に失敗しました）」と出す。再読み込みすると、作成した番号の無い「適用済み」になる。これも受け入れる。
  - 確保の後、既存の API を呼ぶ前にブラウザが閉じられると、「適用済み」なのに何も変わっていない提案が残る。まれで、害は「適用されなかった」だけなので、受け入れる（PR に書く）。
- **古い提案の扱い（適用の直前に、フロントが `GET /api/items/by-number/{n}` で確かめる）。**
  - 説明の編集: 提案は、作ったときの説明（`baseDescription`）を持つ。現在の説明が `baseDescription` と違えば、適用しない。「提案のあとで説明が変わりました。」と伝え、**最新の説明との差分を出し直す**。この提案は適用できなくなり（ボタンを無効にする）、破棄だけできる。比べるときは、アイテムの説明・`baseDescription` とも、無い（null）を空文字として扱う。`description_edit` の `description`・`base_description` は必ず文字列（空文字を許す）で保存する。
  - ステータスの変更: 既に移動先の列でも、そのまま適用する（既存の API で同じ列への変更になるだけで、害は無い）。
  - どちらも、アイテムが見つからない（削除・権限の変更・ゴミ箱）なら「アイテムが見つかりません。」、アーカイブ済みなら「アーカイブ済みのため変更できません。」、編集できなければ「このアイテムを編集する権限がありません。」を出し、適用しない（状態は `pending` のまま。破棄はできる）。
  - 新規作成: 作るときの Todo の列が無くなっていれば、`POST /api/items` が失敗する。その理由を出し、release する。
  - 確かめるための読み込みが 404 なら「アイテムが見つかりません。」、それ以外の失敗（通信・5xx）なら「アイテムを確認できませんでした。もう一度お試しください。」とし、どちらも適用しない（確保もしない）。
  - 確かめてから書くまでの間に別の人が説明を変えた場合（ミリ秒の競合）は防げない。既存の「説明に反映」と同じ扱いで、PR に書く。
- **5 件の数え方。** 受理して溜めた提案だけを数える（拒否した呼び出しは数えない）。同じアイテムへの重複の検査はしない（範囲を広げない）。
- **提案を作る時の検査（サーバー、ツールの中）。** アイテムは、そのプロジェクトにあり、ゴミ箱に無く、利用者が閲覧できること（`get_item` と同じ。見えないものは「見つかりません」と同じ答え）。さらに、編集できない・アーカイブ済みのアイテムへの提案は作らず、モデルに固定の文で伝える。ステータスは列の名前（完全一致、前後の空白は除く）で、存在しない列、今と同じ列は拒否。説明は、今と同じなら拒否。長さは既存の項目の上限（タイトル 1〜200 文字、説明 10000 文字以内。`validDescription`）。今の説明（`base_description` に入る）も `validDescription` を通ったものなので 10000 文字以内で、utf8mb4 の 4 バイトでも 40000 バイトで `TEXT`（65535 バイト）に収まる。Todo の列（名前が `Todo`）が無ければ、作成の提案は拒否。
- **同じアイテムを指す。** 確かめる読み込み（`api.itemByNumber(n, projectId)`）には、提案のプロジェクト ID を必ず渡す。本体の変更（`PATCH /api/items/{id}`）には、その読み込みで得た `id` だけを使う（番号から別に引き直さない）。列は `columnId` だけで指定・比較し、`columnName`・`itemTitle` は表示専用。
- **確保・解放・記録の失敗。**

| 段 | 失敗したとき | 状態 | 表示 |
|---|---|---|---|
| 確保（pending→applied） | 409 | サーバーの現在の提案で置き換える | 「この提案は既に処理されています。」 |
| 確保 | それ以外 | pending のまま | エラーの文言。本体は呼ばない |
| 本体の API | 失敗 | release する | 本体の失敗の理由 |
| release | 失敗 | 画面は applied（サーバーの状態） | 本体の理由に「（提案の状態を戻せませんでした。再読み込みしてください。）」を足す |
| 作成の記録 | 失敗 | applied のまま（release しない） | 「#n を作成しました（結果の記録に失敗しました）」 |

- **世代の確かめ。** 適用の各段（確保の後、確かめる読み込みの後、本体の API の後、release・記録の前）で、要求を出したときのプロジェクト ID・ユーザー ID・世代と今を比べ、違えばそこで止める（以降の要求を出さない）。
- **画面での「適用」の可否。** ステータス・説明の提案のカードは、表示したときに、そのアイテムを `GET /api/items/by-number/{n}` で読み、`canEdit`・`archivedAt`・現在の説明を使う。編集できない・アーカイブ済み・見つからないなら「適用」を無効にし、理由を出す。読めない間（読み込み中・失敗）も「適用」は押せるが、押したときに同じ確認をする。
- **モデルへの履歴には、提案を入れない。** 次の質問のとき、モデルは過去の回答の本文だけを見る（いまと同じ）。提案の中身（利用者の文字列を含む）をプロンプトに戻さないので、フェンスの心配は増えない。
- **ツールの結果は短い固定の JSON**（`{"proposed":true,"kind":"…"}` や固定のエラー文）。提案の中身をそのまま返さない。
- **画面の表示は Angular の補間だけ**（`innerHTML` を使わない）。差分の各行も補間で出す。
- **会話の一覧の作り直しで読めなかったとき**（`replyProjectChatTurn` の読み直しが失敗したとき）、組み立てた回答（今回の回答と、`before` の履歴のどちらも）には提案を付けない（ID が分からず適用できない）。開き直すと出る。
- **ボード・詳細への反映**: 提案の適用で本体が変わったら、`ProjectAiChat` は新しい出力 `itemsChanged: output<void>()` を出す（3 種類とも、本体の API が成功したとき）。ドック（`ai-chat-fab`）と専用画面（`ai-chat-page`）には、ボードを読み直す手段が無いので、この PR では親に結び付けない（ボードは次の読み込みで反映。別カードの候補）。`descriptionApplied` は使わない。
- **差分の上限。** 行単位の LCS。行数の積が 250,000 を超えたら、差分を計算せず「全体を置き換え」（旧を全部削除、新を全部追加）として出す。

## データ

```sql
CREATE TABLE IF NOT EXISTS project_ai_proposals (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  message_id BIGINT NOT NULL,
  project_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  kind VARCHAR(32) NOT NULL,            -- status_change / description_edit / item_create
  item_number BIGINT NULL,              -- status_change / description_edit の対象
  item_title VARCHAR(200) NULL,         -- 提案を作ったときの対象のタイトル（表示用）
  column_id BIGINT NULL,                -- status_change の移動先、item_create の Todo
  column_name VARCHAR(60) NULL,         -- 同上の名前（表示用）
  title VARCHAR(200) NULL,              -- item_create のタイトル
  description TEXT NULL,                -- description_edit の置き換え後、item_create の説明
  base_description TEXT NULL,           -- description_edit を作ったときの説明
  state VARCHAR(16) NOT NULL DEFAULT 'pending',
  created_item_number BIGINT NULL,      -- item_create を適用して作ったアイテムの番号
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_project_ai_proposal_message FOREIGN KEY (message_id) REFERENCES project_ai_messages(id) ON DELETE CASCADE,
  CONSTRAINT chk_project_ai_proposal_kind CHECK (kind IN ('status_change', 'description_edit', 'item_create')),
  CONSTRAINT chk_project_ai_proposal_state CHECK (state IN ('pending', 'applied', 'dismissed')),
  INDEX project_ai_proposals_message (message_id, id),
  INDEX project_ai_proposals_scope (project_id, user_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
```

- `database/init/001_schema.sql` と、起動時の `InitializeProjectAIChat`（`GET_LOCK` を 1 本の接続で取ったまま、メッセージのテーブルの後に `CREATE TABLE IF NOT EXISTS`）の両方に入れる。冪等。
- `project_id`・`user_id` はメッセージと同じ値を書く（所有者の検査を、JOIN なしで WHERE に入れるため）。外部キーはメッセージへの 1 本だけ（メッセージがプロジェクト・ユーザーに外部キーを持つので、その削除で連鎖して消える）。
- 1 つの回答の提案は、回答のメッセージと同じトランザクションで INSERT する（`AppendProjectAITurn`）。

## API

### 既存の変更

- `ProjectAIMessage` に `proposals`（配列。assistant のメッセージだけ。無ければ省略）を足す。`GET /api/projects/{id}/ai-chat`、`GET /api/projects/{id}/ai-conversations/{cid}`、`POST /api/projects/{id}/ai-chat` の応答の `messages`・`assistant` に入る。

```json
{
  "id": 12, "messageId": 340, "kind": "description_edit", "state": "pending",
  "itemNumber": 7, "itemTitle": "ログイン画面",
  "description": "新しい説明の全文", "baseDescription": "提案のときの説明",
  "createdAt": "…", "updatedAt": "…"
}
```

`status_change` は `itemNumber`・`itemTitle`・`columnId`・`columnName`。`item_create` は `title`・`description`・`columnId`・`columnName`（Todo）・適用後は `createdItemNumber`。

### 新しい API: `PATCH /api/projects/{id}/ai-proposals/{proposalId}`

- 本文: `{"state": "applied" | "dismissed" | "pending", "createdItemNumber"?: number}`。`state` が 3 つ以外、`createdItemNumber` が正の整数でない、`createdItemNumber` を `state: "applied"` 以外と送った、のどれかは 400。
- 遷移表（表に無い組み合わせは 409。本文に現在の提案 `{"message", "proposal"}`）:

| 現在 | 要求 | 条件 | 結果 |
|---|---|---|---|
| pending | applied（番号なし） | なし | applied（確保） |
| pending | dismissed | なし | dismissed（破棄） |
| applied | pending | `created_item_number` が NULL | pending（確保の解放） |
| applied | applied + `createdItemNumber` | `kind = item_create` かつ `created_item_number` が NULL | applied、番号を記録 |

- 所有者でない・無い提案は 404（他人の提案があるかを漏らさない）。プロジェクトを見られなければ、既存の `projectChatScope` と同じ答え。
- 条件付きの UPDATE 1 文（`WHERE id=? AND project_id=? AND user_id=? AND state=?…`）で、二重の確保を防ぐ。更新 0 行なら、現在の行を読み、無ければ 404、あれば 409。
- AI を呼ばないので、AI の利用制限（レート・枠）は掛けない。

## モデルのツール

`propose_status_change {number, status}`、`propose_description_edit {number, description}`、`propose_item_create {title, description}`。どれも `additionalProperties: false`（列を渡せない）。

- 提案は、1 回の質問で 5 件まで（`maxProposalsPerQuestion`）。6 件目からは「これ以上は提案できません。」を返す。
- 結果の文字数は、既存のツールの結果の予算（`toolResultBudget`）に数える（短い固定文なので実質は減らない）。
- 提案は `projectToolExecutor` が溜め、回答と一緒に `AppendProjectAITurn` で保存する。チャットが失敗したら、提案も保存しない。
- システムプロンプトに、提案のツールの使い方（「変更はしない。利用者が適用する」「頼まれたときだけ使う」「説明の編集は全文」）を足す。

## 画面（フロント）

- `ProjectAiProposalCard`（新しいコンポーネント）: 1 件の提案を表示し、適用・破棄を行う。`ProjectAiChat` のメッセージの下に、提案ごとに置く。
  - 見出し: 「ステータスの変更: #7 ログイン画面 → Doing」「説明の編集: #7 ログイン画面」「アイテムの作成（Todo）: タイトル」。
  - 説明の編集は差分（削除は赤・取り消し線、追加は緑。`-`/`+` の記号も付け、色だけに頼らない）。作成は説明の本文。
  - ボタン: 「適用」「破棄」。`aria-label` に対象を含める（例: 「#7 の説明の編集を適用」）。適用中は両方無効で、「適用中…」。
  - 状態と結果は `role="status"`（`aria-live="polite"`）で出す。失敗は `role="alert"`。
  - 適用済み: 「適用しました」（作成なら「#123 を作成しました」とリンク）。破棄: 「破棄しました」。
- 純粋な関数（別ファイル、単体テストで固定）:
  - `diffLines(before, after)`: 行単位の差分。
  - `proposalBlockReason(proposal, item)`: 読み込んだアイテムから、適用できない理由（無ければ null）。
  - `proposalPrecheck(proposal, item)`: 適用の直前の判断（`apply` / `stale` / `blocked`）。
  - 見出し・ラベルの文言。
- `api.ts`: 型 `ProjectAIProposal`、`updateProjectAIProposal(projectId, proposalId, body)`。

## テスト（受け入れ条件）

- 権限: 閲覧できない・編集できない・アーカイブ済みのアイテムへの提案をツールが作らない。他人の提案の PATCH は 404。画面で編集できないと「適用」が無効。
- 二重適用: 確保の PATCH を 2 回送ると 2 回目は 409（memory と MySQL）。画面で適用中は無効。
- 同じアイテム: 確かめる読み込みにプロジェクト ID を渡し、本体の変更はその `id` で行う（フロントのテスト）。
- 古い提案: 現在の説明が `baseDescription` と違うと適用せず、文言と最新の差分を出す（フロントの純粋な関数とコンポーネント）。
- Todo の固定: `propose_item_create` に列を渡すと入力エラー。提案の列は Todo。
- 保存と再読み込み: 回答と一緒に保存され、`ListProjectAIMessages` で戻る（memory と MySQL）。状態の変更が保存される。
- 新旧の同居: 提案のテーブルがあっても、古い版の SQL（メッセージの削除・会話の削除）で提案が連鎖して消える。`InitializeProjectAIChat` を 2 回走らせても壊れない。
- 差分: `diffLines` の追加・削除・同じ・空・上限超え。

## ドキュメント

`docs/openapi.yaml`、`docs/api.md`、`docs/ai-ops-limits.md`（提案の上限 5 件。説明の全文の提案は出力のトークンを使うので、`AI_CHAT_MAX_OUTPUT_TOKENS`（既定 4096）を超える長さの説明は、提案の途中で切れて（`max_tokens`）チャット全体が失敗になる。そのとき回答も提案も保存されない（既存の失敗と同じ）。

## 参照した知見

L-001（適用の成否を呼び出し元へ返す。確保・解放の結果を見る）、L-002（読めない・見つからないを「編集できる」に倒さない）、L-018（確かめる読み込みと本体の変更で、同じプロジェクトの同じアイテム ID を使う）、L-023（列の ID と名前、番号とタイトルを二重に持つので、判定と実行は ID・番号だけを使い、名前・タイトルは表示専用にする。作成の列はツールの入力に置かない）、L-571（応答が返ったときに、まだ同じプロジェクト・同じユーザーかを確かめる。`ProjectAiChat` の既存の `stillCurrent(scope)`（`project-ai-chat.ts`）と同じく、提案のカードも、要求を出したときのプロジェクト ID・ユーザー ID・世代を控え、応答のときに比べる。サーバーは PATCH の WHERE に `project_id`・`user_id` を入れる）、L-635（提案の中身をプロンプトに戻さない）。L-1198・L-1199 は知見のファイルに見当たらなかった。

## 範囲の判断（設計レビュー第 2 周）

- プランを 2 段（バックエンド・フロント）に分けて別々の PR にする案は採らない。開発フローが 1 つのカードを 1 つの PR で扱うため。プランの中で、バックエンド → フロントの順にタスクを並べる。
- 表示時の事前確認（アイテムを読む）は残す。カードの「編集できないアイテムへの提案は、画面で「適用」を押せない」を満たすため。最新の説明との差分の出し直しも、カードの「最新の説明との差分を出し直すか、提案を捨てる」に沿うので残す。「すでに〜です」の自動の適用済みと、重複の拒否は入れない。

## ローカルレビューで足したこと

- **説明の編集は、全文を読んだアイテムにだけ。** `get_item` は長い説明を 4000 文字（予算が足りなければさらに短く）で切って渡す。切った説明を元にした「全文の置き換え」を受け付けると、後半が消える。そこで、同じ質問の中で `get_item` が説明を切らずに渡したアイテムで、かつ提案のときの説明がそのとき読んだものと同じ場合だけ、説明の編集を受け付ける。それ以外は「説明の全文を読んでいないため、提案できません。」を返す。
- **適用の途中でカードが破棄されたら**（会話の切り替えなど）、以降の要求も出力も出さない。
