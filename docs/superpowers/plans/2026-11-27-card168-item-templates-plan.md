# アイテムテンプレート（#168）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プロジェクト単位のアイテムテンプレート（title/description 雛形）を CRUD し、ボード／バックログの作成ダイアログで選んで雛形入り作成できるようにする。

**Architecture:** `item_templates` テーブル + HTTP CRUD（`?projectId=`）。GET 時に 0 件なら seed 2 件を TX 挿入。FE は `Api` ラッパと作成ダイアログ内のセレクト／管理パネル（管理者のみ）。アイテム作成 API は変更せず、クライアントが埋めた title/description を送る。

**Tech Stack:** Go（MySQL / memory repo）、Angular standalone、Vitest、OpenAPI。

**Spec:** `docs/superpowers/specs/2026-11-27-card168-item-templates-design.md`

## Global Constraints

- `projectId` クエリ必須（L-934）。未知 JSON キー 400（既存 `decode`）。
- seed 失敗は 5xx（空 200 禁止・L-002）。
- 文字数: name 1–60、titleTemplate 1–200、descriptionTemplate 0–10000（L-858）。
- 書込は `requireAdmin`。一覧は認証済み。
- FE の item 追加とテンプレ CRUD は同一 `saving` で相互ブロック（L-653）。
- feature ステップではコミットしない（後続 `commit-ja`）。
- 範囲外: 変数置換・DnD・AI 経路・`templateId` create（#190–#193）。

## File map

| File | Responsibility |
|--|--|
| `backend/internal/kanban/item_template_migrate.go` | `CREATE TABLE IF NOT EXISTS item_templates` |
| `backend/internal/kanban/item_template.go` | 型・Input/Patch・Normalize*・seed 定数 |
| `backend/internal/kanban/item_template_repo.go` | MySQL List/Create/Update/Delete + EnsureSeeds（L-048 分割） |
| `backend/internal/kanban/model.go` | Repository iface 追記 |
| `backend/internal/kanban/handler_test.go` | `memoryRepo` 実装 |
| `backend/internal/kanban/item_template_handler.go` | HTTP handlers + failItemTemplate |
| `backend/internal/kanban/handler.go` | ルート登録 |
| `backend/cmd/server/main.go` | `InitializeItemTemplates` |
| `backend/internal/kanban/item_template_*_test.go` / `mysql_test.go` | API / seed / ACL / migrate テスト |
| `docs/openapi.yaml` | paths + schema |
| `frontend/src/app/item-template.ts` | 型・文言定数・apply helper |
| `frontend/src/app/api.ts` | list/create/update/delete |
| `frontend/src/app/board.ts` / `.html` | セレクト・管理 UI |
| `frontend/src/app/backlog.ts` / `.html` | 同上 |
| `frontend/src/app/board.spec.ts` / `backlog.spec.ts` | 配線・適用・admin・loadError |

---

### Task 1: DB migrate + domain + repository

**Files:**
- Create: `backend/internal/kanban/item_template_migrate.go`
- Create: `backend/internal/kanban/item_template.go`
- Create: `backend/internal/kanban/item_template_repo.go`
- Modify: `backend/internal/kanban/model.go`（Repository iface）
- Modify: `backend/internal/kanban/handler_test.go`（memoryRepo）
- Modify: `backend/cmd/server/main.go`（`InitializeItemTemplates`）
- Modify: `backend/internal/kanban/mysql_test.go`（migrate 呼び出しがあれば追記）
- Test: `backend/internal/kanban/item_template_repo_test.go`（memory）

- [ ] **Step 1:** 型（json タグ付き。command_template と同型）:

```go
type ItemTemplate struct {
  ID                   int64  `json:"id"`
  ProjectID            int64  `json:"projectId"`
  Name                 string `json:"name"`
  TitleTemplate        string `json:"titleTemplate"`
  DescriptionTemplate  string `json:"descriptionTemplate"`
  Position             int    `json:"position"`
}
type ItemTemplateInput struct {
  Name, TitleTemplate, DescriptionTemplate string // json tags
}
type ItemTemplatePatch struct {
  Name, TitleTemplate, DescriptionTemplate *string
}
```

`NormalizeItemTemplateName/Title/Description` — `utf8.ValidString`・RuneCount・制御文字拒否（`NormalizeCommandTemplate*` に揃える。L-048/L-858）。desc は空文字可（改行は制御文字扱いしない／改行は許可する例外を明示）。

- [ ] **Step 2:** seed 定数（バグ報告 / 調査タスク）。description は実改行。position 0 と 1。`InitializeItemTemplates` を main の migrate チェーンへ。
- [ ] **Step 3:** `EnsureItemTemplateSeeds(ctx, projectID)` — TX 内 COUNT==0 なら 2 INSERT。並行呼び出しで二重にならないこと（memory でも mutex / 直列）。**並行 EnsureSeeds の回帰テストを書く。**
- [ ] **Step 4:** List（position ASC, id ASC）、Create（max position+1）、Update、Delete（project 不一致は NotFound）。
- [ ] **Step 5:** `go test ./internal/kanban/ -count=1 -run ItemTemplate` GREEN。

---

### Task 2: HTTP handlers + OpenAPI

**Files:**
- Create: `backend/internal/kanban/item_template_handler.go`
- Create: `backend/internal/kanban/item_template_handler_test.go`
- Modify: `backend/internal/kanban/handler.go`（mux）
- Modify: `docs/openapi.yaml`（`/api/item-templates`・`/{id}`）

- [ ] **Step 1:** `optionalQueryProjectID` で取得し、**省略時は 400**（必須）。存在しない ID は `failProject(w, ErrNotFound)` で 404（`project_handler` と同契約）。
- [ ] **Step 2:** GET → EnsureSeeds → List → `{templates:[...]}` camelCase JSON。
- [ ] **Step 3:** POST admin: `ItemTemplateInput` → 201 単体。PATCH `ItemTemplatePatch` 200。DELETE 204。repo `ErrNotFound` は `failItemTemplate` で 404（他 project の id 含む）。
- [ ] **Step 4:** テスト（設計テスト節と同期）:
  - 空 project GET → 2 seed（本文が定数と一致）
  - 既存 1 件 GET → 増えない
  - seed 失敗注入 → 5xx（空 200 禁止）
  - 非 admin POST → 403 / 未認証 → 401 / 存在しない projectId → 404
  - 他 project の id PATCH/DELETE → 404
  - 空 name・title 201・desc 10001・未知キー・PATCH `{}`・PATCH `position` → 400
  - POST に `position` を付けても保存値はサーバ採番（クライアント値と一致しない）
  - projectId 省略 → 400
  - アイテム作成→テンプレ DELETE→アイテム GET で本文不変（受入4）
- [ ] **Step 5:** OpenAPI 追記（update-api-doc スキル方針どおり）。
- [ ] **Step 6:** `go test ./internal/kanban/ -count=1 -run ItemTemplate` GREEN。

---

### Task 3: FE Api + 型

**Files:**
- Create: `frontend/src/app/item-template.ts`
- Modify: `frontend/src/app/api.ts`
- Test: `frontend/src/app/item-template.spec.ts`（apply helper）

- [ ] **Step 1:**

```ts
export type ItemTemplate = {
  id: number;
  projectId: number;
  name: string;
  titleTemplate: string;
  descriptionTemplate: string;
  position: number;
};
export const ITEM_TEMPLATE_NONE = '（テンプレートなし）';
export const ITEM_TEMPLATE_LIST_LOAD_FAILURE = 'テンプレート一覧を読み込めませんでした';
/** null = 「テンプレートなし」→ 空文字。それ以外は雛形フィールドを返す。 */
export function applyItemTemplate(
  t: Pick<ItemTemplate, 'titleTemplate' | 'descriptionTemplate'> | null,
): { title: string; description: string } {
  if (!t) return { title: '', description: '' };
  return { title: t.titleTemplate, description: t.descriptionTemplate };
}
```

- [ ] **Step 2:** `Api.listItemTemplates(projectId)` / `create` / `update` / `delete` — **全メソッドに `HttpParams` の `projectId`**（L-934/L-901）。
- [ ] **Step 3:** vitest で apply helper GREEN。

---

### Task 4: Board 作成ダイアログ UI

**Files:**
- Modify: `frontend/src/app/board.ts` / `board.html`
- Modify: `frontend/src/app/board.spec.ts`

- [ ] **Step 1:** `inject(AuthSession)`。`openItem` 時に `projectSession.activeId()` を使い、`switching()` 中は呼ばない。`listItemTemplates(id)`。loadError / templates signals。読込中は空案内を出さない。テンプレ select は「（テンプレートなし）」にリセット。
- [ ] **Step 2:** select `#item-template`。change で `applyItemTemplate` → `itemForm` の title/description を上書き。「なし」で空。
- [ ] **Step 3:** `auth.isAdmin()` のとき管理パネル: createForm（textLimit 60/200/10000）、edit、delete confirm。メッセージは既存 `formError` または専用 signal（どちらか一方に統一し二重表示しない）。`saving` は既存 item 追加と共有。localStorage は使わない（L-056）。
- [ ] **Step 4:** テスト: セレクト存在（L-060）、選択で値反映、一覧 error 表示、非 admin で管理非表示、`saving===true` 中はテンプレ create/item add がどちらも開始されない（L-653）。
- [ ] **Step 5:** `npx vitest run src/app/board.spec.ts -t "template|テンプレート"` GREEN。

---

### Task 5: Backlog 作成ダイアログ UI

**Files:**
- Modify: `frontend/src/app/backlog.ts` / `backlog.html`
- Modify: `frontend/src/app/backlog.spec.ts`

- [ ] **Step 1:** Board と同契約（セレクト・適用・管理・saving 共有・loadError）。
- [ ] **Step 2:** 配線テストを backlog 側でも固定（L-060）。saving 相互ブロックも board と同契約。
- [ ] **Step 3:** `npx vitest run src/app/backlog.spec.ts -t "template|テンプレート"` GREEN。

---

### Task 6: 全体検証

- [ ] **Step 1:** `cd backend && go test ./internal/kanban/ -count=1`
- [ ] **Step 2:** `cd frontend && npx vitest run`（関連 spec 最低限。時間許せば全体）
- [ ] **Step 3:** 受入確認:
  1. 管理者でテンプレ CRUD できる
  2. 作成ダイアログで選ぶと雛形が入る
  3. 0 件プロジェクトの GET で seed 2 件
  4. アイテム作成 → テンプレ削除 → アイテム本文不変（Task2 テストで自動検証済みならチェックのみ）
  5. saving 中の連打が二重送信にならない

## 知見チェック（プラン反映）

- L-002 / L-044 / L-048 / L-056 / L-060 / L-653 / L-858 / L-901 / L-934
