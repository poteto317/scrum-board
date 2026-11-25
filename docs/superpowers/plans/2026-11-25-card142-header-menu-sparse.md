# カード142 Implementation Plan

> **For agentic workers:** 順に実装・検証する（`/feature` 手順 11、完了後 `/refactor-srp` 以降へ自動連結）。

**Goal:** `/trash` `/archive` `/users` `/projects` `/recurring` `/settings` でハンバーガーにボードと同じ `open_*` メニューが出る。`/login`・未知は従来どおり空。
**Architecture:** `resolvePageKind` だけを変え、副次ルートを `'board'` にマップ。API・Session・カタログ・新 PageKind は触らない。
**Tech Stack:** Angular, TypeScript, Vitest
**Spec:** `docs/superpowers/specs/2026-11-25-card142-header-menu-sparse-design.md`

## Global Constraints

- prefs 3 キー・BE・Session・AI chat pageKind は触らない（範囲外）。
- 反映知見: L-060, L-175, L-515, L-925, L-015, L-669。

## Task 1: RED — resolvePageKind / 可視メニューの回帰

**Files:**
- Modify: `frontend/src/app/header-menu.spec.ts`
- Modify: `frontend/src/app/recurring.spec.ts`（`resolvePageKind('/recurring') is null` を更新）
- Modify: `frontend/src/app/header-menu.component.spec.ts`（Router `/trash` 経由の 1 件・必須）

- [x] `header-menu.spec.ts` の `resolves pageKind from url` を次の契約に更新:
  - `/trash` `/archive` `/users` `/projects` `/recurring` `/settings` → `'board'`
  - `/login` → `null`
  - `/` → `board`、`/backlog` → `backlog`、items → `itemDetail`、未知・`/items/foo` → `null`（現行維持）
- [x] 同ファイルに次を追加（L-060）:
  - 各副次 URL について `const kind = resolvePageKind(url)!` のあと `visibleMenuItemIds(kind, { hiddenIds: [] })` が `catalogIdsForPageKind('board')` と deep equal。
  - `resolvePageKind('/login')` は null（visible 計算しない）。
- [x] `recurring.spec.ts` の `resolvePageKind(/recurring) is null` を `'board'` 期待に改名・更新。
- [x] `header-menu.component.spec.ts`（設計完了条件 1・2、L-515）: **`pageKind.set` 直書きは禁止**。経路は次のいずれか一方のみ:
  1. 既存 App harness で `Router.navigateByUrl('/trash')` → `detectChanges`、または
  2. `TestBed` で `HeaderMenu` 単体＋`provideRouter`＋`navigateByUrl('/trash')` の最小 harness。
  断言: `HeaderMenu.pageKind() === 'board'`。メニューを開き `#header-menu-item-open_projects` の `textContent` に「プロジェクト」。続けて「メニュー設定」→ `#header-menu-page-kind` の value が `board`。
- [x] `cd frontend && npx ng test --watch=false --include 'src/app/header-menu.spec.ts' --include 'src/app/recurring.spec.ts' --include 'src/app/header-menu.component.spec.ts'` で **実装前 RED** を確認（3 ファイル）。

## Task 2: GREEN — resolvePageKind マップ

**Files:**
- Modify: `frontend/src/app/header-menu.ts`

- [x] `resolvePageKind` で `/trash` `/archive` `/users` `/projects` `/recurring` `/settings` を `'board'` に返す（`/login` は `null` のまま別分岐）。
- [x] Task 1 のテストが GREEN。既存 catalog / visible / label テストが通ること。

## Task 3: 変異テストと全体検証

- [x] `cd frontend` で mutation-test:
  ```sh
  ~/Desktop/dev-flow-kit/scripts/git/mutation-test.sh --baseline --show-diff M01 \
    src/app/header-menu.ts \
    "s/normalized === '\\/trash'/normalized === '\\/trash-mutated'/" \
    -- npx ng test --watch=false --include src/app/header-menu.spec.ts
  ```
  KILLED（`/trash` → null で resolve / secondary テスト失敗）。L-175。
- [x] `cd frontend && npm test -- --watch=false && npm run build`（113 files / 1128 tests、build OK）
- [x] リポジトリルートで `git diff --check` および `~/Desktop/dev-flow-kit/scripts/dev-flow/require-feature-reviews.sh`
