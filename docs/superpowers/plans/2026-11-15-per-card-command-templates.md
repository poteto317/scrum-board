# カードごとのコマンド表示と任意一括／新規初期セット Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **`/feature` 実行中はコミットしない。**

**Goal:** グローバルカタログはそのままに、カードごとにメニュー表示セットを選べるようにし、カタログ管理から任意で全カード置き換え／新規カード初期セットを設定できるようにする。

**Architecture:** `card_command_templates`（カード紐付け）と `command_template_defaults`（新規コピー元）。カード作成時にデフォルトを紐付けへコピー。`POST apply-to-all-cards` は全カードの紐付けをトランザクションで置き換え。フロントはメニューをカード GET に切り替え、詳細で選択 UI＋カタログ管理の任意ボタンを追加。

**Tech Stack:** Go / MySQL / Angular 21 / Vitest

**Spec:** `docs/superpowers/specs/2026-11-15-per-card-command-templates-design.md`

## Global Constraints

- カタログ CRUD・正規化・最大 50 件・`{{url}}` フロント置換は既存どおり変更しない。
- 未選択カードのメニューは空（案内文）。GET 失敗は空と混同しない（L-002）。
- `templateIds` 不正 id → 400・部分適用なし。重複は順序保持で一意化。空配列は許可。
- 未知カード GET/PUT → 404。
- apply-to-all / PUT はトランザクション。全カード適用は置き換え（マージしない）。L-038, L-063。
- デフォルト変更は既存カードに追従しない（作成時コピーのみ）。
- カタログ DELETE は CASCADE（または明示削除）で紐付け・デフォルトも消す。
- バックログ対象外。履歴に載せない。ボード／カード JSON に埋め込まない。
- 知見: L-001, L-002, L-003, L-017, L-038, L-039, L-040, L-046, L-063, L-108, L-586, L-799, L-800, L-801。
- `/feature` のため各タスク末尾で git commit しない（Step「Commit」はスキップ）。

## File Map

| ファイル | 責務 |
| --- | --- |
| `backend/internal/kanban/card_command_template.go` | 型・`dedupeTemplateIDs`・validate 既存 id |
| `backend/internal/kanban/card_command_template_migrate.go` | `InitializeCardCommandTemplates`（両テーブル） |
| `backend/internal/kanban/card_command_template_repo.go` | MySQL: list/replace 紐付け・defaults・apply-all・create 時コピー |
| `backend/internal/kanban/card_command_template_handler.go` | HTTP GET/PUT カード、GET/PUT defaults、POST apply-to-all |
| `backend/internal/kanban/model.go` | Repository メソッド追加 |
| `backend/internal/kanban/handler.go` | ルート登録 |
| `backend/internal/kanban/repository.go` | `CreateCard` 内で defaults コピー（`replacePRURLs` と同様 tx 内） |
| `backend/cmd/server/main.go` | Initialize 連鎖 |
| `backend/internal/kanban/handler_test.go` | `memoryRepo` 実装 |
| `backend/internal/kanban/card_command_template*_test.go` | 単体・handler・統合 |
| `frontend/src/app/api.ts` | 新 API メソッド |
| `frontend/src/app/command-template.ts` | 空案内文言の更新（カード向け） |
| `frontend/src/app/card-commands-session.ts`（新規） | 1 カード分の紐付け load/save・選択 UI 状態 |
| `frontend/src/app/command-templates-session.ts` | apply-to-all / defaults 操作・選択チェック状態 |
| `frontend/src/app/board.ts` / `board.html` | メニューをカード GET に切替 |
| `frontend/src/app/card-detail.*` | カード選択 UI・管理ダイアログ拡張・確認 |
| `docs/api.md` / `README.md` / `docs/verification.md` | 文書 |

---

### Task 1: BE — マイグレーション＋紐付け／デフォルトの永続化

**Files:**
- Create: `backend/internal/kanban/card_command_template.go`
- Create: `backend/internal/kanban/card_command_template_migrate.go`
- Create: `backend/internal/kanban/card_command_template_repo.go`
- Create: `backend/internal/kanban/card_command_template_test.go`
- Create: `backend/internal/kanban/card_command_template_integration_test.go`（DSN 未設定は skip）
- Modify: `backend/internal/kanban/model.go`
- Modify: `backend/cmd/server/main.go`（`InitializeCommandTemplates` の後）
- Modify: `backend/internal/kanban/handler_test.go`（memoryRepo）
- Modify: `backend/internal/kanban/repository.go`（`CreateCard` で defaults コピー）

**Interfaces:**
- Consumes: `CommandTemplate`, `MySQLRepository`, `replacePRURLs` の tx パターン
- Produces:
  - `dedupeTemplateIDs(ids []int64) []int64` — 先勝ちで順序保持
  - `InitializeCardCommandTemplates(ctx) error` — 両テーブル CREATE IF NOT EXISTS（spec の DDL）
  - Repo:
    - `ListCardCommandTemplates(ctx, cardID int64) ([]CommandTemplate, error)` — 無いカードは呼び出し側で 404。紐付け 0 件は空スライス
    - `ReplaceCardCommandTemplates(ctx, cardID int64, templateIDs []int64) ([]CommandTemplate, error)` — カード無ければ `ErrNotFound`。不正 id → `ErrInvalid`（または既存の bad-request 用エラー）
    - `ListCommandTemplateDefaults(ctx) ([]int64, error)`
    - `ReplaceCommandTemplateDefaults(ctx, templateIDs []int64) ([]int64, error)`
    - `ApplyCommandTemplatesToAllCards(ctx, templateIDs []int64) error`
    - `copyCommandTemplateDefaultsToCard(ctx, tx *sql.Tx, cardID int64) error` — CreateCard 専用（非公開で可）
  - `CreateCard` は INSERT 成功後・Commit 前に defaults をコピー

- [x] **Step 1: dedupe の失敗テストを書く**

```go
func TestDedupeTemplateIDs(t *testing.T) {
	got := dedupeTemplateIDs([]int64{3, 1, 3, 2, 1})
	want := []int64{3, 1, 2}
	if len(got) != len(want) {
		t.Fatalf("%v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("%v", got)
		}
	}
}
```

- [x] **Step 2: テスト実行 → 未定義で失敗することを確認**

Run: `cd backend && go test ./internal/kanban/ -run TestDedupeTemplateIDs -count=1`

- [x] **Step 3: 実装（型・migrate・repo・CreateCard フック・memoryRepo）**

DDL は spec どおり。`Replace*` は DELETE 後に配列順で INSERT（position=0..）。不正 id は一括検証してから書き込み。`ApplyCommandTemplatesToAllCards` は全 `cards.id` を列挙し、各カードに同じセットを置き換え（1 tx）。MySQL で FK CASCADE が効くことを確認（Innodb）。

- [x] **Step 4: 統合テスト（任意・DSN あり）**

`TestMySQLCardCommandTemplatesReplaceAndDefaults`: create card → defaults 空 → PUT 紐付け → GET。defaults 設定 → 新カードにコピーされる。apply-to-all で全カードが同じ id 集合。カタログ DELETE 後に紐付け・defaults から消える。不正 id は 400 相当エラー。

- [x] **Step 5: Commit スキップ**

---

### Task 2: BE — HTTP ハンドラとルート

**Files:**
- Create: `backend/internal/kanban/card_command_template_handler.go`
- Create: `backend/internal/kanban/card_command_template_handler_test.go`
- Modify: `backend/internal/kanban/handler.go`（ルート）
- Modify: `backend/internal/kanban/http_transport.go`（必要なら ErrInvalid マッピング）

**Interfaces:**
- Consumes: Task 1 の Repo メソッド
- Produces: ルート
  - `GET|PUT /api/cards/{id}/command-templates`
  - `GET|PUT /api/cards/by-number/{number}/command-templates`
  - `GET|PUT /api/command-template-defaults`
  - `POST /api/command-templates/apply-to-all-cards`
- Body decode: `DisallowUnknownFields`。`templateIds` は JSON 配列（null 不可・省略は空扱いまたは 400——**省略は 400、空配列 `[]` は許可**）
- 応答: GET/PUT カード → 200 `{ "templates": [...] }`。defaults → 200 `{ "templateIds": [...] }`。apply → 204

- [x] **Step 1: handler テストを書く（memoryRepo）**

```go
func TestCardCommandTemplatesHTTP(t *testing.T) {
	h := newTestHandler(t) // 既存 helper 名に合わせる
	// create card via POST /api/cards
	// GET card templates → {"templates":[]}
	// GET unknown card → 404
	// PUT {"templateIds":[<catalog id>]} → 200 templates len 1
	// PUT unknown card → 404
	// PUT {"templateIds":[999999]} → 400
	// PUT defaults → GET defaults
	// apply-to-all → 204; second card also has same set
}
```

不正 id は既存の bad-request 経路（`invalid` / `fail` の 400）に載せ、未マップで 500 にしない。

- [x] **Step 2: 失敗確認 → 実装 → パス**

Run: `cd backend && go test ./internal/kanban/ -run 'TestCardCommandTemplates|TestCommandTemplateDefaults|TestApplyCommandTemplates' -count=1`

- [x] **Step 3: Commit スキップ**

---

### Task 3: FE — API＋カード紐付けセッション＋メニュー切替

**Files:**
- Modify: `frontend/src/app/api.ts`, `api.spec.ts`
- Modify: `frontend/src/app/command-template.ts`（`COMMAND_MENU_EMPTY` をカード向け文言に変更、または `COMMAND_CARD_MENU_EMPTY` を追加してボード／詳細で使用）
- Create: `frontend/src/app/card-commands-session.ts`
- Create: `frontend/src/app/card-commands-session.spec.ts`
- Modify: `frontend/src/app/board.ts`, `board.html`, `board.spec.ts`
- Modify: `frontend/src/app/card-detail.ts`, `card-detail.html`, `card-detail.spec.ts`（コピーメニュー部分）
- Modify: `frontend/src/app/copy-command-feedback.ts`（変更不要なら触らない）

**Interfaces:**
- `Api.listCardCommandTemplates(cardId: number)` → `GET /api/cards/${id}/command-templates`
- `Api.listCardCommandTemplatesByNumber(n: number)` → by-number
- `Api.replaceCardCommandTemplates(cardId, templateIds: number[])`
- `Api.listCommandTemplateDefaults()` / `replaceCommandTemplateDefaults(templateIds)`
- `Api.applyCommandTemplatesToAllCards(templateIds)`
- `CardCommandsSession`（カード詳細用・providedIn なし、`CardDetail` providers）:
  - `templates = signal<CommandTemplate[]>([])`
  - `loadError = signal('')`
  - `load(cardId)` / `save(cardId, ids)` — 世代番号で古い GET を捨てる（L-040）
- 空メニュー定数: `COMMAND_CARD_MENU_EMPTY = 'このカードにコマンドがありません。詳細画面で選べます。'`
- Board: メニュー open 時に `listCardCommandTemplatesByNumber(card.number)` を呼び、結果を `commandMenuTemplates` signal に載せる。開くたびに世代／cardNumber を記録し、応答が一致しないときは捨てる（L-040）。失敗時は `commandMenuError`（空案内にしない）。グローバル `commands.templates()` はメニューに使わない（管理ダイアログ用カタログは詳細のみ）

- [x] **Step 1: api.spec と card-commands-session.spec の失敗テスト**

- [x] **Step 2: 実装して board/card-detail メニューを切替。既存 board/card-detail command テストのモックを per-card GET に更新**

Run: `cd frontend && npx ng test --watch=false --include='**/api.spec.ts' --include='**/card-commands-session.spec.ts' --include='**/board.spec.ts' --include='**/card-detail.spec.ts'`

- [x] **Step 3: Commit スキップ**

---

### Task 4: FE — 詳細のカード選択 UI＋カタログ管理の任意ボタン

**Files:**
- Modify: `frontend/src/app/command-templates-session.ts` (+spec)
- Modify: `frontend/src/app/card-detail.ts/html/css/spec.ts`

**Interfaces:**
- カタログ各行に `selectedForBulk` 用の Set/signal（チェック）。ボタン:
  - 「全カードに適用」→ `window.confirm` または既存 confirm パターン → `applyCommandTemplatesToAllCards(ids)` → 成功メッセージ → **開いているカードの `CardCommandsSession.load` を再実行**（L-039）
  - 「新規の初期にする」→ confirm → `replaceCommandTemplateDefaults(ids)`
- 詳細本文に「このカードで出すコマンド」: カタログ一覧にチェック、現在の紐付けで初期化、保存で `replaceCardCommandTemplates`
- 管理ダイアログのチェックは押すまで API を呼ばない

- [x] **Step 1: session/spec に apply・defaults・カード選択保存のテスト**

- [x] **Step 2: UI 実装＋ card-detail.spec で confirm 後だけ API が飛ぶ／未実行では呼ばれないことを固定**

Run: 同上 + `command-templates-session.spec.ts`

- [x] **Step 3: Commit スキップ**

---

### Task 5: 文書＋全体検証

**Files:**
- Modify: `docs/api.md`, `README.md`（API 表があれば）, `docs/verification.md`

- [x] **Step 1: 新エンドポイントと挙動（置き換え・作成時コピー・404/400）を追記**

- [x] **Step 2: BE/FE 全関連テスト**

```bash
cd backend && go test ./internal/kanban/ -count=1
cd frontend && npx ng test --watch=false --include='**/command*.spec.ts' --include='**/copy-command*.spec.ts' --include='**/board.spec.ts' --include='**/card-detail.spec.ts' --include='**/api.spec.ts'
```

- [x] **Step 3: API コンテナ再ビルド（ローカル確認用）。Commit スキップ**

```bash
docker compose up -d --build api
```

---

## Spec coverage checklist

| Spec 要件 | Task |
| --- | --- |
| `card_command_templates` / `command_template_defaults` DDL | 1 |
| GET/PUT カード紐付け・404 | 2 |
| GET/PUT defaults | 2 |
| POST apply-to-all 置き換え・204 | 2 |
| CreateCard 時コピー | 1 |
| カタログ DELETE CASCADE | 1 |
| メニューはカード紐付けのみ・失敗≠空 | 3 |
| カード選択 UI | 4 |
| カタログ任意ボタン＋confirm | 4 |
| apply 後に詳細の選択を再取得 | 4 |
| docs | 5 |
