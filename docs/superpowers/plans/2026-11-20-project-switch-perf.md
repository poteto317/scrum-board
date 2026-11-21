# プロジェクト切替の表示遅れ改善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. **本フローではコミットしない**（`/feature`）。

**Goal:** プロジェクト切替後、キャッシュまたは先読みがあれば再 GET 完了前に新プロジェクトのカードを見せ、空待ちを短くする。

**Architecture:** `GET /api/board|backlog?projectId=` で active を変えずに先読み可能にする。FE は projectId→`Item[]` のメモリキャッシュと専用 in-flight を持ち、select の focus/pointerdown で先読み（キャッシュのみ更新）。切替再読込は generation++ → キャッシュ items 即時適用（syncActive なし）→ GET → 通常適用。

**Tech Stack:** Go HTTP / MySQL repo、Angular signals / RxJS / Vitest

**Spec:** `docs/superpowers/specs/2026-11-20-project-switch-perf-design.md`

## Global Constraints

- 先読み GET は DB／FE の active を書き換えない
- #71 `itemsForActiveProject` 維持。旧プロジェクトカードを出さない
- L-040: 先読みは `boardLoadGeneration` を進めない。切替再取得の順は generation++ → キャッシュ適用 → GET
- L-842 / L-844: `switching` busy・操作拒否維持
- 先読み完了時、既にその projectId のキャッシュがあれば上書きしない
- `/feature` のためコミットしない
- 関連知見: L-040, L-037, L-842, L-844, L-001, #71

## ファイル対応

| ファイル | 責務 |
|---------|------|
| `backend/internal/kanban/repository.go` / `backlog.go` / `model.go` | Board／Backlog を任意 projectId で読める契約（`Repository` 更新） |
| `backend/internal/kanban/handler.go` | `?projectId=` パース、400、items スコープ |
| `backend/internal/kanban/handler_test.go` | `memoryRepo` を新契約に合わせて更新 |
| `backend/internal/kanban/*_test.go` | projectId クエリのハンドラ／統合テスト |
| `docs/api.md` | クエリ文書化 |
| `frontend/src/app/api.ts` | `board(projectId?)` / `backlog(projectId?)` |
| `frontend/src/app/project-board-cache.ts`（新規） | Map・putIfAbsent・in-flight・prefetch |
| `frontend/src/app/app.ts` / `app.html` | select focus/pointerdown → prefetch |
| `frontend/src/app/board.ts` / `backlog.ts` | 成功 GET で cache put、reloadAfterProjectSwitch の順 |

---

### Task 1: BE `GET ?projectId=`（board）

**Files:**
- Modify: `backend/internal/kanban/model.go`（`Repository` — 例: `Board(ctx, projectID int64)` で `projectID==0` は現行 active、正ならその id。または `BoardForProject` 追加）
- Modify: `backend/internal/kanban/repository.go`
- Modify: `backend/internal/kanban/handler.go`（`board`）
- Modify: `backend/internal/kanban/handler_test.go`（`memoryRepo`）
- Modify/Create: `backend/internal/kanban/project_board_query_test.go`（または既存 `project_handler_test.go` に追加）
- Modify: `docs/api.md`

**Interfaces:**
- Query `projectId` 省略 → 現行（解決後 active の items）
- 指定・正の既存 id → items はその id。`settings.activeProjectId` は解決後 active のまま。DB 非更新
- 不正／0／不存在 → 400（`ErrProject` 経路）

- [x] **Step 1: 失敗するテスト**

```go
// GET /api/board（projectId 省略）→ 200, items は解決後 active、settings.activeProjectId もその active（現行 regression）
// active=project A, GET /api/board?projectId=B → 200, items all projectId==B, settings.activeProjectId==A
// GET /api/board?projectId=0 → 400
// GET /api/board?projectId=99999 → 400
```

- [x] **Step 2: repo／handler 実装して PASS**

- [x] **Step 3: `docs/api.md` に `projectId` を追記**

- [x] **Step 4: `cd backend && go test ./internal/kanban/ -count=1 -run 'Board.*Project|Project.*Board|projectId'` PASS**

- [x] **Step 5: コミットしない**

---

### Task 2: BE `GET /api/backlog?projectId=`

**Files:**
- Modify: `backend/internal/kanban/model.go` / `backlog.go` / handler `backlog`（board と同契約）
- Modify: `backend/internal/kanban/handler_test.go`（`memoryRepo.Backlog`）
- Test: 同上または `project_handler_test.go`

- [x] **Step 1: 失敗するテスト**（board と同型。items の projectId・active 非変更・400）

- [x] **Step 2: 実装して PASS**

- [x] **Step 3: api.md backlog 節を更新**

- [x] **Step 4: go test 該当 PASS / コミットしない**

---

### Task 3: FE キャッシュサービス

**Files:**
- Create: `frontend/src/app/project-board-cache.ts`
- Create: `frontend/src/app/project-board-cache.spec.ts`

**Interfaces:**

```ts
@Injectable({ providedIn: 'root' })
export class ProjectBoardCache {
  get(projectId: number): Item[] | undefined;
  /** 既にあれば無視。無ければ保存。 */
  putIfAbsent(projectId: number, items: Item[]): void;
  /** 常に上書き（通常 GET / 切替後 GET 成功時）。 */
  put(projectId: number, items: Item[]): void;
  /** board 先読み。未キャッシュ・非 in-flight のみ。完了時 putIfAbsent。世代は触らない。 */
  prefetchBoard(api: Api, projectId: number): void;
  prefetchBacklog(api: Api, projectId: number): void;
  prefetchOthers(api: Api, activeId: number, projectIds: number[], includeBacklog: boolean): void;
}
```

- **in-flight キー**: `(projectId, 'board' | 'backlog')` で分離（board 完了が backlog 先読みを抑止しない）。
- **同時実行上限 2**: 種別横断（board+backlog 合計）。
- `switching` 判定は呼び出し側（App）が prefetch を呼ばないことで満たす。
- Board／Backlog でキャッシュ Map を分けるか、同一 Map で items だけ共有するかは実装選択可。ただし put／get のキーは projectId。先読み種別は in-flight のみ分離。

- [x] **Step 1: 失敗するテスト**（putIfAbsent が既存を踏まない、put は上書き、同種別の二重 prefetch が 1 リクエスト、board in-flight 中でも backlog prefetch は発火、など）

- [x] **Step 2: 実装して `npm test -- --watch=false --include=src/app/project-board-cache.spec.ts` PASS**

- [x] **Step 3: コミットしない**

---

### Task 4: Api クライアント＋通常 GET で cache put

**Files:**
- Modify: `frontend/src/app/api.ts` — `board(projectId?: number)` / `backlog(projectId?: number)` が params 付き
- Modify: `frontend/src/app/board.ts` — 通常 load／poll／切替 GET 成功時 `cache.put(activeId, items)`
- Modify: `frontend/src/app/backlog.ts` — 同様

- [x] **Step 1: api の params をテストまたは board 既存 spec で確認できる形に**

- [x] **Step 2: 実装。切替即時表示はまだ入れない**

- [x] **Step 3: 既存 board／backlog 関連テスト PASS**

- [x] **Step 4: コミットしない**

---

### Task 5: 切替時キャッシュ即時表示（Board）

**Files:**
- Modify: `frontend/src/app/board.ts` — `reloadAfterProjectSwitch`
- Modify: `frontend/src/app/board-project-switch.spec.ts`（または新規）

**順序（必須）:**

```ts
const generation = ++this.boardLoadGeneration;
const activeId = this.projectSession.activeId();
const cached = activeId != null ? this.cache.get(activeId) : undefined;
if (cached) {
  this.data.update((d) => ({ ...d, items: cached })); // syncActive しない
}
// then api.board() … finalize endSwitch；成功時 put + applyBoardDataWithActiveSync
```

- [x] **Step 1: 失敗するテスト**
  - PATCH 成功〜GET 前にキャッシュがあれば新 projectId のカードが `grouped` に出る
  - `activeId` がキャッシュ適用で巻き戻らない（syncActive なし）
  - キャッシュ配列に他 projectId の item が混在しても `grouped` には active のみ（#71）
  - `++boardLoadGeneration` 後に届いた**古い** GET 応答で `data` が上書きされない（held Subject）
  - キャッシュ適用後に GET が error → 新 project のキャッシュ items が残り `error` が立つ

- [x] **Step 2: 実装して PASS**

- [x] **Step 3: コミットしない**

---

### Task 6: 切替時キャッシュ即時表示（Backlog）

**Files:**
- Modify: `frontend/src/app/backlog.ts` — `reloadAfterProjectSwitch`
- Modify/Create: `frontend/src/app/backlog-project-switch.spec.ts`

**順序（必須・forkJoin 維持）:**

```ts
const generation = ++this.backlogLoadGeneration; // 既存名に合わせる
const activeId = this.projectSession.activeId();
const cached = activeId != null ? this.cache.get(activeId) : undefined;
if (cached) {
  this.items.set(cached); // syncActive しない。board data は触らない
}
// then forkJoin({ backlog: api.backlog(), board: api.board() }) …
// 成功: put(activeId, backlog.items) + 既存の board sync / items 適用
// 失敗: キャッシュ items を残し error 表示、finalize で endSwitch
```

- [x] **Step 1: 失敗するテスト**（既存 forkJoin モックに合わせる）
  - キャッシュヒットで PATCH 後〜GET 前に新 project の items が見える
  - キャッシュに他 projectId が混在しても表示はフィルタ後のみ
  - generation 進めた後の古い forkJoin 応答を無視
  - GET 失敗時はキャッシュ表示＋ error

- [x] **Step 2: 実装して PASS / コミットしない**

---

### Task 7: select プリフェッチ配線

**Files:**
- Modify: `frontend/src/app/app.html` — `(focus)` `(pointerdown)` → `onProjectSelectPrefetch()`
- Modify: `frontend/src/app/app.ts`
- Modify: `frontend/src/app/app.spec.ts`

- [x] **Step 1: 失敗するテスト**
  - **focus** で `board` が `projectId` 付きで他プロジェクトへ呼ばれる
  - **pointerdown** でも同様（両方必須）
  - `switching` 中は呼ばない
  - 表示中の board/backlog data は変わらない

- [x] **Step 2: 実装。ルートが backlog のとき `prefetchOthers(..., includeBacklog: true)`**

- [x] **Step 3: `npm test -- --watch=false --include=src/app/app.spec.ts --include=src/app/project-board-cache.spec.ts` PASS**

- [x] **Step 4: コミットしない**

---

### Task 8: 全体検証

- [x] **Step 1:** `cd backend && go test ./internal/kanban/ -count=1`（必要なら timeout 余裕）
- [x] **Step 2:** `cd frontend && npm test -- --watch=false`（関連／全体）
- [x] **Step 3:** コミットしない。`state.json` に feature 完了は実装後に付与

## 知見チェック（プラン反映）

- L-040 / L-037: Task 3・5・6・7
- L-842 / L-844: switching 中 prefetch 抑制、endSwitch は GET settle
- L-001 / #71: syncActive 禁止の即時表示、itemsForActiveProject
