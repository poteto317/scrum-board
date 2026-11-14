# カード対応者ラベル実装プラン

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. **`/feature` 実行中はコミットしない。**

**Goal:** カードに単一の対応者ラベル（Cursor/Claude/Codex/Antigravity または自由テキスト）を付け、ボード・詳細・API・履歴・task-start から扱えるようにする。

**Architecture:** `cards.assignee` 列＋起動時マイグレーション。正規化ヘルパー。`PATCH .../by-number/{n}/assignee`。FE はチップ UI。dev-flow-kit の task-start は別 PR。

**Tech Stack:** Go / MySQL / Angular 21 / Vitest

**Spec:** `docs/superpowers/specs/2026-11-14-card-assignee-design.md`

## Global Constraints

- 単一 assignee。プリセット 4＋自由テキスト。未設定は `""`。
- L-035 / L-454 / L-456 / L-781 / L-001 / L-059。
- `/feature` のためコミットしない。

## File Map

| ファイル | 責務 |
| --- | --- |
| `backend/internal/kanban/assignee.go` | 正規化・検証 |
| `backend/internal/kanban/assignee_migrate.go` | InitializeAssignee |
| `backend/internal/kanban/assignee_handler.go` | by-number PATCH |
| model/repository/history/handler/main/schema | assignee 列の読み書き |
| `frontend/.../assignee.ts` | プリセット定数・表示 |
| board / card-detail / card-history / api / models | UI・API |
| docs/api.md, README, smoke | ドキュメント |
| `~/Desktop/dev-flow-kit/commands/task-start.md` | エージェント手順（別コミット可・本フロー内で実施） |

---

### Task 1: BE 正規化＋モデル＋マイグレーション＋永続化

- [x] assignee.go（NormalizeAssignee）
- [x] model に Assignee
- [x] schema + InitializeAssignee + main
- [x] scanCard / INSERT / UPDATE
- [x] historyValues に assignee
- [x] テスト

### Task 2: BE HTTP

- [x] create/update で assignee 検証
- [x] PATCH by-number/.../assignee
- [x] handler テスト

### Task 3: FE

- [x] models + api + assignee.ts
- [x] detail チップ UI
- [x] board チップ
- [x] history labels
- [x] テスト

### Task 4: docs + smoke + task-start

- [x] docs/api.md, README
- [x] smoke.py
- [x] dev-flow-kit task-start

### Task 5: 全体検証

- [x] go test / ng test 関連
