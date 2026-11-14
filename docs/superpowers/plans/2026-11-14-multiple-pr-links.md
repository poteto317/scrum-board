# 複数 GitHub PR 紐付け Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1カードに複数の GitHub PR URL（`prUrls: string[]`）を紐付け、詳細画面から追加・削除できるようにする。

**Architecture:** `card_pr_links` を `(card_id, position)` 複数行へ移行。Card JSON は `prUrl` を廃止し `prUrls` に置換。PATCH は配列全体置換。UI は autosave 外の即時 PATCH。並び替え UI はカード #37（今回対象外）。

**Tech Stack:** Go 1.x / MySQL 8 / Angular 21 / Vitest（`ng test`）

## Global Constraints

- 設計書: `docs/superpowers/specs/2026-11-14-multiple-pr-links-design.md`
- `prUrl` 互換フィールドは残さない（未知フィールドは `DisallowUnknownFields` で 400）
- 配列要素は trim 後・非空・従来 PR URL パターンのみ。空文字要素は 400。全解除は `[]`
- 件数上限なし。同一カード内重複は完全一致で 400 / UNIQUE
- 登録順 = `position` 0..n-1。並べ替え UI なし
- feature / refactor / review ではコミットしない
- 知見: L-018, L-454, L-002, L-038, L-035, L-037, L-040, L-015, L-540, L-456

---

### Task 1: モデル・URL 正規化（Go）

**Files:**
- Modify: `backend/internal/kanban/model.go`
- Modify: `backend/internal/kanban/pr_url.go`
- Modify: `backend/internal/kanban/pr_url_test.go`
- Modify: `backend/internal/kanban/handler_test.go`（memoryRepo の PR フィールド）

**Interfaces:**
- Produces: `Card.PRURLs []string \`json:"prUrls"\``、`CardInput.PRURLs []string`、`CardPatch.PRURLs *[]string`（`PRURL` フィールド削除）
- Produces: `normalizePRURLs([]string) ([]string, bool)` — 各要素 trim、空は失敗、`validPRURL` かつ非空、重複は失敗。成功時は正規化済みスライス（nil ではなく空スライス可）
- Produces: `prURLsJSON([]string) string` — `json.Marshal` のコンパクト配列文字列（履歴用）

- [ ] **Step 1: 失敗するテストを追加**

`pr_url_test.go` に:

```go
func TestNormalizePRURLs(t *testing.T) {
	u1 := "https://github.com/a/b/pull/1"
	u2 := "https://github.com/a/b/pull/2"
	got, ok := normalizePRURLs([]string{"  " + u1 + " ", u2})
	if !ok || len(got) != 2 || got[0] != u1 || got[1] != u2 {
		t.Fatalf("got %v ok=%v", got, ok)
	}
	if _, ok := normalizePRURLs([]string{""}); ok {
		t.Fatal("empty element must fail")
	}
	if _, ok := normalizePRURLs([]string{"  "}); ok {
		t.Fatal("whitespace element must fail")
	}
	if _, ok := normalizePRURLs([]string{u1, u1}); ok {
		t.Fatal("duplicate must fail")
	}
	if _, ok := normalizePRURLs([]string{"https://evil.example/x"}); ok {
		t.Fatal("invalid must fail")
	}
	got, ok = normalizePRURLs(nil)
	if !ok || got == nil || len(got) != 0 {
		t.Fatalf("nil input -> empty slice, got %#v ok=%v", got, ok)
	}
}
```

- [ ] **Step 2: RED を確認**

Run: `cd backend && go test ./internal/kanban/ -run TestNormalizePRURLs -count=1`  
Expected: FAIL（未定義）

- [ ] **Step 3: 実装**

`model.go` で `PRURL string` / `*string` を `PRURLs []string` / `*[]string` に置換（json `prUrls`）。  
`pr_url.go` に `normalizePRURLs` と `prURLsJSON` を追加。`validPRURL("")==true` は evidence 等のため維持し、配列要素では使前に非空を要求。  
`handler_test.go` の memoryRepo を `PRURLs` に合わせる（コピーはスライスのディープコピー）。

空の `Card.PRURLs` は常に非 nil の `[]string{}` になるよう、後続タスクの読取でも保証する（このタスクでは型だけ揃えてもよい）。

- [ ] **Step 4: GREEN**

Run: `cd backend && go test ./internal/kanban/ -run TestNormalizePRURLs -count=1`  
Expected: PASS

（この時点で他テストはコンパイルエラーになりうる。Task 2–4 で解消。コミットしない。）

---

### Task 2: `card_pr_links` スキーマ移行

**Files:**
- Modify: `backend/internal/kanban/pr_link.go`
- Modify: `backend/internal/kanban/pr_link_integration_test.go`（移行ケース追加）

**Interfaces:**
- Consumes: 新 PK `(card_id, position)`、UNIQUE `(card_id, pr_url)`
- Produces: `InitializePRLinks` が旧表（`card_id` PK のみ）を検出し新表へデータを移す（空 URL 行は捨てる）。既に新スキーマなら冪等 no-op

- [ ] **Step 1: 失敗する統合テストを追加**（`KANBAN_TEST_DSN` 無しなら skip 維持）

旧スキーマを手で作ってから `InitializePRLinks` → 新スキーマ＋`position=0` の1行、空 URL が消える、2回呼んでも壊れない、を assert。

- [ ] **Step 2: RED 確認**（DSN 付き）

- [ ] **Step 3: `InitializePRLinks` 実装**

方針:

1. `information_schema` または `SHOW COLUMNS FROM card_pr_links LIKE 'position'` で新スキーマ判定
2. 表が無ければ新 DDL で CREATE
3. 旧表なら: `card_pr_links__new` を新 DDL で作成 → `INSERT ... SELECT card_id, 0, pr_url FROM card_pr_links WHERE pr_url <> ''` → `DROP` 旧 → `RENAME`
4. トランザクションでまとめる（DDL 制約で無理なら手順をコメントし、失敗時に中途半端を検知できるテストを残す）

新 DDL:

```sql
CREATE TABLE IF NOT EXISTS card_pr_links (
  card_id BIGINT NOT NULL,
  position INT NOT NULL,
  pr_url VARCHAR(2048) NOT NULL,
  PRIMARY KEY (card_id, position),
  UNIQUE KEY uq_card_pr_url (card_id, pr_url),
  CONSTRAINT fk_card_pr_links_card FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
```

- [ ] **Step 4: GREEN**（DSN 付き統合テスト）

---

### Task 3: Repository 読取・書込

**Files:**
- Modify: `backend/internal/kanban/repository.go`
- Modify: `backend/internal/kanban/backlog.go`（`cardFields` / attach 利用）
- Modify: `backend/internal/kanban/pr_link_integration_test.go`
- Modify: `backend/internal/kanban/history.go`
- Modify: 関連する history / refined テストの `PRURL` 参照

**Interfaces:**
- Produces: `cardFields` から PR JOIN を外す。`attachPRURLs(ctx, tx/db, []Card) error` が `SELECT card_id, pr_url FROM card_pr_links WHERE card_id IN (...) ORDER BY card_id, position` で埋める。カード0件は no-op。各カードは非 nil `[]string{}`
- Produces: `replacePRURLs(ctx, tx, cardID, urls []string) error` — DELETE その card_id → position 順 INSERT
- CreateCard: `in.PRURLs` を replace。UpdateCard: `p.PRURLs != nil` のときだけ replace（L-454）
- historyValues: `"prUrls": prURLsJSON(c.PRURLs)`。比較フィールドも `prUrls`
- **必須:** `scanCard` した直後（`before := c` の前）と最終再読取の両方で `attachPRURLs`。`history_migration.go` の baseline 読取も同様（JOIN 除去後に `[]` 固定しない）

- [ ] **Step 1: 統合テストを複数 URL 前提に書き換え／追加**

ケース: 2 URL 作成、PATCH で置換・`[]` 解除、省略で保持、他フィールド同時更新で title 維持（L-015）、Board でカードが二重化しない、削除 cascade、履歴 diff が実 URL を記録すること。

- [ ] **Step 2: RED → 実装 → GREEN**

`scanCard` は PR 列なし。Get/Board/Backlog/Create/Update、および `history_migration` baseline で attach。Update: lock → scan → **attach → before := c** → 更新 → 再 scan → attach → appendHistory。cards のみ `FOR UPDATE`（既存コメント維持）。

- [ ] **Step 3: `go test`（ユニット）と DSN 付き統合**

Run: `cd backend && go test ./internal/kanban/ -count=1`  
DSN 付き: README の `KANBAN_TEST_DSN` 例に従う。

---

### Task 4: HTTP ハンドラ

**Files:**
- Modify: `backend/internal/kanban/handler.go`
- Modify: `backend/internal/kanban/pr_link_handler_test.go`

**Interfaces:**
- createCard: `normalizePRURLs(in.PRURLs)`。失敗時既存の PR エラー文言
- updateCard: 空パッチ判定に `PRURLs`。`p.PRURLs != nil` なら normalize して差し替え。`prUrl` キーは未知で 400

- [ ] **Step 1: ハンドラテストを `prUrls` 配列に更新**

例: POST で2件、PATCH で追加相当の全置換、`[]` 解除、`[""]` は 400、重複 400、`{"prUrl":"..."}` は 400、省略で保持。

- [ ] **Step 2: RED → 実装 → GREEN**

Run: `cd backend && go test ./internal/kanban/ -run 'PR|pr' -count=1`

---

### Task 5: 履歴インポート検証

**Files:**
- Modify: `backend/internal/kanban/history_import.go`
- Modify: `backend/internal/kanban/history_import_test.go`
- Modify: `backend/internal/kanban/history_integration_test.go`（期待フィールド `prUrls`）
- Modify: `backend/internal/kanban/history_migration.go`（フィールド名）

**Interfaces:**
- `validHistoricalRecord`: `prUrl` case 削除、`prUrls` は (1) before/after 各 len ≤ 65536、(2) JSON 配列、(3) 各要素 string かつ非空 valid PR URL（空配列可）、(4) ネスト/null 拒否
- RuneCount 上限ではなく **byte 長** 65536（仕様どおり ASCII バイト）

- [ ] **Step 1: テスト追加**（65536 境界、旧 `prUrl` 拒否、不正 JSON、null 要素）

- [ ] **Step 2: 実装 → GREEN**

Run: `cd backend && go test ./internal/kanban/ -run History -count=1`

---

### Task 6: フロント（モデル・autosave・詳細 UI）を一括変更

Task 6 単独では `prUrl` フォームが残るとコンパイルできないため、モデル・autosave・詳細 UI・関連 spec を同じタスクで完了させる。

**Files:**
- Modify: `frontend/src/app/models.ts`
- Modify: `frontend/src/app/card-autosave.ts` / `card-autosave.spec.ts` / `card-autosave-routing.spec.ts`
- Modify: `frontend/src/app/card-detail.ts` / `.html` / `.css` / `.spec.ts`
- Modify: fixtures in `board.spec.ts`, `backlog.spec.ts`, `backlog-order.spec.ts` など全 `prUrl: ''` → `prUrls: []`
- Modify: `frontend/src/app/pr-url.ts`（必要なら非空ヘルパ）

**Interfaces:**
- `Card.prUrls: string[]`、`CardInput` Partial も `prUrls`
- autosave `fields` から `prUrl` 削除（title/description/columnId のみ）
- 入力用 `FormControl`（detail ローカル）+ `addPrUrl()` / `removePrUrl(index)`
- PATCH: `api.updateCard(id, { prUrls: next })` + `takeUntil(this.changed$)` + `takeUntilDestroyed`
- 失敗時一覧維持。成功時は draft を潰さず `prUrls`（と必要なら card メタ）だけ反映
- ラベル文言: **「GitHub PR（任意）」**

- [ ] **Step 1: 失敗する UI / autosave テストを新仕様向けに書き換え**

旧 `prUrl` autosave / blur ケースは削除または add/remove PATCH に置換。追加: 一覧2件・入力クリア、削除、不正で PATCH 無し、失敗で一覧維持、遷移後の遅い応答が別カードに載らない、autosave が `prUrls` を送らない。

- [ ] **Step 2: モデル・autosave・詳細 UI を実装**

- [ ] **Step 3: GREEN**

```bash
cd frontend && npx ng test --watch=false --include=src/app/card-autosave.spec.ts
cd frontend && npx ng test --watch=false --include=src/app/card-detail.spec.ts
cd frontend && npm run build
```

---

### Task 7: 履歴表示

**Files:**
- Modify: `frontend/src/app/card-history.ts`
- Modify: `frontend/src/app/card-history.html`
- Modify: `frontend/src/app/card-history.spec.ts`

**Interfaces:**
- `labels.prUrls = 'GitHub PR'`（`prUrl` ラベルも残す）
- `details` の open 条件に `prUrls` を追加
- `prUrls` の before/after が JSON 配列なら要素ごとにリンク（`validPrUrl`）、パース失敗時は従来の `<pre>` テキスト
- 旧 `prUrl` 単一文字列も従来どおり表示（リンク化は evidence と同条件で任意）

- [ ] **Step 1: テスト → 実装 → GREEN**

Run: `cd frontend && npx ng test --watch=false --include=src/app/card-history.spec.ts`

---

### Task 8: ドキュメントと全体検証

**Files:**
- Modify: `docs/api.md`
- Modify: `README.md`（1カード1 URL の記述）
- Modify: `scripts/smoke.py`（`prUrl` → `prUrls`）があれば同様に更新

- [ ] **Step 1: API/README（と smoke）を `prUrls` に更新**

curl 例、省略/`null` 保持、`[]` 全解除、空要素・重複 400、件数上限なし、登録順。履歴インポートの `prUrls`（65536 バイト JSON 配列・非空 URL 要素）も `docs/api.md` に反映。

- [ ] **Step 2: 全体検証**

```bash
cd backend && go vet ./... && go test -race -count=1 ./...
cd frontend && npm test -- --watch=false && npm run build
```

DSN 付き統合も可能なら実施。失敗があれば修正してから次工程へ。

- [ ] **Step 3: コミットしない**（`/commit-ja` 待ち）

---

## Self-review（プラン作成時）

| Spec 要件 | Task |
|-----------|------|
| `prUrls` 置換・`prUrl` 廃止 | 1, 4, 6 |
| 上限なし・重複拒否・空要素 400 | 1, 4 |
| position / 移行 / FOR UPDATE / attach before history | 2, 3 |
| UI 追加削除・L-040 | 6 |
| 履歴 live + import | 3, 5, 7 |
| docs / smoke | 8 |
| 並び替え UI | 対象外（#37） |
