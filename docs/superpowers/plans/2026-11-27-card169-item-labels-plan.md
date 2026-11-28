# ラベル（タグ）機能（#169）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ワークスペース共通のラベル（作成・名前変更・色設定・削除）を導入し、新規／既存アイテムへの複数ラベル付け外し、ボード・バックログ・アーカイブでの表示、ボード・バックログの一覧フィルタバー（AND 絞り込み・永続化）および AI チャット検索（単一プロジェクト・プロジェクト横断）でのラベル絞り込みを実装する。

**Architecture:**
- バックエンド: `labels` + `item_labels` テーブル（`uq_labels_name_key` `VARCHAR(720)` + CASCADE）、`LabelNameKey`（`norm.NFKC` + `cases.Fold()`）、ラベル CRUD API（`/api/labels`）と `http_transport.go` エラーマッピング、全 `Item` 取得経路への `attachLabels`、`POST /api/items`・`PATCH /api/items/{id}` の `labelIds` 対応（TX 内 `FOR UPDATE` + `FOR SHARE`、履歴記録）、`workspace_list_filter` の `board_label_ids` / `backlog_label_ids` マイグレーションと正規化、AI チャット（`buildProjectChatSystem`・`writeItemPromptContext`・`search_items`・`get_item`）のラベル対応。
- フロントエンド: `Label` 型・`LabelsSession`（ETag 無効化・`ProjectBoardCache` 同期・`ListFilterSession` 削除連動・観測アイテム差分からの再読込）、`ListFilter` 拡張、および `board.css` / `backlog.css` / `item-detail.css` への CSS 追記をゼロに保つ standalone コンポーネント群（`<app-label-badges>`, `<app-label-picker>`, `<app-label-manager-dialog>`）。

**Tech Stack:** Go 1.26（MySQL 8 / `golang.org/x/text` / `memoryRepo`）、Angular 21 standalone + Signals、Vitest + jsdom、OpenAPI 3.1。

**Spec:** `docs/superpowers/specs/2026-11-27-card169-item-labels-design.md`

## Global Constraints

- 各タスク完了時点でビルドと全テストが通る状態を維持する（L-609）。
- `/feature` 実行中はコミットしない（後続の `commit-ja` で責務ごとに分割コミットする）。
- `LabelNameKey` はバックエンド単一実装とし、冪等性・NFKC・Case Folding・空白正規化をプロパティテストで固定する（L-845）。
- `board.css`・`backlog.css`・`item-detail.css` に CSS を足さず、専用 `.css` を持つ standalone コンポーネントに分離する（L-792）。
- `docs/openapi.yaml` を実装と同期更新し、`python3 scripts/check-openapi-routes.py` を通す（L-974）。

## File Map

| File | Responsibility |
|--|--|
| `backend/go.mod` | `golang.org/x/text` を直接 `require` に昇格 |
| `database/init/001_schema.sql` | `labels`・`item_labels` 初期 DDL |
| `backend/internal/kanban/label.go` | `Label` / `LabelInput` / `LabelPatch`、上限・エラー定数、`NormalizeLabelName`・`LabelNameKey`・`NormalizeLabelColor`・`labelsHistoryJSON` |
| `backend/internal/kanban/label_migrate.go` | `labelsDDL`・`itemLabelsDDL`・`InitializeLabels` |
| `backend/internal/kanban/label_repo.go` | MySQL のラベル CRUD、`attachLabels` / `attachLabel`、`replaceItemLabelsTx`、`knownLabelIDs` |
| `backend/internal/kanban/label_handler.go` | `/api/labels` GET/POST/PATCH/DELETE ハンドラと `decodeItemLabelIDs` |
| `backend/internal/kanban/http_transport.go` | `fail(w, err)` への `ErrUnknownLabel`（400）・`ErrLabelDuplicate`（409）・`ErrLabelLimit`（409）追加 |
| `backend/internal/kanban/model.go` | `Item.Labels`、`ItemInput.LabelIDs`、`ItemPatch.LabelIDs`、`Repository` iface 拡張 |
| `backend/internal/kanban/repository.go` / `backlog.go` / `card_position.go` / `archive.go` / `history.go` | 全 `Item` 読込への `attachLabels`、`CreateItem` / `UpdateItem` での `item_labels` 保存とロック、`historyValues` への `"labels"` 追加 |
| `backend/internal/kanban/handler.go` | `/api/labels` ルート登録、`createItem` / `updateItem` の `labelIds` デコード |
| `backend/internal/kanban/list_filter.go` / `list_filter_migrate.go` / `list_filter_handler.go` | `ListFilter.LabelIDs`、6 列マイグレーション、未知ラベル ID 除去、PUT バリデーション |
| `backend/internal/kanban/ai_project_search.go` / `ai_project_tool_search_items.go` / `ai_project_tool_get_item.go` / `ai_project_tools.go` / `ai_project_tool_executor.go` / `ai_project_chat_post.go` / `ai_project_chat_context.go` / `ai_chat_context.go` | AI チャットのシステムプロンプト・`focusItem`・`search_items`（`labels` AND 条件・未知ラベル案内・予算切り詰め）・`get_item` のラベル対応 |
| `backend/cmd/server/main.go` / `backend/cmd/server/wiring_test.go` / `backend/internal/kanban/mysql_test.go` | `InitializeLabels` 呼び出し、`wiring_test.go` の `ListLabels` スタブ、テスト DB `DROP TABLE` 順序更新 |
| `backend/internal/kanban/handler_test.go` / `label_test.go` / `label_handler_test.go` / `list_filter_handler_test.go` / `list_filter_integration_test.go` / `ai_project_tools_test.go` / `ai_project_cross_project_test.go` / `ai_project_chat_memory_test.go` / `ai_project_chat_context_test.go` / `ai_project_chat_repo_test.go` / `ai_project_chat_handler_test.go` / `ai_prompt_fence_test.go` | `memoryRepo` 実装、正規化プロパティテスト、CRUD・ACL・一覧フィルタ（メモリ＋MySQL 移行）・AI 検索・プロンプト脱出防止テスト |
| `docs/openapi.yaml` | `/api/labels`・`Item`・`ItemInput`・`ItemPatch`・`ListFilter`・AI チャット説明更新 |
| `frontend/src/app/label.ts` / `label.spec.ts` | `Label` 型、定数、9 色プリセット、`normalizeLabel(s)`、`isValidLabelColor`、`labelBadgeVars` |
| `frontend/src/app/models.ts` / `models.spec.ts` / `board-data.ts` / `close-reason.ts` / `close-reason.spec.ts` / `sprint-detail-helpers.ts` / `sprint-detail-helpers.spec.ts` / `api.ts` / `api.spec.ts` | `Item.labels?`（`normalizeItem` 等で `[]` 補完）、`ItemInput`/`ItemPatch` の `labelIds`、`Api` のラベル CRUD と `list-filter` 型 |
| `frontend/src/app/project-board-cache.ts` / `project-board-cache.spec.ts` / `labels-session.ts` / `labels-session.spec.ts` / `auth-session.ts` / `auth-session.spec.ts` | キャッシュの `labels` ディープコピーと更新/削除同期、`LabelsSession`（`load` / CRUD / `syncWithObservedItems` / イベント通知）、ログアウト時クリア |
| `frontend/src/app/list-filter.ts` / `list-filter.spec.ts` / `list-filter-session.ts` / `list-filter-session.spec.ts` | `labelIds` 対応（AND 一致、`knownLabelIds` 正規化、`listFilterActive`、`toggleLabel`、`pruneDeletedLabel`） |
| `frontend/src/app/label-badges.ts` / `.css` | カード・行・アーカイブ用ラベルピル表示コンポーネント |
| `frontend/src/app/label-manager-dialog.ts` / `.html` / `.css` / `.spec.ts` | ラベル作成・名前変更・色設定・削除モーダル（`appModal`・`saving` 排他・`Escape` 制御） |
| `frontend/src/app/label-picker.ts` / `.html` / `.css` / `.spec.ts` | 詳細画面およびボード／バックログ作成モーダル共用の複数ラベル選択＋管理起動コンポーネント |
| `frontend/src/app/list-filter-bar.ts` / `.html` / `.css` | フィルタバーのラベル選択チップ＋「ラベル管理」ボタン＋`<app-label-manager-dialog>` 組み込み |
| `frontend/src/app/item-labels.ts` / `item-autosave.ts` / `item-autosave.spec.ts` / `item-detail.ts` / `item-detail.html` / `item-detail.spec.ts` / `item-history.ts` / `item-history.spec.ts` / `history-link-value.ts` | 既存アイテムの即時 `labelIds` PATCH（L-790 `sideDirty` 保護・`busy`/`canLeave`/`reset`/`syncWithObservedItems` 結線）と履歴表示 |
| `frontend/src/app/board.ts` / `.html` / `board.spec.ts` / `backlog.ts` / `.html` / `backlog.spec.ts` / `archive.ts` / `.html` / `archive.spec.ts` + 既存部分 `Api` モック spec 群 | バッジ表示、作成モーダルでのラベル選択、ラベル変更時の ETag 無効化と高さ再計測、既存テストの `listLabels` モック整合 |

---

### Task 1: バックエンドのラベルドメイン・マイグレーション・リポジトリ・アイテム紐付け

**Files:**
- Modify: `backend/go.mod`
- Modify: `database/init/001_schema.sql`
- Create: `backend/internal/kanban/label.go`
- Create: `backend/internal/kanban/label_migrate.go`
- Create: `backend/internal/kanban/label_repo.go`
- Modify: `backend/internal/kanban/model.go`
- Modify: `backend/internal/kanban/repository.go`
- Modify: `backend/internal/kanban/backlog.go`
- Modify: `backend/internal/kanban/card_position.go`
- Modify: `backend/internal/kanban/archive.go`
- Modify: `backend/internal/kanban/history.go`
- Modify: `backend/cmd/server/main.go`
- Modify: `backend/internal/kanban/mysql_test.go`
- Modify: `backend/internal/kanban/handler_test.go`
- Create: `backend/internal/kanban/label_test.go`

- [ ] **Step 1:** `backend/go.mod` で `golang.org/x/text` を直接依存に昇格し、`label.go` に `Label`, `LabelInput`, `LabelPatch`, 定数（`MaxWorkspaceLabels = 200`, `MaxLabelNameRunes = 40`, `MaxItemLabelInputLen = 64`, `MaxItemLabels = 20`, `MaxListFilterLabelIDs = 64`, `MaxSearchLabelNames = 20`）、エラー（`ErrLabelDuplicate`, `ErrLabelLimit`, `ErrUnknownLabel`）、`NormalizeLabelName`, `LabelNameKey`（不可視/非空白制御除去 → NFKC → `cases.Fold()` → NFKC → `cases.Fold()` → NFKC → `Fields` 単一スペース化）、`NormalizeLabelColor`（`#rrggbb` 小文字）、`labelsHistoryJSON` を実装する。
- [ ] **Step 2:** `label_migrate.go`（`labelsDDL` `name_key VARCHAR(720)`, `itemLabelsDDL`）と `database/init/001_schema.sql` に同一 DDL を追加し、`main.go`（`InitializeHistory` より前）と `mysql_test.go`（`prepareHistory` より前）の `InitializeRelatedItems` 直後に `InitializeLabels`、`mysql_test.go` の `DROP TABLE` リスト（`items` より前）に `"item_labels"`, `"labels"` を追加する（L-1213）。
- [ ] **Step 3:** `model.go` の `Item`（`Labels []Label`）、`ItemInput`（`LabelIDs []int64`）、`ItemPatch`（`LabelIDs *[]int64`）、`Repository`（`ListLabels`, `CreateLabel`, `UpdateLabel`, `DeleteLabel`）を拡張する。`scanCard` で `c.Labels = []Label{}` を初期化し、`loadCard`・`loadBoard`・`listBacklogCards`・`listOrderedCards`・`ListArchivedItems`・`ListLivingItems` に `attachLabels` / `attachLabel` を組み込む（L-901）。
- [ ] **Step 3b:** `label_repo.go` に `ListLabels`（`id ASC`）、`CreateLabel`（TX で `labels` 全行 `FOR UPDATE` → 200 件以上は `ErrLabelLimit` → `INSERT`）、`UpdateLabel` / `DeleteLabel`（未存在は `ErrNotFound`）、`dbError` での 1062（`uq_labels_name_key`）→ `ErrLabelDuplicate` 変換（L-862）、`replaceItemLabelsTx`、`knownLabelIDs` を実装する（iface 拡張とビルドを同時に通す）。`card_position_pr_links_migration_integration_test.go` のように `boot()` を個別に組む既存結合テストに `InitializeLabels` が必要か確認し、必要なら追加する（L-1213）。
- [ ] **Step 4:** `CreateItem` と `UpdateItem`（`p.LabelIDs != nil` 時の `lockColumnRows` + `items FOR UPDATE` + `len > 0` 時の `labels FOR SHARE` 検証 + `item_labels` 置換、L-959）および `history.go` の `"labels"` 変更記録を実装する。`handler_test.go` の `memoryRepo` にも同等のラベル CRUD・重複/200件検査・アイテム紐付け・ラベル更新/削除時のカード連動を実装する。
- [ ] **Step 5:** `label_test.go` に DDL 一致テスト（`001_schema.sql` との完全一致および定義順序、L-1213）、`LabelNameKey` の不変条件テスト（冪等性・NFC/NFD・`İ`/`Σ`/`ß`/全角/半角カナ・空白生成文字 `U+FFE3`・サロゲートペア 40 文字境界、L-845/L-858）、`NormalizeLabelColor` テストを書く。あわせて MySQL 統合テスト（`KANBAN_TEST_DSN` 設定時）でリポジトリ層の重複 409 相当（`ErrLabelDuplicate`）・200 件上限・`item_labels` CASCADE（ラベル削除／アイテム物理削除）・存在しない ID の `ErrUnknownLabel` を検証する（L-862/L-959）。`cd backend && go test ./...` が通ることを確認する。

---

### Task 2: ラベル CRUD API・アイテム `labelIds` API・一覧フィルタ永続化・OpenAPI 同期

**Files:**
- Create: `backend/internal/kanban/label_handler.go`
- Modify: `backend/internal/kanban/http_transport.go`
- Modify: `backend/internal/kanban/handler.go`
- Modify: `backend/internal/kanban/list_filter.go`
- Modify: `backend/internal/kanban/list_filter_migrate.go`
- Modify: `backend/internal/kanban/list_filter_handler.go`
- Create: `backend/internal/kanban/label_handler_test.go`
- Modify: `backend/internal/kanban/list_filter_handler_test.go`
- Modify: `backend/internal/kanban/list_filter_integration_test.go`
- Modify: `docs/openapi.yaml`

- [ ] **Step 1:** `http_transport.go` の `fail(w, err)` に `ErrUnknownLabel`（400）・`ErrLabelDuplicate`（409）・`ErrLabelLimit`（409）を追加し、`label_handler.go` に `GET /api/labels`, `POST /api/labels`, `PATCH /api/labels/{id}`, `DELETE /api/labels/{id}` と共通 `decodeItemLabelIDs` を実装する。`handler.go` にルート登録および `createItem` / `updateItem` の `LabelIDs json.RawMessage` 検証を追加する（L-044, L-901）。
- [ ] **Step 2:** `list_filter.go` / `list_filter_migrate.go` / `list_filter_handler.go` を更新し、`ListFilter.LabelIDs`（`board_label_ids`, `backlog_label_ids` の 6 列移行、現存ラベル ID への正規化、破損時ビュー単位デフォルトフォールバック、PUT で `labelIds` 省略可・`null`/不正値/64件超は 400）を実装する（L-475）。
- [ ] **Step 3:** `label_handler_test.go`・`list_filter_handler_test.go`・`list_filter_integration_test.go` で以下を固定する:
  - 未認証 401（GET/POST/PATCH/DELETE 全メソッド）、一般メンバーでも CRUD 200/201/204 成功
  - 同名（大文字小文字・全角半角・分解形）409、自分自身の同キー PATCH 200、200 件上限超過 409、未存在 ID 404、未知キー/`null`/空 `{}`/41 文字/制御文字/不正色 400
  - `POST /api/items` と `PATCH /api/items/{id}` の `labelIds` 付与・全解除 `[]`・重複除去・未存在ラベル 400・`null`/65件/重複除去後21件 400
  - ACL 検査: 閲覧不可アイテム PATCH → 403（`msgViewForbidden`）、閲覧可・編集不可アイテム PATCH → 403（`msgEditForbidden`）、アーカイブ済みアイテム PATCH → 409、ボード/バックログ一覧で閲覧不可アイテムのラベル非漏洩（L-901）
  - ラベル改名・色変更・削除が既存アイテム GET / ボード GET / `GET /api/list-filter`（削除済み ID 除去）へ即反映されること、および MySQL での 4 列→6 列移行・破損 JSON ビュー単位フォールバック（L-475）
- [ ] **Step 3b:** GET/PUT `/api/list-filter` の応答では `labelIds` を常に `[]`（`null` にしない）とし、`memoryRepo` と既存 `list_filter_*_test.go` の構造体リテラル・JSON 期待値を同じ変更で更新する。
- [ ] **Step 4:** `docs/openapi.yaml` に `/api/labels`, `/api/labels/{id}`, `Label`, `Item.labels`, `ItemInput.labelIds`, `ItemPatch.labelIds`, `ListFilter.labelIds` と全エラーステータス（ラベル CRUD の 400/401/404/409、`/api/items` の `labelIds` 400、`PATCH /api/items/{id}` の 403/404/409）を追記し、手動チェックリストで実装・テストと突合する（L-974）。
- [ ] **Step 5:** `cd backend && go test ./...` と `python3 scripts/check-openapi-routes.py` がともに通ることを確認する。

---

### Task 3: AI チャット検索（`search_items` / `get_item` / プロンプト文脈）のラベル対応

**Files:**
- Modify: `backend/internal/kanban/ai_project_search.go`
- Modify: `backend/internal/kanban/ai_project_tool_search_items.go`
- Modify: `backend/internal/kanban/ai_project_tool_get_item.go`
- Modify: `backend/internal/kanban/ai_project_tools.go`
- Modify: `backend/internal/kanban/ai_project_tool_executor.go`
- Modify: `backend/internal/kanban/ai_project_chat_post.go`
- Modify: `backend/internal/kanban/ai_project_chat_context.go`
- Modify: `backend/internal/kanban/ai_chat_context.go`
- Modify: `backend/cmd/server/wiring_test.go`
- Modify: `backend/internal/kanban/ai_project_tools_test.go`
- Modify: `backend/internal/kanban/ai_project_cross_project_test.go`
- Modify: `backend/internal/kanban/ai_project_chat_memory_test.go`
- Modify: `backend/internal/kanban/ai_project_chat_context_test.go`
- Modify: `backend/internal/kanban/ai_project_chat_repo_test.go`
- Modify: `backend/internal/kanban/ai_project_chat_handler_test.go`
- Modify: `backend/internal/kanban/ai_prompt_fence_test.go`
- Modify: `docs/openapi.yaml`

- [ ] **Step 1:** `ItemSearch` に `LabelIDs []int64` を追加し、`projectItemSearchSQL`（`AND EXISTS (SELECT 1 FROM item_labels ...)`）、`searchItems`（`attachLabels` 呼び出し）、および `memoryRepo` の `SearchProjectItems` / `SearchViewableItems` に同じ AND ラベル絞り込みを追加する。
- [ ] **Step 2:** `loadProjectChatInput` で `ListLabels` を取得（失敗時は 500 で返し空扱いしない＝L-002；`wiring_test.go` の `projectChatRepo` にも `ListLabels` スタブを追加）、`buildProjectChatSystem` に `promptLabel` + `fencedBlock` でラベル一覧節を追加し、`writeItemPromptContext`（`len(item.Labels) > 0` のとき）にもラベル節を追加する。
- [ ] **Step 3:** `ai_project_tools.go`・`ai_project_tool_search_items.go`・`ai_project_tool_get_item.go`・`ai_project_tool_executor.go` を更新し、`search_items` の `labels` 入力検証（空文字/空白/不可視のみ要素は `toolErrInvalidInput`＝L-044、`UnknownStatus` → `UnknownLabel` 優先順、`AvailableLabels *[]string` 出力、`fitSearchItems` での `AvailableLabels` 末尾切り詰め）および `searchItemOut` / `getItemOut` の `labels: []string` 出力（`clip == 0` 時は空配列化）を実装する。`docs/openapi.yaml` の AI チャット説明も同期する。
- [ ] **Step 4:** `ai_project_tools_test.go`・`ai_project_cross_project_test.go`・`ai_project_chat_memory_test.go`・`ai_project_chat_context_test.go`・`ai_project_chat_repo_test.go`・`ai_project_chat_handler_test.go`・`ai_prompt_fence_test.go` に、`labels` 検証（配列でない・非文字列・21 件超は `toolErrInvalidInput`、`UnknownStatus` 優先順＝L-044）、単一プロジェクト／横断検索での複数ラベル AND 一致、閲覧不可アイテム非漏洩、未知ラベル指定時の `availableLabels`（0 件時の `[]` 含む）、空文字要素拒否、予算逼迫時の `AvailableLabels` 切り詰め、`ListLabels` 失敗時 500、`focusItem` ラベル埋め込み、ラベル名のプロンプトフェンス脱出防止を追加し、`cd backend && go test ./...` と `python3 scripts/check-openapi-routes.py` を通す。

---

### Task 4: フロントエンドのラベル基盤・キャッシュ／一覧フィルタ連動・共通 UI コンポーネント

**Files:**
- Create: `frontend/src/app/label.ts`
- Create: `frontend/src/app/label.spec.ts`
- Modify: `frontend/src/app/models.ts`
- Modify: `frontend/src/app/models.spec.ts`
- Modify: `frontend/src/app/board-data.ts`
- Modify: `frontend/src/app/close-reason.ts`
- Modify: `frontend/src/app/close-reason.spec.ts`
- Modify: `frontend/src/app/sprint-detail-helpers.ts`
- Modify: `frontend/src/app/sprint-detail-helpers.spec.ts`
- Modify: `frontend/src/app/api.ts`
- Modify: `frontend/src/app/api.spec.ts`
- Modify: `frontend/src/app/project-board-cache.ts`
- Modify: `frontend/src/app/project-board-cache.spec.ts`
- Create: `frontend/src/app/labels-session.ts`
- Create: `frontend/src/app/labels-session.spec.ts`
- Modify: `frontend/src/app/auth-session.ts`
- Modify: `frontend/src/app/auth-session.spec.ts`
- Modify: `frontend/src/app/list-filter.ts`
- Modify: `frontend/src/app/list-filter.spec.ts`
- Modify: `frontend/src/app/list-filter-session.ts`
- Modify: `frontend/src/app/list-filter-session.spec.ts`
- Create: `frontend/src/app/label-badges.ts`
- Create: `frontend/src/app/label-badges.css`
- Create: `frontend/src/app/label-badges.spec.ts`
- Create: `frontend/src/app/label-manager-dialog.ts`
- Create: `frontend/src/app/label-manager-dialog.html`
- Create: `frontend/src/app/label-manager-dialog.css`
- Create: `frontend/src/app/label-manager-dialog.spec.ts`
- Create: `frontend/src/app/label-picker.ts`
- Create: `frontend/src/app/label-picker.html`
- Create: `frontend/src/app/label-picker.css`
- Create: `frontend/src/app/label-picker.spec.ts`

- [ ] **Step 1:** `label.ts`・`models.ts`（`Item.labels?: Label[]` とし生 fixture の型互換を保ちつつ `normalizeItem` 等で `[]` 補完、L-1046）・`board-data.ts`・`close-reason.ts`・`sprint-detail-helpers.ts`・`api.ts`（`listLabels`, `createLabel`, `updateLabel`, `deleteLabel`、および `listFilter` の入力許容型）を実装し、`label.spec.ts` / `models.spec.ts` / `close-reason.spec.ts` / `sprint-detail-helpers.spec.ts` / `api.spec.ts` で検証する。
- [ ] **Step 2:** `project-board-cache.ts`（`labels` ディープコピー、`syncUpdatedLabel`, `pruneDeletedLabel`）、`list-filter.ts` / `list-filter-session.ts`（`labelIds` AND 判定、`knownLabelIds` が `null` の間は保持し読込後は現存 ID のみに絞る L-002/L-475、`listFilterActive`、`toggleLabel`、`pruneDeletedLabel`；`ListFilter` リテラルを持つ既存の `board.ts`・`backlog.ts`・`list-filter-bar.ts` と spec は `emptyListFilter()` 経由または `labelIds: []` に更新し Task 4 のビルドを通す）。`labels-session.spec.ts` で `loaded`/`loading`/`loadError` 分離、再取得時の既存 `labels()` 保持、CRUD 失敗時にキャッシュ・UI を更新しないこと（L-001/L-002）を検証する、`labels-session.ts`（`load`, CRUD, `syncWithObservedItems`, 変更イベント通知）、`auth-session.ts`（`clearSubject` での `labelsSession.clear()`）を実装し、各単体テストを追加する。
- [ ] **Step 3:** 専用 `.css` を持つ standalone コンポーネント `<app-label-badges>`, `<app-label-manager-dialog>`（`<dialog appModal class="modal-backdrop" (cancel)="$event.preventDefault(); close()">`、`textLimit(40, true)`、9 色＋カラーピッカー、読込/エラー/空の分離、`saving` 排他ロックと `Escape` 抑止＝L-653/L-1067、フォーム要素リセット）、`<app-label-picker>`（20 件到達時の未選択無効化・読込失敗時ガード）を実装し、`label-manager-dialog.spec.ts`（編集ドラフトのリセットと再オープン時の初期化＝L-542、失敗時の非更新＝L-001、`saving` 排他＝L-653）、`label-picker.spec.ts`、`label-badges.spec.ts`（名前・色変数・空配列の描画）で検証する。`label-badges.spec.ts` を Files に追加する。
- [ ] **Step 4:** `cd frontend && npm test -- --watch=false && npm run build` が通り、CSS 予算警告・エラーが出ないことを確認する。

---

### Task 5: ボード・バックログ・アーカイブ・アイテム詳細画面への結線と統合検証

**Files:**
- Modify: `frontend/src/app/list-filter-bar.ts`
- Modify: `frontend/src/app/list-filter-bar.html`
- Modify: `frontend/src/app/list-filter-bar.css`
- Create: `frontend/src/app/item-labels.ts`
- Modify: `frontend/src/app/item-autosave.ts`
- Modify: `frontend/src/app/item-autosave.spec.ts`
- Modify: `frontend/src/app/item-detail.ts`
- Modify: `frontend/src/app/item-detail.html`
- Modify: `frontend/src/app/item-detail.spec.ts`
- Modify: `frontend/src/app/item-history.ts`
- Modify: `frontend/src/app/item-history.spec.ts`
- Modify: `frontend/src/app/history-link-value.ts`
- Modify: `frontend/src/app/board.ts`
- Modify: `frontend/src/app/board.html`
- Modify: `frontend/src/app/board.spec.ts`
- Modify: `frontend/src/app/backlog.ts`
- Modify: `frontend/src/app/backlog.html`
- Modify: `frontend/src/app/backlog.spec.ts`
- Modify: `frontend/src/app/archive.ts`
- Modify: `frontend/src/app/archive.html`
- Modify: `frontend/src/app/archive.spec.ts`
- Modify: `Board` / `Backlog` / `ItemDetail` を手書き部分 `Api` モックでマウントする既存 `*.spec.ts`（`listLabels: () => of({ labels: [] })` 追加）

- [ ] **Step 1:** `list-filter-bar` にラベル絞り込みチェックピル群・「ラベル管理」ボタン・`<app-label-manager-dialog>` を組み込み、`managingLabelsChange` 出力で親（`Board` / `Backlog`）のポーリングと DnD 並び替えを抑止できるようにする。
- [ ] **Step 2:** （前提）`Board` / `Backlog` / `ItemDetail` を部分 `Api` モックでマウントする既存 spec に先に `listLabels: () => of({ labels: [] })` を追加してから `ngOnInit` の `labelsSession.load()` を入れ、各ステップ完了時点でテストを通す（L-609）。`Board`・`Backlog`・`Archive` に `<app-label-badges>` を組み込み、`Board`・`Backlog` の作成モーダルに `<app-label-picker>` を接続して `POST /api/items` へ `labelIds` を渡す。`LabelsSession` の更新/削除イベントで表示中アイテムを更新し、`Board` は `boardEtags.clear()` + `scheduleCardHeightMeasure()`、`Backlog` は `backlogEtag = ''` を実行する。また `ngOnInit` での `labelsSession.load()` とアイテム取得時の `syncWithObservedItems` を配線する（`board.css`・`backlog.css` への追記はゼロ）。
- [ ] **Step 3:** `ItemAutosave`（`sideFields` に `'labels'` 追加、`applyLabelsSave` とカタログ変更同期で `this.saving()` 飛行中のみ `sideDirty.add('labels')`＝L-790）、`ItemLabels`（`@Injectable()` コンポーネントスコープ＝L-542、同期ロック＋`saving`＝L-653、`takeUntil(changed$)`）、`ItemDetail`（`itemByNumber` 応答の `labels: normalizeLabels(card.labels)` 補完、初回取得・ポーリング反映時の `labelsSession.syncWithObservedItems([normalized])`、`<app-label-picker>` + `<app-label-manager-dialog>`、`ngOnInit` の `labelsSession.load()`、ルート切替 `switchMap` 先頭での `itemLabels.reset()` と `managingLabels.set(false)`、`busy`/`savingBusy`/`canLeave`/`beforeUnload`/`remove` 結線、`item-detail.css` への追記ゼロ）、`ItemHistory` / `HistoryLinkValue`（`"labels"` JSON 配列表示）を実装する。あわせて `Board` / `Backlog` / `ItemDetail` を部分 `Api` モックでマウントする既存 spec に `listLabels: () => of({ labels: [] })` を追加する。
- [ ] **Step 4:** `board.spec.ts`・`backlog.spec.ts`・`archive.spec.ts`・`item-detail.spec.ts`・`item-autosave.spec.ts`・`item-history.spec.ts` に以下を追加する:
  - ボード／バックログ／アーカイブでのラベルバッジ表示、ボード／バックログでの複数ラベル AND 絞り込みと DnD 一時停止、ラベル削除時のフィルタ自動解除（L-475）
  - ボード／バックログ両方の作成モーダルでのラベル選択送信とモーダル再オープン時リセット（L-060・L-542）、`saving()` 中のラベル選択無効化と二重送信防止（L-653）
  - `labelIds` PATCH／作成送信失敗時にエラー表示し UI・キャッシュを更新しないこと（L-001）
  - ラベル改名・色変更・削除時のカード表示即時更新および ETag 再取得（ABA 304 固着しないこと）
  - 詳細画面での既存アイテムへの複数ラベル付け外し、編集不可時の無効化、autosave 飛行中と非飛行中の `sideDirty` 挙動（L-453・L-790）、ルート切替時リセットとモーダル閉鎖（L-542）、履歴表示
- [ ] **Step 5:** 全体検証を実行する:
  - `cd backend && go test ./...`
  - `python3 scripts/check-openapi-routes.py`
  - `cd frontend && npm test -- --watch=false && npm run build`
  - `git diff --check`
  - `/Users/mash/Desktop/dev-flow-kit/scripts/dev-flow/require-feature-reviews.sh`

## 知見チェック（プラン反映）

- L-001 / L-002 / L-044 / L-048 / L-060 / L-453 / L-475 / L-542 / L-609 / L-653 / L-790 / L-792 / L-845 / L-858 / L-862 / L-901 / L-959 / L-974 / L-1046 / L-1067 / L-1213
