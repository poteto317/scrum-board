# AI チャットの「提案」と適用（#150）実装プラン

> 設計書: `docs/superpowers/specs/2026-11-26-card150-ai-item-proposals-design.md`
> 実装はインライン（このセッション）で行う。コミットは後の `/commit-ja` で責務ごとに行う。

**Goal:** AI が 3 種類の提案（ステータス変更・説明の編集・Todo への作成）を作り、回答と一緒に保存し、利用者が画面のボタンで適用・破棄できるようにする。

**気をつける知見:** L-001（確保・解放・記録の成否を見る）、L-002（読めない・404 を「編集できる」に倒さない。null の説明は空文字）、L-018（確かめる読み込みと本体の変更で同じ id）、L-023（列は ID で判定、名前は表示専用）、L-571（各 await の後で scope と世代を比べる）、L-635（提案の中身をプロンプトに戻さない）。

---

## タスク 1: 型と保存（backend）

**ファイル:** 新規 `backend/internal/kanban/ai_project_proposal.go`、`ai_project_proposal_repo.go`、変更 `ai_project_chat.go`、`ai_project_conversation_append.go`、`ai_project_chat_migrate.go`、`model.go`（Repository）、`database/init/001_schema.sql`、テストの `ai_project_chat_memory_test.go`。

1. `ai_project_proposal.go`:
   ```go
   const (
       ProposalKindStatusChange    = "status_change"
       ProposalKindDescriptionEdit = "description_edit"
       ProposalKindItemCreate      = "item_create"
       ProposalStatePending   = "pending"
       ProposalStateApplied   = "applied"
       ProposalStateDismissed = "dismissed"
       maxProposalsPerQuestion = 5
   )
   // ProjectAIProposalDraft is what a tool collected; stored with the answer.
   type ProjectAIProposalDraft struct {
       Kind string
       ItemNumber *int64; ItemTitle *string
       ColumnID *int64; ColumnName *string
       Title *string; Description *string; BaseDescription *string
   }
   type ProjectAIProposal struct {
       ID int64 `json:"id"`; MessageID int64 `json:"messageId"`; Kind string `json:"kind"`; State string `json:"state"`
       ItemNumber *int64 `json:"itemNumber,omitempty"`; ItemTitle *string `json:"itemTitle,omitempty"`
       ColumnID *int64 `json:"columnId,omitempty"`; ColumnName *string `json:"columnName,omitempty"`
       Title *string `json:"title,omitempty"`; Description *string `json:"description,omitempty"`
       BaseDescription *string `json:"baseDescription,omitempty"`; CreatedItemNumber *int64 `json:"createdItemNumber,omitempty"`
       CreatedAt time.Time `json:"createdAt"`; UpdatedAt time.Time `json:"updatedAt"`
   }
   // ProjectAIProposalChange is a requested transition (PATCH body after validation).
   type ProjectAIProposalChange struct { State string; CreatedItemNumber *int64 }
   // proposalTransitionAllowed: the transition table of the design (pure).
   func proposalTransitionAllowed(current ProjectAIProposal, change ProjectAIProposalChange) bool
   var ErrProposalConflict = errors.New("project ai proposal conflict")
   ```
   `description_edit` の `Description`・`BaseDescription` は空文字でも非 nil の文字列（JSON で `""` が出るよう、omitempty でも *string の空文字は出る）。
2. `ProjectAIMessage` に `Proposals []ProjectAIProposal \`json:"proposals,omitempty"\``。`ProjectAITurn` に `Proposals []ProjectAIProposalDraft`。
3. DDL `projectAIProposalsDDL`（設計書の SQL）を `ai_project_proposal_repo.go` に置き、`initializeProjectAIChat` の手順 2 の後（メッセージのテーブルの後）で `CREATE TABLE IF NOT EXISTS`。`001_schema.sql` の `project_ai_messages` の後にも同じ文。
4. `insertProjectAITurnMessages` で assistant の INSERT の `LastInsertId` を取り、`insertProjectAIProposals(ctx, tx, projectID, userID, messageID, drafts)` で同じトランザクションに INSERT。
5. `ListProjectAIMessages` の後で `attachProjectAIProposals(ctx, projectID, userID, conversationID, messages)`: `SELECT … FROM project_ai_proposals p JOIN project_ai_messages m ON m.id=p.message_id WHERE m.conversation_id=? AND p.project_id=? AND p.user_id=? ORDER BY p.id`。メッセージ ID ごとに付ける。
6. `UpdateProjectAIProposal(ctx, projectID, userID, proposalID int64, change ProjectAIProposalChange) (ProjectAIProposal, error)`（Repository に追加）: トランザクションで `SELECT … FOR UPDATE WHERE id=? AND project_id=? AND user_id=?`。無ければ `ErrNotFound`。`proposalTransitionAllowed` が false なら現在の提案と `ErrProposalConflict`。許すなら UPDATE（state、created_item_number、`updated_at=CURRENT_TIMESTAMP(6)`）して読み直す。
7. memoryRepo: `projectAIProposals map[int64]memoryProjectAIProposal{ProjectAIProposal; projectID, userID int64}`。Append で保存、List で付ける、Update は同じ表。メッセージを消す箇所（trim、drop、Clear、dropProjectAIMessages）で、そのメッセージの提案も消す（CASCADE の真似）。

**テスト（memory: `ai_project_proposal_test.go`）:**
- `TestProposalTransitionAllowed`: 遷移表の 4 行が true、それ以外（pending→pending、dismissed→*、applied→dismissed、applied→pending で番号あり、applied+番号で kind≠create、applied+番号で既に番号あり、pending→applied+番号）が false。
- `TestMemoryProjectAIProposalsStoredAndListed`: Append で 2 件 → List の assistant に 2 件、user には無し。
- `TestMemoryProjectAIProposalUpdate`: 確保 → 2 回目 409（`ErrProposalConflict`）、他人の ID は `ErrNotFound`、release、作成の番号の記録。
- `TestMemoryProjectAIProposalsGoWithMessages`: 会話を消すと提案も消える。

**テスト（MySQL: `ai_project_proposal_mysql_test.go`、`KANBAN_TEST_DSN` のときだけ。既存の `mysql_test.go` の開き方に合わせる）:**
- 保存と読み直し、状態の変更、二重の確保が 409、他人は ErrNotFound。
- 新旧の同居: 古い版の SQL（`DELETE FROM project_ai_messages WHERE conversation_id=?`、`DELETE FROM project_ai_conversations WHERE id=?`）で提案が消える。`InitializeProjectAIChat` を 2 回呼んでも成功し、提案が残る。

## タスク 2: ツール（backend）

**ファイル:** 新規 `ai_project_tool_proposals.go`（入力の読み取りと検査、純粋）、変更 `ai_project_tools.go`（定義）、`ai_project_tool_executor.go`（実行・溜める）、`ai_project_tool_io.go`（固定の文言）、`ai_project_chat_context.go`（システムプロンプト）、`ai_project_chat_post.go`（溜めた提案を turn へ）。

1. ツール名 `toolProposeStatusChange = "propose_status_change"`、`toolProposeDescriptionEdit = "propose_description_edit"`、`toolProposeItemCreate = "propose_item_create"`。スキーマはどれも `additionalProperties: false`。`propose_item_create` は `title`・`description` だけ（列は無い）。
2. 固定の文言（`toolErr…`）: `toolErrProposalLimit = "これ以上は提案できません。ここまでの提案で答えてください。"`、`toolErrNotEditable = "このアイテムは編集できないため、提案できません。"`、`toolErrArchived = "アーカイブ済みのアイテムには提案できません。"`、`toolErrUnknownStatus = "その列はありません。"`、`toolErrSameStatus = "すでにその列にあります。"`、`toolErrSameDescription = "説明が今と変わりません。"`、`toolErrNoTodoColumn = "Todo の列が無いため、作成を提案できません。"`、`toolErrProposalText = "タイトルは1〜200文字、説明は10000文字以内にしてください。"`。
3. 結果: `toolJSON(map[string]any{"proposed": true, "kind": kind})`。
4. 純粋な関数: `parseProposeStatusInput(raw) (number int64, status string, ok bool)`、`parseProposeDescriptionInput(raw) (number int64, description string, ok bool)`、`parseProposeCreateInput(raw) (title, description string, ok bool)`（タイトルは TrimSpace、`validTitle`・`validDescription`）。`todoColumn(columns) (Column, bool)`（名前が `todoColumnName`）。`columnByName(columns, name)`（TrimSpace、完全一致）。
5. executor: `proposals []ProjectAIProposalDraft`、`Proposals()`。権限は新しい純粋でない関数 `loadItemACLStateFrom(ctx, repo Repository, item Item) (ItemACLState, error)` を `item_acl_handler.go` に作り、`handler.loadItemACLState` はそれを呼ぶだけにする（共通化）。executor はそれで状態を作り、`CanView(state, e.user)`・`CanEdit(state, e.user)` を使う。`Run` の switch に 3 つ。上限は `len(e.proposals) >= maxProposalsPerQuestion` で `toolErrProposalLimit`（受理したものだけ数える）。対象のアイテムは `editableItem(ctx, number)`: `GetItemByNumber`（404→`toolErrItemNotFound`）、`DeletedAt != nil`→見つからない、`loadItemACLState` 相当（executor は `loadItemACLStateFrom(ctx, e.repo, item)` を 1 回呼び、同じ state で `CanView` と `CanEdit` を判定する）。見えない→見つからない、編集できない→`toolErrNotEditable`、`ArchivedAt != nil`→`toolErrArchived`。
6. `askProjectChat` が `tools.Proposals()` を返し、`postProjectAIChat` が `turn.Proposals` に入れる。`unstoredProjectChatTurn`（読み直しの失敗）は、`before` の各メッセージの `Proposals` を nil にし、今回の回答にも付けない。
7. システムプロンプトに 1 段落: 提案のツールは変更をしない、利用者が画面で適用する、頼まれたときだけ使う、説明の編集は置き換え後の全文、作成は Todo に作られる、1 回の質問で 5 件まで。

**テスト（`ai_project_tool_proposals_test.go`）:**
- 入力: 列を渡すと `propose_item_create` は入力エラー、未知のフィールドもエラー、タイトル空・201 文字はエラー。
- executor（memoryRepo）: 状態変更の提案が溜まり列 ID・名前が入る。未知の列・同じ列はエラー。見えないアイテム→「見つかりません」、編集できない→`toolErrNotEditable`、アーカイブ→`toolErrArchived`。説明の編集は `BaseDescription` に今の説明。同じ説明はエラー。作成は Todo の列。Todo が無いとエラー。6 件目は上限のエラー、拒否は数えない。
- 説明が空のアイテム: `BaseDescription` は非 nil の空文字。提案の説明も空ならエラー（同じ説明）。
- handler（既存の `ai_project_chat_handler_test.go` の偽の chatter の書き方に合わせる）: ツールを呼ぶ偽の chatter で POST → 応答の `assistant.proposals` に入り、`GET /ai-chat` と `GET /ai-conversations/{cid}` で読み直しても残る。6 回提案を呼ぶと保存は 5 件。チャットが失敗したら何も保存されない。`unstoredProjectChatTurn` の単体テストで、提案が付かない。

## タスク 3: 状態の API（backend）

**ファイル:** 新規 `ai_project_proposal_handler.go`、変更 `handler.go`（ルート `PATCH /api/projects/{id}/ai-proposals/{pid}`）。

1. `projectChatScope` で利用者とプロジェクト（既存と同じ答え）。`{pid}` は正の整数（違えば 400）。
2. 本文 `{"state": string, "createdItemNumber": *int64}`。`state` が 3 つ以外、番号が 1 未満、番号付きで state≠applied は 400。
3. `UpdateProjectAIProposal`: `ErrNotFound`→404（固定の文言「提案が見つかりません。」）、`ErrProposalConflict`→409 `{"message":"この提案は既に処理されています。","proposal":…}`、成功→200 で提案。他は `fail`。
4. AI の制限は掛けない。

**テスト（`ai_project_proposal_handler_test.go`）:** 確保 200 → 2 回目 409 と現在の提案、他人の提案 404、プロジェクトを見られない利用者は既存の `projectChatScope` と同じ答え、400 の 3 種（state が 3 つ以外、番号 0、番号付きで state=dismissed）と ID が 0、release、作成の番号の記録 200。

## タスク 4: 差分と規則（frontend、純粋）

**ファイル:** 新規 `frontend/src/app/project-ai-proposal-diff.ts`（+spec）、`project-ai-proposal-rules.ts`（+spec）、変更 `api.ts`。

1. `api.ts`: `ProjectAIProposal` 型、`ProjectAIMessage.proposals?: ProjectAIProposal[]`、`updateProjectAIProposal(projectId, proposalId, body: {state: …; createdItemNumber?: number})`。
2. `diffLines(before: string, after: string): DiffLine[]`、`DiffLine = {kind: 'same' | 'add' | 'del'; text: string}`。改行（`\r\n` も `\n` に）で分け、LCS。行数の積が `MAX_DIFF_CELLS = 250_000` を超えたら全削除＋全追加。空文字は 0 行。
3. `project-ai-proposal-rules.ts`:
   - `proposalHeading(p)`、`applyLabel(p)`（例「#7 の説明の編集を適用」）、`dismissLabel(p)`。
   - 表示時の読み込みの状態は `ItemCheck = {kind: 'loading'} | {kind: 'loaded'; item: Item} | {kind: 'failed'; message: string}`（404 も `failed`、`loadFailureMessage` の文言）。`failed` のときは適用を無効にし、理由を出す（L-002）。`loading` のときは押せるが、押したときに改めて読み込む。
   - `proposalBlockReason(p, item: Item | null): string | null`（item は確かめて読んだもの。`canEdit` が false→「このアイテムを編集する権限がありません。」、`archivedAt`→「アーカイブ済みのため変更できません。」。create は常に null）。
   - `proposalPrecheck(p, item): {kind: 'apply'} | {kind: 'stale'; message} | {kind: 'blocked'; message}`。description_edit で `(item.description ?? '') !== (p.baseDescription ?? '')` は stale「提案のあとで説明が変わりました。最新の説明との差分を表示しています。」。
   - `loadFailureMessage(err)`: 404→「アイテムが見つかりません。」、他→「アイテムを確認できませんでした。もう一度お試しください。」。

**テスト:** diffLines（同じ・追加・削除・置き換え・空→全追加・全→空・CRLF・上限超え）。rules（各文言、canEdit false・archived・null の説明と空の base が一致・違うと stale）。

## タスク 5: 提案のカード（frontend）

**ファイル:** 新規 `project-ai-proposal-card.ts`/`.html`/`.css`/`.spec.ts`、変更 `project-ai-chat.html`/`.ts`、`ai-chat-fab.html`/`ai-chat-page.html`（必要なら）。

1. `ProjectAiProposalCard`（standalone）: 入力 `proposal`、`projectId`。出力 `changed: output<ProjectAIProposal>()`、`itemsChanged: output<void>()`。
2. 表示時（pending かつ status/description）: `api.itemByNumber(n, projectId)` で `item` を読み、`blockReason` と（description）差分の基準を決める。読み込み中・失敗は、提案の `baseDescription` との差分を出す。
3. 適用の流れ（`generation` と `projectId`・`AuthSession` のユーザー ID を控え、各段の後で `stillCurrent()`）:
   1. status/description: `api.itemByNumber(n, projectId)` → 失敗は `loadFailureMessage`（確保しない）→ `proposalPrecheck`。stale なら `staleItem` を保存して差分を最新に、適用を無効。blocked なら理由。
   2. 確保 `updateProjectAIProposal(…, {state: 'applied'})`。409 は `err.error.proposal` で置き換え `changed.emit` と「この提案は既に処理されています。」。他の失敗は文言。
   3. 本体: status は `updateItem(item.id, {columnId: p.columnId})`、description は `updateItem(item.id, {description: p.description})`、create は `createItem({title, description, columnId: p.columnId, projectId})`。
   4. 成功: 世代を確かめてから、create は `{state: 'applied', createdItemNumber: created.number}` を記録（失敗しても release しない。「#n を作成しました（結果の記録に失敗しました）」）。`itemsChanged.emit()`、`changed.emit`。
   5. 本体の失敗: release `{state: 'pending'}`。release の失敗は理由に「（提案の状態を戻せませんでした。再読み込みしてください。）」。
4. 破棄: `{state: 'dismissed'}`。409 は同じ扱い。
5. テンプレート: 見出し、差分（`<ul>` の各行に `-`/`+`/空白と `data-kind`）、作成の本文（`<pre>` 補間）、ボタン（`aria-label`、`[disabled]="busy() || !!blockReason() || stale()"`）、状態（`role="status" aria-live="polite"`）と失敗（`role="alert"`）。適用済み「適用しました」・作成は `routerLink` で `#n`、破棄「破棄しました」。
6. `ProjectAiChat`: assistant のメッセージの下に `@for (p of msg.proposals ?? []; track p.id)` でカード。`changed` で `messages` の該当を置き換える（`replaceProposal(messages, p)` を `project-ai-proposal-rules.ts` に純粋に）。`itemsChanged` を `ProjectAiChat` の新しい出力 `itemsChanged` へ流す。調べた結果、`ai-chat-fab`・`ai-chat-page` にボードを読み直す手段は無い（`AiChatContext` は詳細の説明の反映だけ）。この PR では出力を出すだけで、親は結び付けない（ボードは次の読み込みで反映。別カードの候補として完了報告に書く）。

**テスト（`project-ai-proposal-card.spec.ts`、既存の `project-ai-chat.spec.ts` の HttpTestingController の書き方に合わせる）:**
- 差分の表示（追加・削除の行が `data-kind` で出る）。
- 編集できない（`canEdit: false`）と適用が無効、理由が出る。
- 適用中は無効、二度押しで要求は 1 回。
- 古い提案: 確かめた説明が違うと、確保の要求を出さず、文言が出て、差分が最新になる。
- 確かめる読み込みに `projectId` のクエリ、本体の PATCH はその `id`。
- 作成: `columnId` は提案の Todo の列、`projectId` 付き。成功で番号の記録。
- 本体の失敗で release。release の失敗で文言に「（提案の状態を戻せませんでした。再読み込みしてください。）」。
- 確保が 409 で置き換えと文言、確保が 500 で pending のまま本体を呼ばない。
- 作成の記録が失敗しても release を出さず、「#n を作成しました（結果の記録に失敗しました）」。
- 確かめる読み込みが 404 と 500 で文言が分かれ、どちらも確保しない。
- 世代: 確保の応答の前にカードの `projectId` を変えると本体の要求を出さない。本体の応答の前に変えると release・記録を出さない。
- `itemsChanged`: 3 種類とも本体の成功で 1 回出る。本体の失敗では出ない。
- `ProjectAiChat`: 提案付きのメッセージでカードが出る（1 件のテストを `project-ai-chat.spec.ts` に足す）。

## タスク 6: ドキュメントと検証

1. `docs/openapi.yaml`: `ProjectAIProposal` スキーマ、`ProjectAIMessage.proposals`、新しい PATCH。
2. `docs/api.md`: 同上の説明。
3. `docs/ai-ops-limits.md`: 提案は 1 回の質問で 5 件、出力のトークンとの関係、AI の制限を掛けない状態の API。
4. `docs/ai-ops-limits.md` に、`max_tokens` を超えるとチャット全体が失敗し、回答も提案も保存されないことを書く。
5. PR の本文に、受け入れた制約（確保の後にブラウザが閉じた場合、確かめてから書くまでのミリ秒の競合、作成の記録の失敗）、DB の変更、新旧の同居、コストを書く（`/pr-ja` のとき）。
6. 検証: `cd backend && go test ./...`、MySQL は `KANBAN_TEST_DSN=… go test ./internal/kanban -run 'Proposal' -count=1`（`docker compose` の `mysqlt` を必要なら起動）、`cd frontend && npx ng test --watch=false`、`npx ng build`。

## 補足（プランレビュー第 2 周で決めたこと）

- フロントの読み込みは既存の `api.itemByNumber(number, projectId)`（`api.ts`）。期待 URL は `/api/items/by-number/{n}?projectId={projectId}`。
- `canEdit` は JSON で `omitempty`。`item.canEdit !== true` を「編集できない」とする（省略を編集可に倒さない）。テストに省略のケースを足す。
- ステータスの提案: `columnByName` で解決した列の `ID` を `item.ColumnID` と比べ、保存する `ColumnID`・`ColumnName` も解決した列のもの（モデルの文字列は保存しない）。作成は `todoColumn` で見つけた列の `ID`・`Name`。
- `item_acl_handler.go` の `handler.loadItemACLState` は `loadItemACLStateFrom(ctx, h.repo, item)` への委譲にする。既存の ACL のテストが通ることを確かめる。
- L-635 のテスト: `ai_project_chat_context_test.go` に、`Proposals` 付きの履歴でも `newProjectChatInput` の turns と system に提案のタイトル・説明が入らないテストを足す。
- `unstoredProjectChatTurn` のテストは、`turn.Proposals` と `before` の `Proposals` を非空にして、戻りのメッセージ全部の `Proposals` が空であることを確かめる。
- memoryRepo: 提案を消す処理は `dropProjectAIProposalsOf(messageIDs)` 1 つにし、`trimProjectAIConversations`（経由の `dropProjectAIConversation`）、`AppendProjectAITurn` のメッセージの trim、`ClearProjectAIConversations`、`dropProjectAIMessages` から呼ぶ。テストは会話の削除・Clear・メッセージの trim を確かめる。
- 適用時は、必ずその場で読み直した item の `id` を使う（表示時に読んだ item は使わない）。確かめる読み込みの応答の後でも `stillCurrent()` を見る。テスト「確かめる読み込みの応答前に `projectId` を変えると確保しない」を足す。
