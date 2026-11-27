# プロジェクト横断で AI が動作できるようにする（#166）設計

## 背景

カード #166 は「プロジェクト横断でAIが動作できるようにする」。受け入れの趣旨は、チェックボックスをオンにすると AI がプロジェクトをまたいで検索・処理できるようにすること。

いまのプロジェクト AI チャット（#146 以降）は次のとおり硬く 1 プロジェクトに閉じている。

- API は `POST /api/projects/{id}/ai-chat`。会話・履歴は `project_ai_conversations`（`project_id` × `user_id`）。
- 読取ツール `search_items` / `get_item` は URL の `projectID` だけを見る（`projectItemSearchSQL` の `c.project_id=?`、`GetItemByNumber(number, e.projectID)`）。
- 提案ツール（`propose_*`）と適用 API も同じ URL プロジェクトに属する。
- システムプロンプトは「このプロジェクト」の名前と列だけを載せる。

このため、「全プロジェクトで期限が近いものは」「認証まわりをどのボードでも」のような横断の質問ができない。

## 決めたこと

ユーザー確認済み（2026-11-27、「推奨で」）。

1. **横断の範囲は読取だけ。** チェックがオンのとき、`search_items` / `get_item` だけを「呼び出しユーザーが **アイテム単位の `CanView`** を満たす、全プロジェクトにまたがるアイテム」へ広げる（「閲覧できるプロジェクトの一覧」ではない。プロジェクト ACL は無い）。提案・反映（`propose_*` と適用 API）と会話の所属は、いまどおり URL のプロジェクトに限定する。
2. **UI は AI チャットのチェックボックス。** ブラウザの `localStorage`（ユーザー単位のキー）に保存し、送信時に POST ボディ `crossProjectSearch: boolean` でサーバへ渡す。ボード共有の `board_settings` には載せない。
3. **会話モデルは変えない。** 会話・履歴は「現在のプロジェクト × ユーザー」のまま。横断は検索コンテキストだけ。横断専用の会話箱は作らない（スキーマ変更なし）。

### プロジェクト ACL について

現状、プロジェクト一覧（`ListProjects`）にプロジェクト単位の閲覧 ACL は無い。横断の対象は「存在する全プロジェクトのうち、**アイテム単位の `CanView` を満たすもの**」とする。プロジェクト行そのものの有無で絞らない（ログイン済みであることと、チャット経路の既存 `projectChatScope`＝URL プロジェクトが存在する、は従来どおり）。

## 要件

### 受け入れ

1. AI チャット（ページ・FAB とも）に「プロジェクト横断で検索」チェックボックスがある（文言は実装で調整可。意味は横断検索のオン／オフ）。
2. 既定はオフ。オフのときの挙動は現状と同一（読取・提案とも URL プロジェクトのみ）。
3. オンのとき、ユーザーが「他プロジェクトも含めて」と聞ける。モデルが `search_items` / `get_item` で他プロジェクトの閲覧可能アイテムを参照して答えられる。
4. オンでも、ステータス変更・説明編集・作成の提案と画面からの適用は、URL プロジェクト内のアイテム（または新規作成＝そのプロジェクト）に限る。他プロジェクトへの提案は作らない（モデルに渡すツール説明でも明示し、サーバでも拒否する）。
5. チェックの状態はブラウザに残り、同じブラウザでは次回以降の既定になる。サーバ側のユーザー設定テーブルは増やさない。
6. 番号はプロジェクトごとに独立なので、横断時の結果と `get_item` は **プロジェクトを特定できる**（結果に `projectId`、必要なら名前。`get_item` は横断オン時に `projectId` 必須）。

### 非目標（今回やらない）

- 横断会話の永続化・プロジェクト非依存の会話箱
- 提案・適用の他プロジェクトへの拡張
- プロジェクト単位 ACL の新設
- `board_settings` やサーバ永続の横断フラグ
- 検索ヒット上限やクレジット上限の変更（既存の枠をそのまま使う）

## API

### `POST /api/projects/{id}/ai-chat`

既存ボディに任意の真偽値を足す。

```json
{
  "message": "…",
  "crossProjectSearch": true
}
```

- 省略・`false`・JSON の欠落 → オフ（現状と同じ）。
- `true` 以外の型（文字列など）→ 400（既存の厳密な decode 方針に合わせる。黙ってオフにしない＝L-044）。
- 会話の選択（`conversationId` / `newConversation` / `replaceFromMessageId`）・`focusItemNumber` の意味は変えない。`focusItemNumber` は引き続き **URL プロジェクト内**の番号だけを見る。

OpenAPI（`docs/openapi.yaml`）の POST スキーマと説明文を更新する。ツールが URL プロジェクト限定と書いてある箇所は、フラグオン時の例外を追記する。

### 応答

形状は変えない（`assistant` / `messages` / `conversation` など既存どおり）。横断フラグ自体は応答に載せない（サーバはリクエストの都度解釈する）。

## UI

- 置き場: `ProjectAiChat` の compose 付近（`project-ai-chat.html` の `ai-chat-compose` / `ai-chat-compose-actions`）。ページ・FAB の両方で同じコンポーネントなので 1 か所で足りる。
- コントロール: `<input type="checkbox">` + ラベル。「送信中・編集中でもチェックは変えられる」でよい（次の送信から効く）。無効化はしない。
- 永続化: `localStorage` キーは `scrum-board.projectAiChat.crossProjectSearch`（値 `"1"` / `"0"` または同等の明確な表現）。読み書き失敗は握りつぶして既定オフ（L-056: 例外でアプリを落とさない）。
- `Api.postProjectAIChat` に引数またはオプションで `crossProjectSearch?: boolean` を足し、真のときだけボディに載せる（または常に boolean を載せる。実装はどちらか一方に揃え、OpenAPI と一致させる）。推奨: **常に boolean を送る**（サーバと UI の解釈を一致させやすい）。

## ツール（フラグオン時）

### `search_items`

- SQL: `c.project_id=?` を外し、閲覧条件（`itemSearchViewSQL`）と既存の語・担当・期限はそのまま。ゴミ箱除外・アーカイブ含むも同じ。
- **列（`status`）の解決:** 列定義は全プロジェクト共通（`board_columns`）のまま。いまどおりリクエスト時に読み込んだ `Columns` で名前→`column_id` を解決する。横断オンでもこの共通列 ID で SQL を絞る（プロジェクトごとに列が違う前提は置かない）。存在しない列名なら現状どおり空結果＋`availableStatuses`。
- 結果の各 item に `projectId`（必須）と `projectName`（表示用。名前取得に失敗したら空でも可だが、実装では JOIN または一覧から埋める）を付ける。オフ時も同じフィールドを付けてよい（常に URL プロジェクトの値）。クライアントやモデルがフラグで分岐しなくて済むなら常時付与を推奨。
- `total` / `truncated` / LIMIT 201 の意味は現状どおり（閲覧できない一致は件数に入らない）。
- リポジトリ: 既存 `SearchProjectItems(ctx, projectID, s)` に加え、横断用（例: `SearchViewableItems(ctx, s ItemSearch) ([]Item, error)`）を足すか、`projectID == 0` で全プロジェクト、のどちらか。呼び出し側がフラグで選ぶ。SQL の二重実装を避けるため、共通の WHERE 組み立てを切り出す。
- **Go 二重検査（`viewableProjectItems`）:** 現状は `it.ProjectID == projectID`（URL）で他プロジェクト行を落とす。横断オン時は「ゴミ箱除外＋`CanView`」だけにし、URL プロジェクト一致のフィルタを外す（ヘルパをフラグ対応にするか、横断用の viewable を分ける）。オフ時は現行の URL 一致を維持する。

### `get_item`

- 入力スキーマ:
  - オフ: 現状どおり `{number}`（プロジェクトは executor の URL `projectID`）。
  - オン: `{number, projectId}` で `projectId` 必須。欠落・0 以下・非整数はモデル向け `{"error": ...}`（打ち切りにしない）。
- 解決: `GetItemByNumber(number, projectId)` のあと、閲覧検査は上と同じ規則（横断オンなら URL 一致を要求しない）。見つからない／閲覧不可は同じ「アイテムが見つかりません。」。
- 結果にも `projectId`（と可能なら `projectName`）を付ける。

### `propose_*` と説明全文の記憶

- `propose_*` の入力は現状どおり **番号だけ**（`projectId` は足さない＝提案の他プロジェクト拡張は非目標）。解決も常に URL プロジェクトの `GetItemByNumber(number, urlProjectID)`。したがって「他プロジェクトのアイテムを直接指して提案する」経路は API 上存在しない。
- **検証できる拒否:** 他プロジェクトにだけ存在する番号で `propose_*` すると、URL 側に無いので既存どおりモデル向け「アイテムが見つかりません。」（または同等）になる。これをテストで固定する。
- **残リスク（受け入れる）:** 横断で読んだ他プロジェクトの `#N` と、URL プロジェクトの同番号 `#N` をモデルが取り違えて提案すること。サーバは URL の `#N` に提案する。防止はシステムプロンプト／ツール説明（「提案は現在のプロジェクトのアイテムだけ。根拠が他プロジェクトなら提案しない」）に任せ、今回は `propose_*` に `projectId` を増やさない。
- `propose_item_create` は常に URL プロジェクトへ作る提案のまま。
- **`readDescriptions`（説明全文を読んだ記録）:** 現状は `map[number]description`。番号はプロジェクトごとに独立なので、横断オン時はキーを `(projectId, number)` にするか、**URL プロジェクト以外の `get_item` 成功は `readDescriptions` に載せない**（提案の「全文を読んだか」検証は URL プロジェクトのアイテムだけが対象のため）。どちらか一方を実装プランで選ぶ。
- **L-1212（切り詰め）:** 既存どおり、`get_item` が説明を切り詰めたとき（`whole == false`）は `rememberReadDescription` しない。横断でもこの規則を維持する。切り詰め版を「全文を読んだ」とみなして `propose_description_edit` を通さない。

### ツール説明文・システムプロンプト

- 横断オン時だけ、システムプロンプトに短い節を足す（例: 「横断検索がオン。search_items / get_item は閲覧できる全プロジェクトを対象。答えの根拠にはプロジェクト名と #番号を書く。提案は現在のプロジェクトだけ。」）。オフ時は現行の文言のまま。
- `projectChatTools()` はフラグで説明を切り替えるか、横断用の説明をオン時だけ差し替える。オフ時の説明は「このプロジェクト」のまま維持する（L-048・文書と実装の一致）。

## セキュリティ・失敗の扱い

- 横断でも `CanView` と SQL 側の閲覧条件を維持する（既存の MySQL 突き合わせテストの意図を壊さない）。Go 側の二重検査も残す。
- 「無い／見えない」を空成功や別エラーに化けさせない（L-002）。DB 失敗はモデルに返さず打ち切り（既存方針）。
- クライアントが送る `crossProjectSearch` をサーバが検証してからツール範囲を決める。UI のチェックだけを信じない（L-023）。
- 番号だけの曖昧参照で他プロジェクトの存在を推測できないように、横断時の `get_item` は `projectId` 必須とする。

## テスト方針

### バックエンド

- decode: `crossProjectSearch` 欠落＝オフ、`true`／`false`、不正型＝400。
- オフ: `search_items` が他プロジェクトのアイテムを返さない（既存相当を回帰）。
- オン: 他プロジェクトの `CanView` 可能なアイテムがヒットし、不可のものは件数にも載らない。
- オン: `get_item` に `projectId` 無し → モデル向けエラー。正しい `projectId`+`number` で取得。別プロジェクトで閲覧不可 → 見つからない。
- オンでも、**他プロジェクトにだけ存在する番号**への `propose_status_change` は「見つからない」（URL に無い）。URL にも同番号がある取り違えはプロンプト依存のため自動テストの必須対象にしない。
- `get_item` で説明が切り詰められたアイテムは `readDescriptions` に載らず、`propose_description_edit` が通らない（既存 L-1212 回帰。横断オンでも）。
- システムプロンプト／ツール説明の横断節がオンのときだけ入る（文字列アサートは要点だけ）。

### フロント

- チェックの初期値が localStorage から復元される。変更で保存される。
- 送信ボディに `crossProjectSearch` が反映される（HttpClient の spy／リクエスト検査）。
- localStorage 例外時も画面が落ちない（既定オフ）。

## 関係する知見（手順 4）

実装・レビューで特に見る:

- **L-002** 無い／失敗を空に化けさせない（検索・get_item）
- **L-023** 同じ事実が複数経路（UI と POST）にあるときサーバ側を正とする
- **L-044** 認識できない入力を黙ってフォールバックしない（`crossProjectSearch` の型）
- **L-048** 既存の単一プロジェクト動作を壊さない（オフ時回帰）
- **L-056** localStorage 例外でクラッシュしない
- **L-1212** 提案の説明全文置き換えは、横断で読んだ切れた説明をそのまま置き換えに使わない（提案は URL プロジェクト限定でも、get_item の切り詰め規則は既存どおり守る）
- ACL 系（CanView を一覧と同じヘルパで通す）: 横断検索の SQL／Go 二重検査を維持

## 実装の触る場所（目安）

| 層 | ファイル（代表） |
|----|------------------|
| SQL / repo | `ai_project_search.go`、`model.go`（iface） |
| tools | `ai_project_tools.go`、`ai_project_tool_search_items.go`、`ai_project_tool_get_item.go`、`ai_project_tool_executor.go`、提案側 |
| POST / prompt | `ai_project_chat_post.go`、`ai_project_chat_context.go` |
| OpenAPI | `docs/openapi.yaml` |
| FE | `project-ai-chat.ts` / `.html`、`api.ts`、関連 spec |

## リスクと残す判断

- 横断検索はヒット空間が広がるため、同じ LIMIT でも「見落とし」が増えうる。今回は上限を変えず、既存の `truncated` / offset 案内に任せる。
- プロジェクト名の解決を毎検索でどう取るか（JOIN `projects` vs 事前 ListProjects）。実装プランで 1 つに決める。推奨: 検索 SQL で `projects` を JOIN して名前を取る。
