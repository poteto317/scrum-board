# ボード列の縦スクロールをページ単位に戻す

**カード:** http://127.0.0.1:4200/cards/38  
**タイトル:** 各列ごとにスクロールが分かれてしまっている

## 背景

カード DnD（PR #5）導入時、`.card-list` に `max-height: min(60vh, 640px)` と `overflow-y: auto` を足し、列ごとに独立した縦スクロールになった。列間でスクロール位置が揃わず UX が悪いため、DnD 以前のように列は内容に応じて伸び、縦スクロールはページ（ドキュメント）側に戻す。

## 決めたこと（推奨案を採用）

| 事項 | 採用 |
| --- | --- |
| 列内スクロール | 廃止。`.card-list` から `max-height` / `overflow-y` を削除 |
| 横スクロール | 現状どおり `.board-scroll` の `overflow-x: auto` のみ |
| 縦スクロール | ブラウザ／ドキュメントの通常スクロール（列が長くなってページが伸びる） |
| `min-height: 72px` | 空列のドロップ領域として残す |
| focus ring 用の padding/margin 4px | クリップ対策として残す（スクロール有無に依存しない） |
| ドラッグ中の縦自動スクロール | `.card-list.scrollTop` はやめ、ビューポート上下端で `document.scrollingElement`（なければ `document.documentElement`）の `scrollTop` に加算する。横は従来どおり `.board-scroll.scrollLeft`。縦端の判定帯は常に `0`〜`window.innerHeight`（リストの getBoundingClientRect は使わない） |
| バックログ | 対象外（別 UI） |
| API / DB | 変更なし |

## 要件

1. 各列のカード一覧は列内で独立スクロールしない。
2. カードが多い列は列全体が縦に伸び、ページを縦スクロールして続きを見る。
3. 列が多いときの横スクロールは従来どおり。
4. カード DnD 中、ポインターがビューポート上下端にいるときページが縦に自動スクロールし続ける（静止時も既存タイマー）。左右端ではボード横スクロール（既存）。端に数秒静止しても、コンテンツ高（`scrollHeight`）が増え続けない（L-680）。
5. キーボードによる列内並べ替え・保存・ライブ更新の挙動は変えない。
6. 次の文書の「列の縦スクロール／list.scrollTop」記述を実態に合わせる（L-203）: `README.md`、`docs/verification.md`、`docs/superpowers/specs/2026-11-14-card-drag-drop-design.md`、`docs/superpowers/plans/2026-11-14-card-drag-drop.md`。

## 非要件

- 列ヘッダーの sticky 固定
- ボード全体を 1 つの固定高さボックスにして内側だけ縦スクロールする方式
- バックログやカード詳細のスクロール変更

## アーキテクチャ

- **CSS:** `frontend/src/app/board.css` の `.card-list` から高さ制限と `overflow-y` を除去。
- **TS:** 縦 auto-scroll は `frontend/src/app/page-scroll.ts`（`pageScrollElement` / `autoScrollPageVertically`）に置き、`Board.autoScrollAt` から呼ぶ。`page-scroll` は列並びモジュールに依存しない（端判定は自前定数）。横は従来どおり `board-scroll` + `computeAutoScrollDelta`（`column-order`）。
- **テスト:**
  - `page-scroll.spec.ts` で縦端の `scrollTop` 増減を固定。
  - `board-cdk-wiring.spec.ts` / `board-card-reorder-state.spec.ts` の「list.scrollTop が増える」を、モックした `scrollingElement.scrollTop` の増減に合わせる（実装と同じ `scrollTop` 加算。`window.scrollBy` は使わない）。
  - ページ縦 auto-scroll の呼び出しを外すと落ちるテストを置く（配線漏れ検知。L-060）。
  - 端静止でタイマーが進んでも `scrollHeight` が不変であることを固定（L-680）。
  - 注入された `<style>` 本文（jsdom では getComputedStyle が空のため）で、`.card-list` ブロックに `max-height: min(60vh` / `overflow-y: auto` が無いことを固定する。

## 知見

- L-203（文書と実装の同期。更新先は要件 6）
- L-680（自前 auto-scroll: CDK 競合回避は維持。端静止で scrollHeight が増え続けない）
- L-048（DnD 以前の CSS を git で確認済み）
- L-060（ページ縦 auto-scroll の配線を外すと落ちるテストで固定）

## 受け入れ条件

- [ ] ボード上で列ごとに縦スクロールバーが出ない（長い列はページが伸びる）
- [ ] 横スクロールは列が多いとき従来どおり動く
- [ ] カードをドラッグしてビューポート下端／上端に置くとページが縦に自動スクロールする
- [ ] 端に静止してもコンテンツ高が増え続けない
- [ ] 要件 6 の文書が更新済み
- [ ] フロントの既存テスト＋ビルドが通る
