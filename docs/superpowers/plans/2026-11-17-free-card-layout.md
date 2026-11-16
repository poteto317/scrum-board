# カード自由配置（高さを保つ横移動）実装プラン

> **For agentic workers:** タスクを上から順に実装する。各ステップのチェックボックスで進捗を追う。`feature` 実行中は **git commit しない**。

**Goal:** ボード設定で `pack`（既定・上詰め）と `free`（空きあり自由配置）を切り替え、`free` では列間移動時に `offsetY` を保って高さを変えずに横移動できるようにする。

**Architecture:**
- DB: `items.offset_y` + `board_settings`（key/value）。起動時冪等マイグレーション。
- API: `GET /api/board` に `settings` と `offsetY`。`PATCH /api/board/settings`。`PUT /api/items/order` に任意 `offsetYs`。
- FE: ツールバートグル、`pack` は現行 CDK、`free` は絶対配置 + sorting 無効。pack→free は DOM 計測→order→settings の順。
- 文書: README / api.md / verification.md を追従（L-203）。

**Tech Stack:** Go 1.x, MySQL 8, Angular 21 CDK DragDrop, TypeScript, Vitest

**参照設計書:** `docs/superpowers/specs/2026-11-17-free-card-layout-design.md`

**知見:** L-001, L-038, L-094, L-203, L-459, L-472, L-612, L-669, L-680

---

### Task 1: DB マイグレーションとモデル

**Files:**
- Modify: `backend/internal/kanban/model.go`
- Modify: `database/init/001_schema.sql`（新規 DB 向け `offset_y` / `board_settings`）
- Create: `backend/internal/kanban/offset_y_migrate.go`
- Create: `backend/internal/kanban/board_settings_migrate.go`
- Modify: 起動でマイグレーションを呼ぶ箇所（既存の `InitializeItemPositions` 呼び出し近傍）
- Test: `backend/internal/kanban/offset_y_migrate_test.go` または integration

- [x] **Step 1:** `Item` に `OffsetY int \`json:"offsetY"\`` を追加。scan / insert / update / Board 取得 SQL に `offset_y` を含める。
- [x] **Step 2:** `InitializeItemOffsetY` — 列が無ければ `ALTER TABLE items ADD COLUMN offset_y INT NOT NULL DEFAULT 0`（冪等）。
- [x] **Step 3:** `InitializeBoardSettings` — `CREATE TABLE IF NOT EXISTS board_settings (setting_key VARCHAR(64) PRIMARY KEY, setting_value VARCHAR(255) NOT NULL)`。`card_layout` が無ければ `pack` を INSERT。
- [x] **Step 4:** 単体/統合テストで再実行しても壊れないこと、既存行の `offset_y=0` を確認。
- [x] **Step 5:** `go test`（該当パッケージ）を通す。

---

### Task 2: Board 応答の settings と order の offsetYs

**Files:**
- Modify: `backend/internal/kanban/model.go`（`Board.Settings`, order 入力型）
- Modify: `backend/internal/kanban/repository.go` / `mysql.go`（実ファイル名に合わせる）
- Modify: `backend/internal/kanban/handler.go`
- Modify: order の decode / validation
- Test: handler / integration tests

- [x] **Step 1:** `BoardSettings` 型 `{ CardLayout string \`json:"cardLayout"\` }`。`Board` に `Settings BoardSettings \`json:"settings"\``。
- [x] **Step 2:** `Board()` が `card_layout` を読み `pack`/`free` 以外は `pack` にフォールバックして返す（DB の他キーは触らない・消さない）。
- [x] **Step 3:** `ItemColumnOrder` に任意 `OffsetYs []int \`json:"offsetYs,omitempty"\``。decode 後、`offsetYs` があるときだけ `len == len(itemIds)` を要求。各値は整数（JSON number が非整数なら 400）かつ `>= 0`。省略時は既存 `offset_y` 維持。
- [x] **Step 4:** `ReorderItems` トランザクション内で `position` と（指定時）`offset_y` を更新（L-038）。
- [x] **Step 5:** テスト: 省略で offset 維持、同長更新、長不一致 400、負/小数 400、409 規則の回帰。
- [x] **Step 6:** `go test` を通す。

---

### Task 3: `PATCH /api/board/settings`

**Files:**
- Modify: `backend/internal/kanban/handler.go`
- Create/Modify: settings repo methods
- Test: settings handler tests

- [x] **Step 1:** `PATCH /api/board/settings` を登録。body `{ "cardLayout": "pack"|"free" }` のみ（DisallowUnknownFields）。
- [x] **Step 2:** `free`→`pack` のとき同一トランザクションで全列の item を `ORDER BY offset_y, position, id` で `position` 再割当し、`card_layout=pack` を書く。
- [x] **Step 3:** `pack`→`free` は settings 行だけ更新（offset 初期化は FE 側の先行 PUT）。
- [x] **Step 4:** 成功応答: 常に `settings`。`cardLayout` が結果として `pack` のときは **`items`（全件）も返す**。`free` への変更では `items` 省略可。不正値 400。
- [x] **Step 5:** テストで free→pack の position 順・応答に items が含まれること・失敗時ロールバックを固定。
- [x] **Step 6:** `go test` を通す。

---

### Task 4: 詳細ステータス変更・新規作成時の free 配置

**Files:**
- Modify: CreateItem / UpdateItem(column) / status-by-number の配置ロジック
- Test: 既存 status / create tests を拡張

- [x] **Step 1:** サーバーは DOM 高を知らない。`card_layout=free` で作成／列変更するとき `offset_y = COALESCE(MAX(offset_y), -160) + 160`（空列→0、非空→最大 offset_y+160）。`pack` 時は `offset_y` を変えず現行の position 末尾のみ。
- [x] **Step 2:** テスト: 空列→0、非空→max+160、pack では position 末尾のみ。
- [x] **Step 3:** `go test` を通す。

---

### Task 5: FE モデル・API・レイアウトトグル基盤

**Files:**
- Modify: `frontend/src/app/models.ts`
- Modify: `frontend/src/app/api.ts`
- Create: `frontend/src/app/board-layout-settings.ts`（lock 表の純粋関数）
- Create: `frontend/src/app/board-layout-settings.spec.ts`
- Modify: `frontend/src/app/board.ts` / `board.html` / `board.css`

- [x] **Step 1:** `Item.offsetY`、`BoardData.settings.cardLayout` を型に追加。欠落時は `pack` / `0`。
- [x] **Step 2:** `api.patchBoardSettings({ cardLayout })` → `{ settings, items? }`（`cardLayout` のみ送信）。`api.reorderItems(columns)` は各列に任意 `offsetYs` を付けられるようにする（settings API とは分離）。
- [x] **Step 3:** `cardLayoutToggleGate(state) → { allowed: boolean; reason: string }` を要件 4 の直積表どおり実装。`allowed === false` なら `reason` 非空をテストで固定（L-094, L-669）。
- [x] **Step 4:** ツールバーにトグル UI と `aria` 理由。楽観的に切り替えたあと **保存失敗時はトグル（表示状態）を元の `cardLayout` に戻し**、バナーで知らせる（L-001）。
- [x] **Step 5:** ライブ更新（`pollBoard` 等）でボードを差し替えるとき `settings` と各 `offsetY` が落ちないことをテストで固定（マッパー欠落の回帰、要件 6）。
- [x] **Step 6:** `npm test -- --watch=false` の該当を通す。

---

### Task 6: free レイアウト描画と DnD

**Files:**
- Modify: `frontend/src/app/board.html` / `board.ts` / `board.css` / `styles.css`
- Modify: `frontend/src/app/item-order.ts`（free 用 apply / payload helpers）
- Create/Modify: specs for free drop Y 計算（L-612）
- Modify: existing board DnD tests for pack 回帰

- [x] **Step 1:** `cardLayout==='free'` のとき `.card-list` に free 用 class。カード `top: offsetY`。列の CSS `min-height` は **`max(空列用既存 min-height, 各カードの offsetY + getBoundingClientRect().height の最大)`**（高さは **実 DOM 計測**に固定。jsdom では `getBoundingClientRect` をモック）。
- [x] **Step 2:** free では `cdkDropListSortingDisabled`。**`[cdkDropListConnectedTo]="connectedLists()"` は pack/free とも維持**（列間 DnD）。キーボード矢印並べ替えは `pack` のみ。
- [x] **Step 3:** `computeFreeOffsetY({ listTop, pointerY, grabOffsetY, scrollTop })` を純粋関数化し **`< 0` は 0 にクランプ**。プレビューと drop で共用（L-612）。列間 drop は **旧 offsetY 維持**。
- [x] **Step 4:** drop 後 `position` を offsetY 順に振り、`offsetYs` 付き PUT。失敗時ロールバック（L-001）。
- [x] **Step 5:** pack→free: 各カードの上端 Y を DOM 計測（テストでは rect モック）して PUT（全列）成功後に settings PATCH。どちらか失敗で設定を free にしない（L-038）。
- [x] **Step 6:** free→pack: settings PATCH（サーバーが position 再割当）。**応答の `items` でボードの items を置換**（再 GET しない）。
- [x] **Step 7:** ドラッグ中プレビューが scrollHeight を伸ばさないことを既存 L-680 系テスト方針に合わせる。
- [x] **Step 8:** テスト: 横移動で offsetY 不変、同列で上端 Y 更新、pack 回帰、切替シーケンス失敗、ライブ更新後の settings/offsetY 残存。
- [x] **Step 9:** `npm test -- --watch=false` と必要なら `npm run build`。

---

### Task 7: 文書更新

**Files:**
- Modify: `README.md`
- Modify: `docs/api.md`
- Modify: `docs/verification.md`

- [x] **Step 1:** api.md に `settings` / `offsetY` / `PATCH /api/board/settings` / `offsetYs` を追記。
- [x] **Step 2:** README にトグルと free の横移動・既定 pack を短く書く。
- [x] **Step 3:** verification.md に受け入れ要約を追加。
- [x] **Step 4:** 設計の受け入れ条件を満たす手動確認項目が verification と一致することを目視。

---

### Task 8: 全体検証

- [x] **Step 1:** `go test ./...`（backend）と `go vet`（プロジェクトの慣例に従う）。
- [x] **Step 2:** `frontend` で `npm test -- --watch=false` と `npm run build`。
- [x] **Step 3:** `docs/verification.md` に書いた受け入れ（初回 pack、横移動で高さ維持、同列で空き、再読込復元、保存失敗時）をローカルまたは本番相当で確認し、未実施なら記録する。
- [x] **Step 4:** 失敗があれば次へ進まず修正。

---

## 実装時の注意

- commit しない（feature ルール）。
- 秘密（Basic Auth 等）を文書やテストに書かない。
- `offsetYs` 追加は後方互換（省略＝現行 pack DnD）。
