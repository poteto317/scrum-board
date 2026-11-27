# カード166: プロジェクト横断 AI 検索 — 実装プラン

> **For agentic workers:** タスク順に実装。各 Task 末尾の検証を通してから次へ。**コミットはしない**（`/feature` 手順 11）。

**Goal:** AI チャットのチェックオン時だけ、`search_items` / `get_item` をアイテム単位 `CanView` の全プロジェクト横断にし、提案・会話は URL プロジェクトのままにする。

**設計:** `docs/superpowers/specs/2026-11-27-card166-ai-cross-project-design.md`

**Architecture:** POST `crossProjectSearch` → executor フラグ。検索 SQL から `project_id=?` を外す経路を追加。`viewable` はオン時 URL 一致を外す。`get_item` はオン時 `projectId` 必須。`readDescriptions` は URL プロジェクトの全文読取だけ記録。FE は checkbox + localStorage。

**Tech Stack:** Go/MySQL、Angular + vitest、OpenAPI

**知見:** L-002, L-023, L-044, L-048, L-056, L-1212

**Global Constraints**

- オフ時挙動は現状と同一（回帰必須）
- 提案に `projectId` を足さない
- スキーマ変更なし
- コミットしない

## ファイル分担

| 責務 | ファイル |
|------|----------|
| 検索 SQL / repo | `backend/internal/kanban/ai_project_search.go`, `model.go` |
| viewable | `ai_project_tool_view.go` |
| tools schema / parse / exec | `ai_project_tools.go`, `ai_project_tool_search_items.go`, `ai_project_tool_get_item.go`, `ai_project_tool_executor.go` |
| POST / prompt | `ai_project_chat_post.go`, `ai_project_chat_context.go` |
| OpenAPI | `docs/openapi.yaml` |
| FE | `api.ts`, `project-ai-chat.ts`, `project-ai-chat.html`, specs |

---

## Task 1: 横断検索 SQL + repo

**Files:** `ai_project_search.go`, `model.go`, memory / failing スタブ（`ai_project_tools_test.go` 等の `Repository` 実装）、既存検索テスト（`ai_project_chat_repo_test.go` / `ai_project_tools_test.go`）

1. `projectItemSearchSQL` から「任意の project フィルタ」を切り出す（`projectID > 0` のときだけ `c.project_id=?`）。`projectID == 0` は横断。
2. **このプランでは JOIN なし + executor が起動時に project 名 map を持つ**（Task 2/4）。
3. Repository iface に `SearchViewableItems(ctx, s ItemSearch) ([]Item, error)` を追加し、実装は `projectItemSearchSQL(0, s)`。既存 `SearchProjectItems` は `projectID` 付きのまま。**同時に** `memoryRepo` / `failingToolRepo`（および iface を満たす他スタブ）へメソッドを追加してコンパイルを通す。
4. **列フィルタ:** `status` → `column_id` は既存どおり共通 `Columns` で解決（Task 3 の parse）。Task 1 の SQL は `ColumnID` が付いていれば全プロジェクトに同じ ID で絞るだけ。未知 status の空＋`availableStatuses` は既存 parse 経路の回帰（Task 3 で明示テスト）。
5. **テスト（先に失敗）:** 2 プロジェクトにヒットする語で、メンバーが `CanView` できる他 PJ アイテムが `SearchViewableItems` に含まれ、閲覧不可は含まれない。`SearchProjectItems(projectA)` は他 PJ を含まない。既存の `itemSearchViewSQL` ↔ `CanView` MySQL 突き合わせテスト（`TestProjectItemSearchViewConditionMatchesCanViewMySQL` 等）が緑のまま（二重検査・意図を壊さない）。

**Verify:** `go test ./internal/kanban/ -count=1 -run 'SearchViewable|ProjectItemSearch'`

---

## Task 2: viewable / executor フラグ

**Files:** `ai_project_tool_view.go`, `ai_project_tool_executor.go`

1. `viewableProjectItems` を拡張: `crossProject bool`。`false` なら現行（`ProjectID == projectID`）。`true` ならゴミ箱除外のみ（プロジェクト一致なし）→ `attachACLState` + `filterVisibleItems`。
2. `projectToolExecutor` に `crossProject bool` と任意で `projectNames map[int64]string`。`newProjectToolExecutor(..., crossProject bool)`（または options）。呼び出しを全部更新。
3. `viewable` メソッドがフラグを渡す。
4. **テスト:** 横断オンで他 PJ の可視アイテムが `viewable` を通過。オフでは落ちる。

**Verify:** 該当 unit テスト緑。

---

## Task 3: `search_items` / `get_item` ツール

**Files:** `ai_project_tools.go`, `ai_project_tool_search_items.go`, `ai_project_tool_get_item.go`, `ai_project_tool_executor.go`, tools テスト

1. `searchItemOut` に `ProjectID int64 \`json:"projectId"\`` と `ProjectName string \`json:"projectName"\``（常時付与。オフ時は URL プロジェクト）。
2. `searchItems`: `crossProject` なら `SearchViewableItems`、否則 `SearchProjectItems(e.projectID)`。名前は map から。
3. `projectChatTools(crossProject bool)`: オン時は説明を横断向けに。`get_item` スキーマはオン時 `projectId` を properties + required に追加。
4. **シグネチャ固定:** `parseGetItemInput(raw json.RawMessage, crossProject bool) (number int64, projectID int64, errMsg string)`（名前は同等で可）。オンかつ `projectId` 欠落 → モデル向けエラー文字列。オフ時は `projectID = 0` を返し、呼び出し側が `e.projectID` を使う。
5. `getItem`: 解決した projectID で `GetItemByNumber`。結果 JSON に `projectId` / `projectName`。
6. **`rememberReadDescription`:** `item.ProjectID == e.projectID` かつ `whole` のときだけ記録（横断で読んだ他 PJ は載せない）。既存の切り詰め非記録は維持（L-1212）。
7. **L-002:** `SearchViewableItems` や ACL 読み込み失敗はモデル向け空 JSON にせず、既存どおり打ち切り（`failingToolRepo` 等で横断オン時も空成功にしない）。
8. **テスト:**
   - オフ（L-048）: 他 PJ ヒットなし；`get_item` は number のみ。
   - オン: 他 PJ ヒット + `projectId` 付き；`get_item` に projectId 無し → error JSON；正しい組で取得；不可視 → 見つからない。
   - オン: 未知の `status` 名 → 空結果 + `availableStatuses`（既存挙動の横断回帰）。
   - オン: **他 PJ にだけ存在する番号**で `propose_status_change` → 見つからない。
   - オン: 他 PJ の全文 get 後、同番号の URL アイテムへ `propose_description_edit` しても「読んでない」扱い（他 PJ 本文が検証に使われない）。
   - オンでも L-1212: URL アイテムの説明が切り詰め（`whole=false`）の get のあと `propose_description_edit` 不可（`readDescriptions` 非登録）。
   - オン: repo/ACL 失敗 → 打ち切り（空の search 成功に化けない）。

**Verify:** `go test ./internal/kanban/ -count=1 -run 'SearchItems|GetItem|Propose|Tool'`

---

## Task 4: POST・プロンプト・OpenAPI

**Files:** `ai_project_chat_post.go`, `ai_project_chat_context.go`, `docs/openapi.yaml`, handler テスト

1. `projectAIChatRequest` に `CrossProjectSearch *bool \`json:"crossProjectSearch"\``。`nil`/`false` → オフ。`true` → オン。非 bool は decode 失敗 → 400（L-044）。明示テスト: 欠落オフ、`true`/`false`、文字列など不正型 → 400。
2. **配線（L-023）:** ツール横断範囲は UI ではなく、decode 済み `req.CrossProjectSearch` だけを正とする。`loadProjectChatInput` / `newProjectChatInput` が `crossProject` を `projectChatInput` に載せ、`askProjectChat` → `newProjectToolExecutor(..., crossProject)` と `projectChatTools(crossProject)` / `buildProjectChatSystem(..., crossProject)` へ同じ値を渡す。`ListProjects` で名前 map を executor に渡す。
3. `buildProjectChatSystem(..., crossProject bool)`: オン時だけ横断節を追記（設計の文言）。
4. **`focusItemNumber`:** 横断オンでも従来どおり **URL プロジェクト内**の番号だけを `loadProjectChatFocus` する（他 PJ 番号は文脈に入れない／存在漏洩しない）。実装変更が不要でも、オン＋他 PJ にだけある番号／オン＋URL 内番号の回帰テストを 1 本以上置く。
5. OpenAPI: POST body に `crossProjectSearch`。エンドポイント／ツール説明の「URL プロジェクトに限る」をフラグオン時の読取例外付きに更新。400 に型不正を含める旨をスキーマまたは説明に同期。
6. **テスト（オフは L-048）:** decode／不正型 400／プロンプトに横断節がオン時だけ／オフ時ツールが単一 PJ／`focusItemNumber` 回帰。

**Verify:** `go test ./internal/kanban/ -count=1 -run 'ProjectAIChat|DecodeProjectChat|CrossProject|Focus'`

---

## Task 5: フロント checkbox + API

**Files:** `api.ts`, `project-ai-chat.ts`, `project-ai-chat.html`, `project-ai-chat.spec.ts`, 必要なら `api` 関連 spec

1. 定数 `CROSS_PROJECT_SEARCH_KEY = 'scrum-board.projectAiChat.crossProjectSearch'`。
2. `crossProjectSearch` signal。初期化で localStorage 読み（`'1'` → true）。失敗時 false（try/catch、L-056）。
3. checkbox を compose 付近に。change で signal 更新 + localStorage 書き。**送信中・編集中も disabled にしない**（次の送信から効く）。
4. `postProjectAIChat(..., crossProjectSearch: boolean)` — **常に** boolean をボディへ。`api.spec.ts`（または同等の API テスト）の期待ボディも更新。
5. `send` / 再送信経路すべてで signal の値を渡す。
6. **テスト:** 初期復元、トグルで保存、POST body に `crossProjectSearch: true/false`、storage throw でも生成できる、composeInactive 中も checkbox が disabled でない。

**Verify:** `cd frontend && npx vitest run src/app/project-ai-chat.spec.ts src/app/api.spec.ts`（後者が無ければ api 呼び出しを chat spec で固定）

---

## Task 6: 統合検証

1. `cd backend && go test ./internal/kanban/ -count=1`
2. `cd frontend && npx vitest run src/app/project-ai-chat.spec.ts`
3. AC 突合:
   - チェックあり（ページ・FAB 共通コンポーネント）
   - 既定オフ・オフ＝旧挙動
   - オンで横断検索・get
   - 提案は URL のみ（他 PJ 専用番号 → 見つからない）
   - localStorage 永続
   - 番号は projectId 付き

## 完了条件

- [ ] Task 1–5 の Verify 緑
- [ ] Task 6 緑
- [ ] 設計の非目標（スキーマ・提案拡張・board_settings）に手を出していない
