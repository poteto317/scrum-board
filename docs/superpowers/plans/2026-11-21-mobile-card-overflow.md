# スマホカードのはみ出しとタップ Implementation Plan

> `/feature` ではコミットしない。

**Goal:** 幅 700px 以下で選択中の列とカードがメイン幅に収まり、細ポインタ以外の hover 移動と detail>1 のクリックで詳細遷移が飛ばないようにする。

**Spec:** `docs/superpowers/specs/2026-11-21-mobile-card-overflow-design.md`

## Global Constraints

- シェル・サイドバー開閉・バックログ CSS は変えない。
- 列ルールは `@media (max-width: 700px)` かつ `.board-page.board-mobile` のみ。全列の縦積みはしない。
- hover の translateY は `.board-page .task-card` に祖先限定し、`(hover: hover) and (pointer: fine)` のみ。
- `touch-action` も `pointer-events` による見た目無効も足さない。
- `onItemClick` は detail > 1 を無視。detail 0 と 1 は遷移。
- 既存ハンドルの aria-disabled は直さない。

## Tasks

### Task 1: ボード幅

- [x] `board.css` の 700px media 内で `.board-page.board-mobile .board-columns` を `min-width: 0; width: 100%; box-sizing: border-box`。
- [x] 同じ祖先で `.kanban-column` を `flex: 1 1 auto; min-width: 0; width: 100%; max-width: 100%; box-sizing: border-box`。
- [x] 同じ祖先で `.card-footer` を `flex-wrap: wrap`、`.detail-hint` の nowrap を解除、`.board-page` 左右 padding 12px、`.board-toolbar` を `flex-wrap: wrap`。
- [x] `list-filter-bar.css` で `:host-context(.board-page.board-mobile)` の入力 `min-width: 0`（バックログは `.board-mobile` が無いので対象外）。

### Task 2: タップ

- [x] `styles.css` の `.task-card:hover` を `.board-page .task-card:hover` にし、`@media (hover: hover) and (pointer: fine)` のときだけ translate（700px とは独立）。
- [x] 無修飾かつ `detail > 1` は `preventDefault` してから return（href でも進まない）。修飾クリックは従来どおりブラウザへ渡す。detail 0 と 1 は遷移。
- [x] テスト: detail 1 は navigate かつ defaultPrevented。detail 2 は navigate せず defaultPrevented。CSS に 700px の min-width 解除・flex-wrap・701px 側の max-content 維持・hover のポインタ条件がある。jsdom は実幅の scrollWidth を測れないので幾何テストはしない。

### Task 3: 検証

- [x] `cd frontend && npm test -- --watch=false --include=src/app/board.spec.ts --include=src/app/board-mobile-overflow.spec.ts`（新規があればそれも）。
