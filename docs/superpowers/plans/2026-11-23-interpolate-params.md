# InterpolateParams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or executing-plans.

**Goal:** `mysqlconfig` と統合テスト接続で `InterpolateParams` を有効にし、統合テストを通す。

**Architecture:** `ApplyStandardDriverFlags` を `FromDBEnv` / `ForCLI` Import / `mysqlTestDB` で共有。**`ForServer` はコード変更なし**（`FromDBEnv` 波及）。`import-history` は触らない。`MultiStatements` はテスト用のまま。

**Tech Stack:** Go, go-sql-driver/mysql

**Spec:** `docs/superpowers/specs/2026-11-23-interpolate-params-design.md`

**知見:** L-1084 N/A、L-777 N/A。

---

## File map

| File | Responsibility |
|---|---|
| `backend/internal/mysqlconfig/config.go` | `ApplyStandardDriverFlags`；`FromDBEnv` / `ForCLI` Import から呼ぶ |
| `backend/internal/mysqlconfig/config_test.go` | 標準フラグ assert |
| `backend/internal/kanban/mysql_test.go` | `mysqlTestDB` で `ApplyStandardDriverFlags` |

---

### Task 1: mysqlconfig

- [x] `FromDBEnv` で `cfg.InterpolateParams = true`
- [x] `ForCLI` の `KANBAN_IMPORT_DSN` 分岐でも同様
- [x] `TestFromDBEnv_*` / `TestForCLI_ImportDSN` で `InterpolateParams` を assert（DB_* フォールバックは FromDBEnv テストでカバー）

```bash
cd backend && go test ./internal/mysqlconfig/ -count=1 -race
```

### Task 2: 統合テスト接続

- [x] `mysqlTestDB` に `cfg.InterpolateParams = true`（`MultiStatements=true` は維持・触らない）
- [x] `KANBAN_TEST_DSN` 付きで `./internal/kanban/` を実行。**`TestMySQLActivateSprintConcurrent` は既知フレークのため skip**（本変更と無関係）。
- [x] 失敗時は JSON / 履歴 import（`TestMySQLImportWorksWithInterpolatedParams` 含む）を優先確認。（Import 経路 GREEN。履歴 baseline の archivedAt 期待ずれは既知フレークで本変更無関係）

```bash
cd backend && KANBAN_TEST_DSN='scrum:scrum_dev@tcp(127.0.0.1:3307)/scrumboard_numbering_test?parseTime=true' \
  go test ./internal/kanban/ -count=1 -skip 'TestMySQLActivateSprintConcurrent'
```

### Task 3: コミットしない（`/feature` 中）

---

## レビュー記録

- 第 1 周（要件対応）: 未実装は Task として残す。skip 理由・JSON 重点・mysqlconfig `-race` を追記。
- 第 2 周（タスク整合）: ForServer 波及・MultiStatements 維持・race を Task1 へ。設計受け入れに skip 例外を追記。
