# プロダクトバックログ 実装計画

> コミットは `/commit-ja` まで禁止。設計書: [2026-11-14-product-backlog-design.md](../specs/2026-11-14-product-backlog-design.md)

**Goal:** `/backlog` で全カードを縦並び優先順位リストとして表示・並び替え・新規追加する。

**Architecture:** `cards.backlog_position` + `GET/PUT /api/backlog`。UI は HTML5 DnD（列並び替えと同型）。作成は既存 `POST /api/cards`。

## Task 1: DB・API

- schema + `InitializeBacklogPositions` + `main.go`
- `Card.BacklogPosition`, `Backlog`, `ReorderBacklog`, CreateCard で末尾採番（採番ロック → cards `ORDER BY id FOR UPDATE` → INSERT）
- Handler + tests + integration

## Task 2: フロント

- `api.ts` backlog / reorderBacklog
- `backlog-order.ts` 純粋関数 + spec
- `backlog` コンポーネント（一覧・DnD・キー・作成モーダル）
- routes + app.html ナビ
- board との導線

## Task 3: docs + 検証

- api.md, README, verification.md
- go test / npm test / build
