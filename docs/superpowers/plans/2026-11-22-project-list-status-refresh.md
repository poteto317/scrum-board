# プロジェクト一覧のステータス再取得（#135）Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. Commit は `/feature` 中はしない。

**Goal:** listbox を開く（focus/pointerdown / メニューオープン）と、他プロジェクトの board キャッシュを強制再取得し、ステータスドットを最新にする。

**Architecture:** `ProjectBoardCache` に force refresh + `boardWriteGen`（L-040）。App は listbox 経路だけ `refreshOthers`。切替用 prefetch（ifAbsent）は維持。

**Tech Stack:** Angular、Vitest、既存 `Api.board`

**Design:** `docs/superpowers/specs/2026-11-22-project-list-status-refresh-design.md`

**知見:** L-040, L-002, L-860, L-060

**Commits:** `/feature` 中はコミットしない。

---

## File map

| ファイル | 責務 |
| --- | --- |
| `frontend/src/app/project-board-cache.ts` (+spec) | `boardWriteGen`、`writeBoardSnapshot`、force enqueue、`refreshOthers` |
| `frontend/src/app/app.ts` (+spec) | refresh 配線、openProjectMenu、backlog は prefetchBacklog |

---

### Task 1: Cache force refresh + 世代（L-040）

- [x] **Step 1:** `boardWriteGen: Map<number, number>`（未設定は 0 扱い: `get(id) ?? 0`）と private `writeBoardSnapshot(id, items, columns)`（`isValidBoardPut` を満たすときだけ set + bumpRevision。gen は触らない）を追加。
- [x] **Step 2:** `putBoard` は **`isValidBoardPut` 成功時のみ** gen+1 してから `writeBoardSnapshot`。無効入力では gen もキャッシュも変えない。`putBoardIfAbsent` は gen を進めず、空のときだけ `writeBoardSnapshot`。
- [x] **Step 3:** private `enqueueBoardRefresh(api, projectId)`:
  - キーは **`board:${id}`**（既存 board prefetch と共有。飛行中は新規を足さない。完了後の次トリガーで force する）。
  - warm でもスキップしない。
  - 開始時: `gen = (boardWriteGen.get(id) ?? 0) + 1` を set し閉包に保持。
  - 成功時: `boardWriteGen.get(id)===gen` なら **`writeBoardSnapshot` のみ**（`putBoard` 不呼）。不一致なら破棄。
  - 失敗: 何もしない（キャッシュ維持）。
- [x] **Step 4:** `refreshOthers(api, activeId, projectIds)`: `Number.isFinite(id) && id > 0 && id !== activeId` のみ `enqueueBoardRefresh`。
- [x] **Step 5:** `project-board-cache.spec.ts`:
  - warm 後 `refreshOthers` で `api.board` が呼ばれスナップショット更新。
  - activeId・非正 id は呼ばれない。
  - 取得中（Subject 未完了）も既存スナップショットが残る。
  - `putBoard` 後の遅延 refresh 応答は上書きしない。
  - error で既存維持。
  - 旧 prefetchOthers / ifAbsent / 遅延 prefetch が fresher put を踏まない回帰。

### Task 2: App 配線

- [x] **Step 1:** `onProjectSelectWarmup`: `switching`/`mutating` early return 維持 → `refreshOthers` → backlog ルート時は他 id へ `prefetchBacklog`。
- [x] **Step 2:** `openProjectMenu` 成功後に `onProjectSelectWarmup`（board force + backlog soft）。
- [x] **Step 3:** `app.spec.ts`:
  - **focus/pointerdown** 経路で refresh（board 再取得）が走る。
  - **openProjectMenu**（Enter 相当）経路でも refresh が走る。
  - メニューを開いたまま、古い Doing キャッシュ → refresh 成功で Review ドット等へ更新（revision 再描画）。
  - switching 中は refresh しない。
  - backlog ルートでは他 id の `prefetchBacklog` も呼ばれる。
  - 既存ドット／aria-label（L-060）回帰。

### Task 3: 検証

- [x] **Step 1:** `npx ng test --watch=false --include=src/app/project-board-cache.spec.ts --include=src/app/app.spec.ts` が通る。
- [x] **Step 2:** BE / OpenAPI 差分なし。

---

## レビュー記録

### 第 1 周（要件との対応）2026-11-22
対応: Enter/focus 両方のテスト、メニュー開放中更新、inFlight キー確定、writeBoardSnapshot で gen 二重増を回避、active/非正/switching/backlog/取得中維持のテストを追記。

### 第 2 周（タスク整合と知見）2026-11-22
対応: 知見表の force putBoard 表記修正、writeBoardSnapshot に isValidBoardPut、gen 初期値 0、putBoard は検証成功時のみ gen+1。
