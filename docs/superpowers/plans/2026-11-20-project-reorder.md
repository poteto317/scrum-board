# プロジェクト並び替え・管理ページ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/projects` 管理ページと `PUT /api/projects/order` を追加し、ハンバーガーからプロジェクト CRUD・並び替えできるようにする（ヘッダー切替セレクトは維持）。

**Architecture:** 列の `ReorderColumns` と同型の全 ID 順列 API を追加。FE は `ProjectSession.reorder` + `ProjectsPage`（users ページ型）で DnD/キーボード並びと CRUD。カタログは `open_projects` に差し替え（FE/BE/`docs/api.md` 同期）。App のプロジェクトモーダル・メニュー emit は削除してページへ移管。

**Tech Stack:** Go (MySQL)、Angular 21、CDK drag-drop、Vitest / Go testing

**Spec:** `docs/superpowers/specs/2026-11-20-project-reorder-design.md`

## Global Constraints

- `/feature` 中は **コミットしない**（コミット Step は実行しない）。
- 知見: L-001, L-044, L-408, L-460, L-476, L-515, L-901。
- 並び替えは **全プロジェクト ID** のみ（部分配列 persist 禁止）。
- カタログ変更は FE + BE + `docs/api.md` を同じタスクで揃える。
- 検証: 変更したパッケージの Go テスト、関連 Vitest。通るまで次タスクへ進まない。

## File map

| Path | Responsibility |
|------|----------------|
| `backend/internal/kanban/project_order.go` (+ tests) | `ReorderProjects` / 検証 / ロック |
| `backend/internal/kanban/project_handler.go` / `handler.go` / `model.go` | `PUT /api/projects/order` |
| `backend/internal/kanban/header_menu.go` (+ handler tests) | カタログ ID 差し替え |
| `docs/api.md` | order API + カタログ記述 |
| `frontend/src/app/api.ts` (+ spec) | `reorderProjects` |
| `frontend/src/app/project-session.ts` (+ spec) | `reorder` |
| `frontend/src/app/header-menu.ts` / `.component.*` / specs | `open_projects`、旧 `project_*` 削除 |
| `frontend/src/app/projects.ts/html/css` (+ spec) | 管理ページ |
| `frontend/src/app/app.routes.ts` | `/projects` |
| `frontend/src/app/app.ts/html` (+ spec) | モーダル・CRUD・メニュー配線削除 |
| `frontend/src/app/header-menu.ts` `resolvePageKind` | `/projects` → null |

---

### Task 1: Backend `ReorderProjects` + HTTP

**Files:**
- Create: `backend/internal/kanban/project_order.go`
- Create: `backend/internal/kanban/project_order_handler_test.go`（必要なら integration）
- Modify: `backend/internal/kanban/model.go`（`ErrProjectOrder` 400 用、`ErrProjectMismatch` 409 用、`Repository.ReorderProjects` — 列の `ErrColumnOrder` / `ErrColumnMismatch` と同型）
- Modify: `backend/internal/kanban/http_transport.go`（`ErrProjectOrder`→400、`ErrProjectMismatch`→409）
- Modify: `backend/internal/kanban/validation.go`（`validateProjectOrder` → `ErrProjectOrder`）
- Modify: `backend/internal/kanban/project_handler.go` または `handler.go`（`PUT /api/projects/order`）
- Modify: `backend/internal/kanban/handler_test.go`（`memoryRepo.ReorderProjects`）
- Modify: `docs/api.md`（projects order 節）

**Interfaces:**
- Produces: `ReorderProjects(ctx, []int64) ([]Project, error)`；HTTP body `{ "projectIds": number[] }` → `{ "projects": Project[] }`

- [x] **Step 1:** `validateProjectOrder` と mismatch 時の failing handler/repo テストを書く。handler 検証は `column_order_handler_test.go` の `TestReorderColumnsValidationAndConflict` 相当を `projectIds` に写す（空配列・重複・欠落・未知 ID・`null`/非配列・0/負数 ID・malformed JSON → 400、集合不一致 → 列と同 status、成功 200。L-044）。
- [x] **Step 2:** テストを実行し失敗を確認。
- [x] **Step 3:** `ReorderProjects` を列実装に倣って実装（`FOR UPDATE` → 集合一致 → position 更新 → 一覧返却）。ルート登録は認証付き他 project API と同列（L-901）。
- [x] **Step 4:** `go test ./internal/kanban/ -count=1`（該当パッケージ）を通し、`docs/api.md` に API を追記。

---

### Task 2: Header menu catalog sync (FE + BE + docs)

**Files:**
- Modify: `backend/internal/kanban/header_menu.go`
- Modify: `backend/internal/kanban/header_menu_handler_test.go`（`project_add` 前提のケースを `open_projects` / 旧 ID 除去へ更新）
- Modify: `frontend/src/app/header-menu.ts` / `header-menu.spec.ts`
- Modify: `frontend/src/app/header-menu.component.ts` / `.spec.ts`（`open_projects` navigate、`project_*` case / inputs/outputs 削除）
- Modify: `frontend/src/app/app.ts` / `app.html`（**同一 Task 内**で HeaderMenu の `(addProject)` 等バインディングと関連 `@Input` 渡しを削除。CRUD UI の ProjectsPage 移管本体は Task 4。中間でコンパイルが壊れないこと）
- Modify: `docs/api.md` カタログ ID 行

**Interfaces:**
- Produces: catalog id `open_projects`（board/backlog/itemDetail）。Removes `project_add|rename|delete`。
- Consumes: router `/projects`（ページは Task 4）

- [x] **Step 1:** FE/BE カタログ差し替えの failing テストを更新・追加（L-515: ラベル「プロジェクト」）。
- [x] **Step 2:** 実装。`resolvePageKind` に `/projects` → null。`actionDisabled` は `open_users` と同型。**同じ変更セットで** `app.html` / component の project CRUD 配線を外す（Task 3 単独完了をビルド検証条件にしない。App のモーダル削除と ProjectsPage は Task 4）。
- [x] **Step 3:** 関連 Go / Vitest を通す。`docs/api.md` のカタログ行を更新（例: board/backlog/itemDetail に `open_projects`, `open_trash`, `open_users` 等。item 系は従来どおり）。

---

### Task 3: `Api.reorderProjects` + `ProjectSession.reorder`

**Files:**
- Modify: `frontend/src/app/api.ts` / `api.spec.ts`
- Modify: `frontend/src/app/project-session.ts`
- Create or Modify: `frontend/src/app/project-session.spec.ts`（無ければ追加）

**Interfaces:**
- Produces: `Api.reorderProjects(projectIds: number[]): Observable<{ projects: Project[] }>`
- Produces: `ProjectSession.reorder(projectIds: number[]): Observable<Project[]>` — busy/不正は `EMPTY`；**API 飛行中は `mutating=true`**、成功・失敗で `false`；成功時のみ `projects` 更新；失敗は error set + rethrow（再 load しない）

- [x] **Step 1:** API・session の failing テスト（成功更新、失敗で list 不変、`switching`/`mutating` で EMPTY、**不正 ID 列**で EMPTY かつ API 未呼び出し、飛行中 `mutating` と他操作の EMPTY）。
- [x] **Step 2:** 実装（L-001, L-044, L-476）。不正列の判定は呼び出し前に `projects()` の ID 集合と照合。飛行中は `mutating` を立てる。
- [x] **Step 3:** 関連 Vitest を通す。

---

### Task 4: `ProjectsPage`（CRUD + DnD + キーボード）

**Files:**
- Create: `frontend/src/app/projects.ts` / `projects.html` / `projects.css` / `projects.spec.ts`
- Modify: `frontend/src/app/app.routes.ts`
- Modify: `frontend/src/app/app.ts` / `app.html` / `app.spec.ts`（モーダル・add/rename/delete・HeaderMenu project emits / projectModal* / canRename|canDelete inputs 削除。select の `projectModalOpen` 依存を外す）
- Modify: `frontend/src/app/header-menu.component.ts`（project CRUD 用 `@Input`/`@Output` が残っていれば削除）

**Interfaces:**
- Consumes: `ProjectSession.create|rename|delete|reorder|canDelete`、`Api` 不要なら session のみ
- Produces: `/projects` で追加モーダル・prompt 改名・confirm 削除・DnD/↑↓ 並び（`event.repeat` 無視）

- [x] **Step 1:** `app.routes.ts` に `path: 'projects'`, `loadComponent` → `ProjectsPage`, **`canActivate: [authGuard]`**（`users` と同型）。ルート + 空ページ + `open_projects` 遷移の failing テスト。未認証は他認証ルートと同様 `authGuard` に委ねる（専用 E2E は必須としないが、ルート定義にガードがあることを spec または routes テストで固定してよい）。
- [x] **Step 2:** users に倣った一覧 UI、追加モーダル（App から移管）、rename prompt、delete confirm。**1 件のみのとき削除 UI 無効**（`canDelete` / `projects.spec.ts` で明示）。削除は confirm 前にキーリピートを無視するガードを App から移管または同等実装（L-408。spec で `event.repeat` 時に confirm も delete も走らないことを固定）。
- [x] **Step 3:** CDK DnD + キーボード上下 → 楽観 UI → `reorder`。HTTP 失敗で戻す。`EMPTY` 時は成功扱いしない。キーボードは `event.repeat` 無視（L-408, L-460）。
- [x] **Step 4:** `app.spec` の project_add/delete 系を削除または ProjectsPage へ移し、L-001（create→switchTo→endMutating / switch 失敗 / EMPTY）を維持。
- [x] **Step 5:** 関連 Vitest を通す。`cd frontend && npm test -- --watch=false` で本変更起因を確認（既知の main 失敗は本タスク範囲外なら記録して続行判断）。

---

### Task 5: 通し検証・設計整合

- [x] **Step 1:** `cd backend && go test ./internal/kanban/ -count=1`
- [x] **Step 2:** フロント関連 spec（projects / project-session / header-menu / api / app）を実行。
- [x] **Step 3:** 設計書受け入れ条件 1–5 をチェックリストで突合し、漏れがあれば最小修正。

**Commit:** `/feature` では行わない（後続 `/commit-ja`）。

## 知見チェック（プラン反映）

| ID | プランでの扱い |
|----|----------------|
| L-001 | Task 3–4: 成功時のみ list 更新、失敗ロールバック、create/switch 失敗を成功扱いしない |
| L-044 | Task 1: 不正 order は 400 |
| L-408 | Task 4: `event.repeat`、confirm リピート |
| L-460 | Task 1/4: 全 ID のみ |
| L-476 | Task 3: session/Api 経由 |
| L-515 | Task 2: ラベル「プロジェクト」 |
| L-901 | Task 1: order を認証付き同列登録 |
