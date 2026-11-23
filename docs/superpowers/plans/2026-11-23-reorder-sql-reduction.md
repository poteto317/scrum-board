# Reorder SQL 削減 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or executing-plans. Checkbox steps for tracking.

**Goal:** `PUT /api/items/order` の SQL をカード数 n に比例させない（権限 GetItem×n・ロック後 scanCard×n・行ごと UPDATE×n を除去／定数化）。全列ロックと既存並行テストは維持。

**Architecture:** Handler は expand 済み map で `CanEdit`。Repository は単一 FOR UPDATE SELECT（最小列）＋ CASE バッチ UPDATE（最大 2 文）＋必要時のみ履歴。

**Tech Stack:** Go MySQL、既存 `planCardReorder` / `card_lock_integration_test`。

**Spec:** `docs/superpowers/specs/2026-11-23-reorder-sql-reduction-design.md`

**知見:** デッドロックは `lockColumnRows` 先行。L-775 は N/A（サーバのみ）。

---

## File map

| File | Responsibility |
|---|---|
| `item_acl_handler.go` | `expandItemOrdersWithHidden` が `map[id]Item` を返す；`requireEditOnLoadedItems` |
| `handler.go` | `reorderItems` が新戻り／新ヘルパを使う |
| `card_order.go` | `lockCardsInColumns` 単一 SELECT；バッチ UPDATE |
| `card_order_query_count_integration_test.go`（新） | クエリ数 n=20/80（TX 内・listOrderedCards/履歴除外） |
| 既存 `*_test.go` | 履歴・デッドロック・Handler GetItem 非呼び出し |

---

### Task 1: 権限をメモリ ACL に

- [x] `expandItemOrdersWithHidden` の戻りを `(expanded []ItemColumnOrder, submitted []int64, byID map[int64]Item, err error)` に拡張（caller は `reorderItems` のみ）。**hidden マージ挙動は維持**。
- [x] `requireEditOnLoadedItems` 実装（map 欠落は skip→repo の 409、CanEdit 失敗は既存応答、ACL 再取得なし）。
- [x] `reorderItems` から `requireEditOnItemIDs` を外す（他 callers は従来のまま）。
- [x] Handler テスト: 並べ替え経路で GetItem が呼ばれない／編集不可は拒否。JSON/OpenAPI は変更なし。

```bash
cd backend && go test ./internal/kanban/ -count=1 -run 'ACL|Reorder|ItemOrder'
```

### Task 2: ロック読込を 1 文に

- [x] `lockCardsInColumns` を最小列の単一 `SELECT … FOR UPDATE` に変更。per-id `scanCard` / attachPR / attachRelated を削除。結果を履歴用 `before` スナップショットとしてメモリ保持（DB 再読なし）。
- [x] 成功応答の `listOrderedCards`（全文+PR/関連）は現状維持。
- [x] 既存 PR links / reorder / updated_at（位置のみ不変）統合テスト GREEN。

```bash
cd backend && go test ./internal/kanban/ -count=1 -run 'Reorder|PRLink|Lock|UpdatedAt'
```

### Task 3: バッチ UPDATE

- [x] `planCardReorder` は **判定専用のまま**（単体テストは現形）。`ReorderItems` が plan 結果を集め、CASE 用 SQL を別に組み立てる（判定と SQL 生成を分離）。
- [x] 非スキップ行を列変更なし／ありで分け、CASE バッチ（各最大 1 文）。
- [x] 列変更のみ `appendHistory`（行ごと可）。

### Task 4: クエリ数・履歴・デッドロック検証

- [x] 同一列 reverse、n=20 と n=80。計測は **`ReorderItems` 内のロック〜バッチ UPDATE まで**（expand の Board/ACL、`listOrderedCards`、履歴 INSERT は含めない）。`|Δ|≤5`・上限 40。
- [x] 列移動 1 件の履歴 status 変化。位置のみの `updated_at` 不変は既存統合で確認。
- [x] `TestCardWritesDoNotDeadlockMySQL` と全列ロック待ち系（`card_lock_integration_test` / `docs/verification.md`）GREEN。

```bash
cd backend && go test ./internal/kanban/ -count=1
```

### Task 5: コミットしない（`/feature` 中）

---

## レビュー記録

- 第 1 周（要件との対応）: 計測スコープ・hidden/409・位置のみ updated_at・デッドロック列挙を Task に明示。
- 第 2 周（タスク整合）: expand 戻り順、planCardReorder とバッチの責務分離、クエリ計測から listOrderedCards/履歴除外、テストファイル名を固定。
