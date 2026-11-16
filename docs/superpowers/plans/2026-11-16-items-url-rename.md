# アイテム URL・用語リネーム実装プラン（カード #26）

> **Spec:** `docs/superpowers/specs/2026-11-16-items-url-rename-design.md`  
> **コミットしない**（`/feature`）。知見: L-018, L-002, L-035, L-037, L-040, L-456  
> DB 表名は維持。公開パス・API・型・文言・TASK→ITEM。

**Goal:** 公開 URL を `/items/:n`、API を `/api/items`、型・UI を Item、表示を `ITEM-`／「アイテム」に揃える。

**Architecture:** FE ルート＋URL ビルダー、BE ハンドラパスと JSON キー、関連 kind マイグレーション、共有 `formatItemNumber`、段階的なシンボル／ファイルリネーム。

**Tech Stack:** Angular 21 / Go / MySQL

## Global Constraints

- DB 物理名 `cards` / `card_id` は変えない。
- `/api/cards` は残さない（FE・smoke・docs を同時更新）。
- CSS `.task-card` は触らない。
- `/feature` 中はコミットしない。

## ファイルマップ（主要）

| 領域 | パス |
|------|------|
| 番号表示 | `frontend/src/app/item-number.ts`（新） |
| URL | `card-link.ts`→`item-link.ts`, `app.routes.ts` |
| API FE | `api.ts` |
| 型 FE | `models.ts` |
| 詳細・ボード・バックログ | `card-detail*`→`item-detail*`, `board*`, `backlog*` |
| セッション類 | `card-*.ts`→`item-*.ts` |
| BE ハンドラ | `handler.go` パス |
| BE 型 | `model.go` Item / json tags |
| 関連 kind | `related_item*.go` + migrate |
| Docs | `README.md`, `docs/api.md`, `docs/verification.md`, `scripts/smoke.py` |

---

### Task 1: `formatItemNumber` + 公開 URL ルート

1. [x] `item-number.ts` / spec: `formatItemNumber(3) === 'ITEM-003'`
2. [x] `itemDetailUrl`（`item-link.ts`、旧 card-link から移行）→ `/items/{n}`
3. [x] `app.routes.ts`: `items/:number` ＋ `cards/:number` → `items/:number` redirect
4. [x] 既存の `/cards` リンク生成箇所を `/items` + `formatItemNumber` に更新（ボード・バックログ・関連・コピー）
5. [x] テスト更新

**Done when:** FE 該当テスト緑。

---

### Task 2: BE API パスと JSON キー

1. [x] `handler.go`: 全 `/api/cards` → `/api/items`、`apply-to-all-cards` → `apply-to-all-items`
2. [x] `model.go`: 公開 JSON `cards`→`items`, `cardIds`→`itemIds`；型名 `Card`→`Item`（および Input/Patch/Order）
3. [x] `history_import.go` 等: 公開 JSON **`cardId`→`itemId`**（DB 列 `card_id` は維持）
4. [x] board/backlog 応答マップキー更新
5. [x] テスト・smoke のパスと JSON キー更新
6. [x] `go test ./internal/kanban/...` 緑

**Done when:** BE テスト緑。

---

### Task 3: 関連 kind `item` + マイグレーション

1. [x] 検証・DDL コメント・INSERT を `item` に
2. [x] 起動時 `UPDATE … SET kind='item' WHERE kind='card'`（冪等）
3. [x] FE `RelatedItem.kind: 'item'`
4. [x] 統合／単体テスト

**Done when:** kind 往復テスト緑。

---

### Task 4: FE API クライアント・モデル・文言

1. [x] `models.ts` `Item`、board の `items`
2. [x] `api.ts` メソッド・パス
3. [x] UI「カード」→「アイテム」、`TASK-`→`formatItemNumber`
4. [x] 全 FE テスト緑

**Done when:** `npm test -- --watch=false` 緑。

---

### Task 5: ファイル・シンボルの Item リネーム

1. [x] `git mv` 主要 `card-*` → `item-*`（detail, autosave, pr-links, related-items, history, assignee, commands…）
2. [x] クラス名 `CardDetail`→`ItemDetail` 等、import 修正
3. [x] セレクタ・providers 更新
4. [x] テスト緑

**Done when:** ビルド・テスト緑、旧ファイル名なし（CSS クラス除く）。

---

### Task 6: ドキュメント

1. [x] README / api.md / verification / smoke
2. [x] 受け入れ条件セルフチェック

**Done when:** 利用者向け docs が `/items`・`ITEM-`・アイテム用語と一致。
