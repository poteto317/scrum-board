# Batch position / backlog UPDATE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or executing-plans. Checkbox steps for tracking.

**Goal:** `compactColumnPositions` と `ReorderBacklog` の行ごと UPDATE を定数化し、`updated_at` 不変とデッドロック規約を維持する。

**Architecture:**
- **compact:** 列内 `SELECT id` 1 文 ＋ スキャン順の全 id を CASE（最大 1 Exec・空なら 0）。稠密目標は index（0..n-1）。現値比較不要（現行ループと同等の結果）。
- **backlog:** `lockColumnRows` → 集合照合（`lockProjectCards`）→ **現値用** `SELECT id, backlog_position … FOR UPDATE` → CASE。ロック読込は「1 文」ではなく二段。
- 計測は経路別フック（L-1084）。`resolvedActiveProjectID` 内 SQL は #115 同様 **計測に含める**（`lockColumnRows` 直後〜CASE）。

**Tech Stack:** Go MySQL、既存 `card_lock_integration_test` / backlog 統合。

**Spec:** `docs/superpowers/specs/2026-11-23-batch-position-updates-design.md`

**知見:** L-1084、L-777。L-1083 N/A。

---

## File map

| File | Responsibility |
|---|---|
| `card_position.go` | `compactColumnPositions` CASE；`buildCompactPositionBatchSQL`（#115 `buildCardReorderBatchSQL` 対称） |
| `backlog.go` | ReorderBacklog: `lockProjectCards` 後に現値 SELECT ＋ CASE；`countBacklogReorderMeasuredSQL` を `lockColumnRows`〜CASE の各 Query/Exec に挿入（`listBacklogCards` 外） |
| `position_update_observe.go`（新） | `noteCompactMeasuredSQL` / `countCompactMeasuredSQL`；`noteBacklogReorderMeasuredSQL` / `countBacklogReorderMeasuredSQL`（#115 observe 同型） |
| `card_position_query_count_integration_test.go`（新） | `TestCompactColumnPositionsQueryCountNearConstantMySQL` |
| `backlog_query_count_integration_test.go`（新） | `TestReorderBacklogQueryCountNearConstantMySQL` |
| 既存統合 | updated_at・順序・デッドロック GREEN |

---

### Task 1: compactColumnPositions を CASE 化

- [x] 列内 `SELECT id … ORDER BY position,id FOR UPDATE`（1）→ スキャン順 i を目標 position とし、全行を CASE に載せるか変化判定は不要（id のみ）。スキップのみなら Exec 0。`updated_at=updated_at`。
- [x] シグネチャ維持。`repository.go` は触らない。
- [x] 主検証: `TestStatusChangeCompactsSourceColumnInPositionOrderMySQL` GREEN。

```bash
cd backend && go test ./internal/kanban/ -count=1 -run 'StatusChangeCompacts'
```

### Task 2: ReorderBacklog を CASE 化

- [x] `lockProjectCards` **非改変**。続けて **別クエリ** `SELECT id, backlog_position … ORDER BY id FOR UPDATE`（計測に含める）。
- [x] 変化行のみ CASE（最大 1）。フック: `lockColumnRows`・resolvedActive 内 SQL・`lockProjectCards`・現値 SELECT・CASE の各成功後に `countBacklogReorderMeasuredSQL()`（#115 挿入点に倣う）。`listBacklogCards` はフック無し。
- [x] `TestMySQLBacklogReorderPreservesUpdatedAt`・既存 backlog 統合 GREEN。

```bash
cd backend && go test ./internal/kanban/ -count=1 -run 'Backlog'
```

### Task 3: クエリ数・デッドロック検証

- [x] `TestCompactColumnPositionsQueryCountNearConstantMySQL`: 列1に n+1 枚→1 枚を列2へ UpdateItem。計測は compact 内のみ。残 n=20/80、`|Δ|≤5`・上限 40。
- [x] `TestReorderBacklogQueryCountNearConstantMySQL`: プロジェクトにアクティブ n 枚シード→全 ID reverse で ReorderBacklog。計測は Task2 フック区間。同基準。
- [x] `TestCardWritesDoNotDeadlockMySQL`・`TestCardWritersQueueOnTheAllColumnsLockMySQL`・`card_lock_integration_test` GREEN。

```bash
cd backend && go test ./internal/kanban/ -count=1 -run 'QueryCount|Deadlock|QueueOnTheAllColumns|CardWrites|StatusChangeCompacts'
```

### Task 4: コミットしない（`/feature` 中）

---

## レビュー記録

- 第 1 周（要件対応）: backlog 二段読込・compact フィクスチャ・フックファイル名・Task1 検証コマンドを明記。
- 第 2 周（タスク整合）: Architecture を経路別二段に修正、observe count* 対称、QueryCount テスト名固定、計測境界に resolvedActive を含める、compact は id のみ稠密 CASE。
