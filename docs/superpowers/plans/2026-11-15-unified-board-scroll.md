# ボード列縦スクロール統合 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** かんばん各列の独立縦スクロールをやめ、列は内容に応じて伸び、縦はページ、横は `.board-scroll` のままにする。ドラッグ中の縦自動スクロールはドキュメントへ向ける。

**Architecture:** CSS で `.card-list` の `max-height` / `overflow-y` を削除。縦 auto-scroll は `page-scroll.ts`（列ドメイン非依存）へ抽出し、`Board.autoScrollAt` から呼ぶ。横は従来どおり board-scroll。関連 spec・文書を同期。

**Tech Stack:** Angular 21, Vitest, 既存 `computeAutoScrollDelta`

**参照設計書:** `docs/superpowers/specs/2026-11-15-unified-board-scroll-design.md`

## Global Constraints

- `/feature` 実行中は `git commit` しない（後続 `commit-ja`）
- バックログ・API・DB は触らない
- 縦 auto-scroll は `scrollTop` 加算（`window.scrollBy` は使わない）

**知見:** L-203, L-680, L-048, L-060

---

### Task 1: 失敗するテストを先に書く（縦スクロール対象の差し替え）

**Files:**
- Modify: `frontend/src/app/board.css`
- Modify: `frontend/src/app/board.ts`
- Create: `frontend/src/app/page-scroll.ts` / `page-scroll.spec.ts`
- Modify: `frontend/src/app/board-card-reorder-state.spec.ts`
- Modify: `frontend/src/app/board-cdk-wiring.spec.ts`

- [x] **Step 1: テストを書き換える**

1. 「list.scrollTop が増える」系を、モックした `document.scrollingElement`（`scrollTop` / `scrollHeight` を持つオブジェクトを `Object.defineProperty` 等で差し替え）の増減に変更する。断言は `board-card-reorder-state.spec.ts` / `board-cdk-wiring.spec.ts` に置く（`board.spec.ts` は触らない）。
2. ビューポート下端／上端で page `scrollTop` が増減することを固定（L-060: 配線を外すと落ちる）。
3. `elementFromPoint` が null でも、ビューポート端なら縦にスクロールする（列ヒット不要）。
4. 端静止＋タイマー進行でも、モック要素の `scrollHeight` が変わらない（L-680）。横の静止スクロール既存テストは維持。
5. **必須:** fake timers で縦端に静止したとき、タイマー進行で page `scrollTop` が増え続けることを断言（設計要件 4）。
6. `.card-list` の制限: `board.css` テキストに `max-height: min(60vh` と `.card-list` ブロック内の `overflow-y: auto` が無いことを読み取りで固定。

- [x] **Step 2: テスト実行し失敗を確認**

```bash
cd frontend && VITEST_MAX_WORKERS=1 npx ng test --watch=false --include='**/board-card-reorder-state.spec.ts' --include='**/board-cdk-wiring.spec.ts'
```

- [x] **Step 3: 実装（CSS + autoScrollAt）**

`board.css` `.card-list`: `max-height` と `overflow-y: auto` を削除。`min-height: 72px` と padding/margin 4px は残す。

`page-scroll.ts`: `pageScrollElement` / `autoScrollPageVertically`（`column-order` に依存しない）。

`board.ts` `autoScrollAt`:
- 横: 従来どおり `boardScroll` の `scrollLeft`
- 縦: `autoScrollPageVertically(pageScrollElement(), pointer.y, window.innerHeight)`
- `.card-list` の `scrollTop` / `elementFromPoint` による縦処理は削除
- コメントを「列リスト」から「ページ」へ更新

- [x] **Step 4: テスト通過**

同上コマンド。

- [x] **Step 5: コミットはしない**

---

### Task 2: 文書同期と全体検証

**Files:**
- Modify: `README.md`
- Modify: `docs/verification.md`（「`.card-list` のスクロール領域」「列ごと縦スクロール」等の文言も含む）
- Modify: `docs/superpowers/specs/2026-11-14-card-drag-drop-design.md`
- Modify: `docs/superpowers/plans/2026-11-14-card-drag-drop.md`

- [x] **Step 1: 列内縦スクロール／list 縦自動スクロール／`.card-list` スクロール領域の記述をページ縦スクロールに書き換える（L-203）。受け入れ「列ごと縦スクロールバー無し」も verification に反映**

- [x] **Step 2: フロント全テスト＋ビルド**

```bash
cd frontend && VITEST_MAX_WORKERS=1 npx ng test --watch=false
cd frontend && npm run build
```

- [x] **Step 3: コミットはしない**

---

## サブエージェントのレビュー済み

- 2026-11-15: Files・include・縦端静止必須・verification 置換範囲を反映後、実装へ進む
