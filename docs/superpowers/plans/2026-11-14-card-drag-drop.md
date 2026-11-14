# カード DnD 移動・並べ替え 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **本リポジトリの `/feature` ではコミットしない**（コミットは後続の `/commit-ja`）。各 Step 末尾の Commit はスキップする。

**Goal:** ボード上でカードを CDK DragDrop により列内並べ替え・列間移動し、`cards.position` と `PUT /api/cards/order` で永続化する。

**Architecture:** DB に `position` を追加（init SQL + 起動時マイグレーション）。API は影響列すべての完全な `cardIds` 順を1トランザクションで保存。フロントは `@angular/cdk/drag-drop` の接続リスト、短いドラッグはクリック（詳細遷移）、長いドラッグは DnD。列変更のみ履歴。

**Tech Stack:** Go + MySQL、Angular 21、`@angular/cdk` ^21.2.0、既存列並び替えパターン（楽観更新・409・非破壊バナー）。

**設計書:** [2026-11-14-card-drag-drop-design.md](../specs/2026-11-14-card-drag-drop-design.md)

## Global Constraints

- 知見: `L-001`, `L-038`, `L-048`, `L-494`, `L-540`, `L-541`, `L-680`, `L-681`, `L-015`
- コミット禁止（feature フェーズ）
- 本番利用中 DB（3307/4200）を壊す検証はしない。統合は `KANBAN_TEST_DSN` / 独立 Compose
- カード DnD のみ CDK。列 DnD の HTML5 実装は維持
- `PUT /api/cards/order` 成功時は常に全カード配列を返す
- 履歴は `column_id` 変更時のみ
- クリック／ドラッグ閾値は **8px**
- 詳細ステータス選択は残し、移動先末尾（`MAX(position)+1`）

## 変更予定ファイル

- バックエンド: `model.go`, `http_transport.go`, `validation.go`, `handler.go`, `repository.go`, `card_position.go`（新規）, `card_order.go`（新規）, `main.go`, `handler_test.go`, `card_order_handler_test.go`（新規）, `card_order_integration_test.go`（新規）, `database/init/001_schema.sql`
- フロント: `package.json` / lockfile, `models.ts`, `api.ts`, `api.spec.ts`, `card-order.ts`（新規）, `card-order.spec.ts`（新規）, `board.ts`, `board.html`, `board.css`, `board.spec.ts`
- ドキュメント: `docs/api.md`, `README.md`, `docs/verification.md`

---

### Task 1: スキーマ・position マイグレーション・Board 順

**Files:**
- Modify: `database/init/001_schema.sql`
- Create: `backend/internal/kanban/card_position.go`
- Modify: `backend/internal/kanban/model.go`, `repository.go`
- Modify: `backend/cmd/server/main.go`
- Test: `backend/internal/kanban/card_order_integration_test.go`（マイグレーション部分は Task 2 と共有可。ここでは Board 順の単体／モック更新を含む）

**Interfaces:**
- Produces: `Card.Position int`, `scanCard` / `cardFields` に position、`InitializeCardPositions(ctx) error`、`Board` の `ORDER BY c.position, c.id`

- [ ] **Step 1:** `001_schema.sql` の `cards` に `position INT NOT NULL DEFAULT 0` と `INDEX cards_column_position (column_id, position, id)` を追加。旧 `cards_order` / `cards_column` は新インデックスに置き換え（サンプル INSERT は position 省略で DEFAULT 0 で可。複数カード時は後でマイグレーションと Create が採番）。

- [ ] **Step 2:** `model.go` の `Card` に `Position int \`json:"position"\``。`cardFields` と `scanCard` を更新。`Board()` の ORDER BY を `c.position, c.id` に変更。

- [ ] **Step 3:** `card_position.go` に `InitializeCardPositions`（冪等）:
  1. `position` 列が無ければ `ALTER TABLE cards ADD COLUMN position INT NOT NULL DEFAULT 0`（追加した直後は全行 DEFAULT 0）
  2. **バックフィルは列ごとに一度きり**: 各列を独立に判定する。カードが2枚以上かつその列の `position` がすべて同一（典型は全0）の列だけ `ORDER BY created_at, id` で `0..n-1` を書く。既に列内で異なる `position` がある列は触らない（再起動で DnD 順を消さない）
  3. `cards_column_position` インデックスが無ければ追加
  4. 失敗は error 返却（起動中止）
  5. 単体カードだけの列はスキップしてよい

- [ ] **Step 4:** `main.go` で `InitializePRLinks` の前または後に `InitializeCardPositions` を呼ぶ（失敗で起動中止）。順序は position 追加が numbering/history より先でも後でもよいが、`Board` が position を読む前に完了していること。

- [ ] **Step 5:** `memoryRepo`（`handler_test.go`）の `Card` 生成・`Board` ソートを position 対応に更新し、既存テストがコンパイル・成功することを確認。

- [ ] **Step 6:** Run: `cd backend && go test -count=1 ./internal/kanban/ -run 'TestBoard|TestCreate|TestUpdate|TestHandler' `（既存が通ること）。Expected: PASS

- [ ] **Step 7:** Commit — **スキップ**

---

### Task 2: `PUT /api/cards/order` + Create/Update の position（TDD）

**Files:**
- Modify: `model.go`, `validation.go`, `http_transport.go`, `handler.go`, `repository.go`
- Create: `card_order.go`, `card_order_handler_test.go`, `card_order_integration_test.go`
- Modify: `handler_test.go`（memoryRepo）

**Interfaces:**
- Produces:
  - `type CardColumnOrder struct { ColumnID int64; CardIDs []int64 }`
  - `ErrCardOrder`, `ErrCardOrderMismatch`
  - `validateCardOrder(cols []CardColumnOrder) error`
  - `Repository.ReorderCards(ctx, []CardColumnOrder) ([]Card, error)`
  - `PUT /api/cards/order` → `{ cards: []Card }`（全件）
- Consumes: Task 1 の position / InitializeCardPositions

- [ ] **Step 1: RED** — `card_order_handler_test.go` に以下を先に書く（未実装で失敗）:
  - 列内並べ替え成功・`GET /api/board` 順反映
  - 列間移動（2列ペイロード）成功・移動カードの `columnId` 更新・履歴が列変更カードのみ増える（memoryRepo で履歴を数えるか、統合で確認）
  - 空列への移動（デスト `cardIds: [x]`、ソースから除去）
  - 400: columns 欠落/空、重複 cardId、`columnId` 重複、`<=0`、未知フィールド
  - 409: 集合不一致（列に属するカードを落とす／他列カードをソース列なしで含める）
  - 500: ReorderCards が予期せぬ error

- [ ] **Step 2:** Run handler tests — Expected: FAIL（未登録ルート等）

- [ ] **Step 3: GREEN** — 実装:
  - `validateCardOrder`
  - `fail()` マッピング: 400 `"カードの並び順を確認してください。"` / 409 `"カードの構成が変更されています。最新のボードを読み込んでからやり直してください。"`
  - `handler.reorderCards` + ルート登録
  - `ReorderCards`（設計書 §3.3: 列ロック → カード `ORDER BY id FOR UPDATE` → 集合一致 → UPDATE column_id/position → 列変更のみ history → 全カード返却）
  - `memoryRepo.ReorderCards`

- [ ] **Step 4:** CreateCard: 当該列カードを `ORDER BY id FOR UPDATE` → `position = max+1`。UpdateCard で列変更時: デスト末尾＋ソース列を `0..n-1` 詰め直し、履歴は列変更1回のみ。`memoryRepo` の CreateCard / UpdateCard / Board も同じ position 規則に揃える。

- [ ] **Step 5:** Run: `go test -count=1 ./internal/kanban/ -run CardOrder` Expected: PASS。既存全テストも PASS。

- [ ] **Step 6: 統合** — `card_order_integration_test.go`（`KANBAN_TEST_DSN`）:
  - InitializeCardPositions 後のバックフィル順
  - 並べ替え永続化、Create 末尾、Update 列変更末尾、409 で position 不変、並行 Reorder 破壊なし
  - 列変更時のみ history が増えること
  - 並べ替え後に `InitializeCardPositions` を再実行しても position が変わらないこと

- [ ] **Step 7:** `KANBAN_TEST_DSN` 付きで統合実行（無ければ skip）。`go test -race -count=1 ./...`

- [ ] **Step 8:** Commit — **スキップ**

---

### Task 3: フロント CDK・API・ボード UI（TDD）

**Files:**
- Modify: `frontend/package.json`（`@angular/cdk` ^21.2.0）、lockfile
- Modify: `models.ts`, `api.ts`, `api.spec.ts`
- Create: `card-order.ts`, `card-order.spec.ts`
- Modify: `board.ts`, `board.html`, `board.css`, `board.spec.ts`

**Interfaces:**
- Produces:
  - `Api.reorderCards(columns: { columnId: number; cardIds: number[] }[])`
  - `applyCardDrop(...)`, `buildCardOrderPayload(...)`, `dropListIdForColumn` / `columnIdFromDropListId` / `affectedColumnIds` 等の純粋関数と定数 `CARD_DRAG_THRESHOLD_PX = 8` と `CARD_TOUCH_DRAG_DELAY_MS = 200`（`card-order.ts`。後者はタッチだけの `dragStartDelay` で、スワイプによるスクロールとドラッグを分ける）。クリックとドラッグの判別は CDK の `dragStartThreshold` に任せ、自前の閾値判定関数は持たない
  - Board: `cdkDropList` 接続、カードは `<article class="task-card" cdkDrag>` の中に、コピーボタンと `<a class="task-card-body" [attr.href]>`（クリック遷移）を兄弟で置く（main の「カードリンクのワンクリックコピー」と両立）、楽観更新、既存 `reorderError` 共用または同等バナー

- [ ] **Step 1:** `npm install @angular/cdk@^21.2.0`（frontend ディレクトリ）

- [ ] **Step 2: RED** — `card-order.spec.ts`: ドロップ先リスト ID の組み立て・解析、ドロップ後の cards 配列更新（同一列・列間）、no-op、ペイロード組み立て（影響列のみ）、インデックス範囲外ガード（`L-541`）

- [ ] **Step 3: GREEN** — `card-order.ts` 実装

- [ ] **Step 4: RED/GREEN** — `api.spec.ts` に `reorderCards` → `PUT /api/cards/order`

- [ ] **Step 5:** `models.ts` に `position: number`

- [ ] **Step 6:** `board` UI:
  - imports に `DragDropModule` または `CdkDropList` / `CdkDrag` 単体 import（Angular 21 の standalone に合わせる）
  - 各列 `.card-list` を `cdkDropList` + `cdkDropListData` + 全列 `cdkDropListConnectedTo`
  - カード: ルートは `<article class="task-card">` + `cdkDrag` / `[cdkDragData]` / `[cdkDragDisabled]` / `(cdkDragMoved)` / `data-card-id`。中に兄弟として `<button class="copy-card-link">`（ドラッグ属性なし）と `<a class="task-card-body" [attr.href]>`（`routerLink` は付けない。`<a>` はもともとフォーカス可能なので `tabindex` も不要）を置く。`aria-describedby`・`(click)`・`(keydown)` はリンクに付ける（コピーボタン上の矢印キーでカードが動かないように）。`(click)` は修飾キー付き・primary 以外をブラウザー既定に任せ、それ以外は `preventDefault()` + `Router.navigate(['/cards', number])`。ドラッグか click かは CDK の `dragStartThreshold`（`CARD_DRAG_THRESHOLD_PX`）に任せる。`ArrowUp`/`ArrowDown`（修飾キーなし）で同一列移動し、並べ替え後のフォーカスは `[data-card-id]` 内の `.task-card-body` へ戻す。フォーカス枠は `.task-card:has(.task-card-body:focus-visible)` で `<article>` 全体に付ける
  - 空列: `@empty` のプレースホルダを残しつつドロップ可能な最小高さを確保（空でも `cdkDropList` が有効）
  - `cdkDropListDropped` → 純粋関数で next cards → 楽観更新 → `reorderCards` → 成功で全 cards 置換 / 失敗でロールバック＋バナー（列 DnD と同じ `reordering` / `reorderError` / `reorderConflict` を共用して二重送信抑止）
  - 保存中はカード DnD・列 DnD・列追加を抑止。カードの本文リンクには `aria-disabled` を付けず（遷移はできる）、並べ替え不可の間は `aria-describedby` の説明文を切り替える。キーボード移動の結果は既存 `aria-live`（`reorderAnnouncement`）へ
  - 端での横スクロール追従（`L-680`）をカードドラッグ中も有効化。縦はページ（`document.scrollingElement.scrollTop`）をビューポート端で補正する（列ごとの `.card-list` 縦スクロールは使わない）。CDK の自動スクロールは `cdkDropListAutoScrollDisabled` で止め（自前スクロールと競合するため）、`(cdkDragMoved)` のたびと、ドラッグ中の 50ms のタイマー（`CARD_AUTO_SCROLL_INTERVAL_MS`。端に置いたまま止まっても続く）で自前に補正する。タイマーは `(cdkDragStarted)` で始め、`(cdkDragReleased)`（マウスを離した時点。CDK の終了報告は最大 300ms 遅れる）・`(cdkDragEnded)`・ドロップ・画面の破棄で止める

  - **ボードの自動反映（main の `startLiveRefresh`）との両立**（設計書 §4.4 の 9）: `draggingCardId` の signal を `(cdkDragStarted)` で立て、`(cdkDragEnded)` で下ろし、`startLiveRefresh` の `enabled` に加える（`(cdkDragReleased)` では下ろさない。CDK の終了報告は離した最大 300ms 後で、その間も `data` を差し替えてはならない）。`onCardDrop` は、`event.item.data` の id が移動元の列の `previousIndex` にあるカードの id と一致しなければ何もしない。ポーリングの応答は、取得を始めたときの `data` のままのときだけ適用する（`pollBoard`。保存より前に出した遅い応答が、保存した順序を巻き戻さないため）

- [ ] **Step 7: RED/GREEN** — `board.spec.ts`:
  - 同一列・列間ドロップ、no-op で API 非送信
  - 通常クリックで navigate、修飾キー付き・primary 以外のクリックはブラウザー既定（アプリは navigate しない）
  - 500/409 ロールバックとバナー
  - 空列ドロップ
  - 列ヘッダー DnD がカード操作で誤発火しないこと（回帰）
  - 自動反映との両立（`board-card-drag-live-refresh.spec.ts`。fake timers と `Api.board` のモック）: ドラッグ中はポーリングの応答でボードが差し替わらない（リクエストも出ない）、離してから `ended` までも保持、ドラッグ前から飛んでいた応答は捨てる、ドラッグ終了後は再開、移動元のカードが一致しないドロップは保存しない、保存中はポーリングしない、保存より前の遅い応答で順序を巻き戻さない。各ガードを外す変異で対応するテストが落ちることを確かめる

- [ ] **Step 8:** Run: `cd frontend && npm test -- --watch=false`、`npm run build`、prettier check。Expected: PASS

- [ ] **Step 9:** Commit — **スキップ**

---

### Task 4: ドキュメントと検証

**Files:**
- Modify: `docs/api.md`, `README.md`, `docs/verification.md`

- [ ] **Step 1:** `docs/api.md` に `PUT /api/cards/order`（例・400/409・全 cards 返却・列変更時履歴）を追記。

- [ ] **Step 2:** `README.md`「できること」にカード DnD を追加。拡張例の CDK 行を実装済みに更新または削除。

- [ ] **Step 3:** 検証コマンド全通し:
  - `cd backend && go test -race -count=1 ./... && go vet ./...`
  - `cd frontend && npm test -- --watch=false && npm run build`
  - 可能なら独立 Compose（別プロジェクト名）で手動 DnD・リロード・詳細ステータス末尾を確認し `docs/verification.md` に結果を追記

- [ ] **Step 4:** Commit — **スキップ**

## 受け入れ条件（カード #1）

- [ ] カードを別ステータス列へドラッグして移動できる
- [ ] 列内の順番をドラッグで変更でき、リロード後も維持される
- [ ] 短いドラッグ距離ではカード詳細へ遷移する
- [ ] 詳細画面のステータス選択でも移動でき、移動先の末尾に並ぶ
- [ ] 列の DnD が壊れていない
