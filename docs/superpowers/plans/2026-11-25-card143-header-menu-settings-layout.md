# カード143 Implementation Plan

> **For agentic workers:** 順に実装・検証する（`/feature` 手順 11、完了後 `/refactor-srp` 以降へ自動連結）。

**Goal:** メニュー設定の checkbox 行がグローバル form CSS に潰れず、ラベルが読める・揃って見える。
**Architecture:** `header-menu.component.css` のみで設定リスト向け打ち消し。`styles.css` は触らない。テストは CSS ソース契約。
**Tech Stack:** Angular, TypeScript, Vitest, CSS
**Spec:** `docs/superpowers/specs/2026-11-25-card143-header-menu-settings-layout-design.md`

## Global Constraints

- グローバル `styles.css`・HTML 構造・API/Session は触らない。
- 反映知見: L-060, L-175, L-515。

## Task 1: RED — 設定リスト CSS ソース契約

**Files:**
- Modify: `frontend/src/app/header-menu.component.spec.ts`

- [x] 設定ビューを開く既存経路で CSS ソース契約 + 先頭 label `textContent` に「プロジェクト」を断言。
- [x] 実装前に契約未充足で RED → CSS 追加後 GREEN（CSSOM は `0px` / `border: medium` を許容）。

## Task 2: GREEN — コンポーネント CSS 打ち消し

**Files:**
- Modify: `frontend/src/app/header-menu.component.css`

- [x] 設計 §1 の打ち消しを追加（label `margin: 0` + checkbox 規則）。

## Task 3: 変異と全体検証

- [x] M01 `width: auto` 削除 → KILLED（契約 it）。M02 label `margin: 0` 削除 → KILLED。
- [x] `npm test -- --watch=false && npm run build`
- [x] `git diff --check` / `require-feature-reviews.sh`
