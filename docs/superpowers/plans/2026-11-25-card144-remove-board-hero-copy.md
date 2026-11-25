# カード144 Implementation Plan

> **For agentic workers:** 順に実装・検証する（`/feature` 手順 11、完了後 `/refactor-srp` 以降へ自動連結）。

**Goal:** ボード画面（`frontend/src/app/board.html`）上部の `<section class="page-heading">`（`YOUR WORK, ONE STEP AT A TIME`・`小さく始めて、前へ進める.`・`アイデアをタスクに。ひとつずつ、着実に。`）を削除し、ページ開時の不要な領域占有を解消する。
**Architecture:** `board.html` から `<section class="page-heading">` を削除したうえで、文書構造上の主見出し `<h1>` を維持するため `<div class="active-tab">` を `<h1 class="active-tab">` に変更する。他画面共用の `frontend/src/styles.css` は変更せず（L-792）、`frontend/src/app/board.css` から未使用のヒーロー CSS を除去し、`.active-tab` に `margin: 0; letter-spacing: normal; line-height: normal;` を明示して `styles.css` のグローバル `h1` によるスタイル上書きを防ぐ。
**Tech Stack:** Angular, TypeScript, CSS, Vitest, jsdom
**Spec:** `docs/superpowers/specs/2026-11-25-card144-remove-board-hero-copy-design.md`

## Global Constraints
- `frontend/src/index.html` の `<meta name="description">`、他画面の `.page-heading`・`.eyebrow`、および `frontend/src/styles.css` は変更しない（L-792）。
- 反映知見: L-060 / L-175（削除された文言・要素と `h1.active-tab`、およびグローバル `h1`/UA 余白に対する上書き防止をテストで固定）、L-590（実装後の実測件数・実行対象を一致させる）、L-643（テスト内一時 `<style>` 注入を `try ... finally` で確実に除去）、L-792（コンポーネント CSS スコープ内で閉じる）。

## Task 1: テンプレート・スタイル変更と回帰テストの追加
**Files:**
- Modify: `frontend/src/app/board.html`
- Modify: `frontend/src/app/board.css`
- Modify: `frontend/src/app/board.spec.ts`

- [x] まず `frontend/src/app/board.spec.ts` に回帰テストを追加し、変更前のコードで失敗（RED）することを確認する（`cd frontend && npx ng test --watch=false --include src/app/board.spec.ts` 等、テスト後の後片付け `try ... finally { tag.remove(); }` と `f.destroy()` を忘れない、L-643）。
  - テスト検証項目 1（文言・要素削除と主見出し `h1` 維持）:
    - DOM テキストに `YOUR WORK, ONE STEP AT A TIME`・`小さく始めて`・`前へ進める`・`アイデアをタスクに。ひとつずつ、着実に。` が含まれないこと、`.page-heading` が 0 件であること。
    - `h1.active-tab` が 1 件存在し、テキストに `かんばんボード` を含むこと。
  - テスト検証項目 2（CSS 契約と競合 `h1` 上書き防止、L-060 / L-175 / L-643 / L-662 / L-792）:
    - テンプレート内で常に存在する要素 `f.nativeElement.querySelector('main.board-page')` から `_ngcontent-` 属性名（`scopeAttr`）を取得し、`expect(scopeAttr).toMatch(/^_ngcontent-/)` を確認したうえで、`document.querySelectorAll('style')` から `[${scopeAttr}]` を含むスタイル要素だけを抽出して `boardCss` とし、`expect(boardCss).toContain('.board-toolbar')` で非空を検証する。その `boardCss` 上で削除対象セレクタ（`.page-heading`・`.eyebrow`・`.heading-dot`・`.mobile-break` および単独 `h1`）が含まれないこと、および `.active-tab` に `margin: 0`・`letter-spacing: normal`・`line-height: normal`・`font-size: 14px`、`.board-toolbar` に `margin-top: 12px` が含まれることを検証する。
    - 一時 `<style>` 要素で競合ルール `h1 { font-size: 36px; letter-spacing: -1px; line-height: 1.4; font-weight: 650; margin: 24px 0; }` を注入し（`try ... finally { tag.remove(); }` で復元）、`getComputedStyle(h1)` で `fontSize === '14px'`・`letterSpacing === 'normal'`・`lineHeight === 'normal'`・`marginTop === '0px'`・`marginBottom === '0px'` を検証する。
- [x] `frontend/src/app/board.html` を編集する:
  - 3〜9 行目の `<section class="page-heading">...</section>` を削除する。
  - 11〜13 行目の `<div class="active-tab">...</div>` を `<h1 class="active-tab">...</h1>` に変更する。
- [x] `frontend/src/app/board.css` を編集する:
  - デスクトップ側の `.page-heading`, `.eyebrow`, `h1`, `.heading-dot`, `.page-heading p`, `.mobile-break`（19〜50 行目）を削除する。
  - `@media (max-width: 700px)` 内の `.page-heading`, `.page-heading h1`, `.mobile-break`, `.eyebrow`（401〜413 行目）を削除する。
  - `.board-toolbar` に `margin-top: 12px;` を追加する。
  - `.active-tab` に `margin: 0;`、`letter-spacing: normal;`、`line-height: normal;` を追加する。
- [x] `cd frontend && npx ng test --watch=false --include src/app/board.spec.ts` で新規テストが GREEN になることを確認する。

## Task 2: 変異テストと全体ビルド・ゲート検証
- [x] `~/Desktop/dev-flow-kit/scripts/git/mutation-test.sh` の存在と `--help` を確認したうえで、以下の 3 つの変異を `cd frontend` 配下で実行し、いずれも `--show-diff` で狙った箇所のみが変わったことと、対応するアサーション失敗による `KILLED` を確認する（L-175・L-200）。環境上同スクリプトを参照・実行できない場合は、対象ファイルを `cp -p <ファイル> <一時ファイル>` で退避してから一時編集し、`cd frontend && npx ng test --watch=false --include src/app/board.spec.ts` で狙いのアサーション失敗を確認したうえで、`git checkout` / `git restore` は使わず退避ファイルから書き戻し `cmp -s` で完全一致を確認し、再度同テスト全件通過を確認する。
  1. `.active-tab` から `margin: 0;` を消す変異:
     ```sh
     cd frontend && ~/Desktop/dev-flow-kit/scripts/git/mutation-test.sh --baseline --show-diff M01 src/app/board.css 's/(\.active-tab\s*\{[^}]*?)margin:\s*0;/$1/s' -- npx ng test --watch=false --include src/app/board.spec.ts
     ```
  2. `.active-tab` から `letter-spacing: normal;` を消す変異:
     ```sh
     cd frontend && ~/Desktop/dev-flow-kit/scripts/git/mutation-test.sh --baseline --show-diff M02 src/app/board.css 's/(\.active-tab\s*\{[^}]*?)letter-spacing:\s*normal;/$1/s' -- npx ng test --watch=false --include src/app/board.spec.ts
     ```
  3. `<h1 class="active-tab">...</h1>` を `<div class="active-tab">...</div>` に戻す変異（開始・閉じタグ双方を変換し、構文エラーではなく `h1.active-tab` 検査で落ちることを失敗ログで確認）:
     ```sh
     cd frontend && ~/Desktop/dev-flow-kit/scripts/git/mutation-test.sh --baseline --show-diff M03 src/app/board.html 's#<h1 class="active-tab">(.*?)</h1>#<div class="active-tab">$1</div>#s' -- npx ng test --watch=false --include src/app/board.spec.ts
     ```
- [x] `cd frontend && npm test -- --watch=false && npm run build` を実行し、CSS 契約テスト（`check-dialog-modal-open-css.mjs`）・全フロントエンド単体テスト・本番ビルド（`board.css` 予算が改善・エラー無しであること含む）が成功することを確認する。
- [x] リポジトリルートで `git diff --check` および `~/Desktop/dev-flow-kit/scripts/dev-flow/require-feature-reviews.sh` を実行し exit 0 を確認する。

## 検証結果（2026-11-25）

- RED: `board.spec.ts` 新規 2 件が変更前コードで失敗（56 件中 2 failed）。
- GREEN: `npx ng test --watch=false --include src/app/board.spec.ts` → 56 passed。
- 変異: M01 / M02 / M03 すべて KILLED。
- 全体: `npm test -- --watch=false` → 113 files / 1122 tests passed。`npm run build` 成功（`board.css` 予算超過は 7.35 kB、削除前より縮小）。
