# スマホでカードがはみ出し、タップで詳細へ行けない（#72）

## 背景

カード: https://scrum-board-jkcejsb6ka-an.a.run.app/items/72?project=1

iPhone 15 Pro / Safari で、かんばんカードが画面に収まりきらず、タップしても詳細へ遷移しない。

調査:

- `.app-sidebar` は 220px のまま `.app-body` が横並び。論理幅 393px だとメインが約 170px しか残らない。
- `.board-columns { min-width: max-content }` と `.kanban-column { flex: 0 0 288px }` が、モバイルの `width: 100%` より優先して列を縮めない。`overflow-x: hidden` でカードが見切れる。
- `.task-card:hover { transform: translateY(-2px) }` はタッチでも `:hover` が付く。指を離す前にリンクがずれ、Safari が click を合成せず `onItemClick` も素の遷移も起きない。
- サイドバーの開閉フラグ自体は #78 のとおり自動では変えない。

## 決めたこと

| 事項 | 採用 |
|------|------|
| 合格条件の幅 | **ビューポート幅 `max-width: 700px`**（既存 `BOARD_MOBILE_MAX_PX`）。iPhone 15 Pro 縦はこの中。横向きなど 701px 以上は現行の複数列のまま（既知の制約） |
| シェル | **変えない**。サイドバーの縦積み・幅変更は別件。ボードは `.app-main`（`min-width: 0`）の残り幅に収める |
| 開閉フラグ | `collapsed` signal / localStorage も触らない |
| ボード列 | **`@media (max-width: 700px)` かつ `.board-page.board-mobile` の中だけ**。描画は既存の選択中 1 列のまま（全列の縦積みはしない）。`.board-columns` は `min-width: 0; width: 100%`。その 1 列は `flex: 1 1 auto; min-width: 0; width: 100%; max-width: 100%; box-sizing: border-box` |
| カード内 | `@media (max-width: 700px)` かつ `.board-page.board-mobile` の下でフッターを折り返し、`.detail-hint` の `nowrap` を解除 |
| タップ | `styles.css` の `.task-card:hover` を `.board-page .task-card:hover` に祖先限定し、`@media (hover: hover) and (pointer: fine)` のときだけ `translateY`。`touch-action` は足さない。`onItemClick` は `event.detail > 1` を無視（detail 0 のキーボード click は通す） |
| 余白 | 同じ media かつ `.board-page.board-mobile` で左右 padding を 12px |
| バックログ / シェル | **CSS も開閉も変えない** |

### 検討したが採らなかった案

- **狭い幅で collapsed を自動 true**: #78 が「ビューポートでは開閉状態を変えない」と決めている。CSS の縦積みで足りる。
- **サイドバーをドロワー化**: 範囲が広い。縦積みでカード幅は確保できる。
- **全列を縦積み**: 既存のステータスセレクト＋1列描画を壊す。選択中の1列を全幅にする。
- **アプリシェルの縦積み**: 詳細・バックログまでレイアウトが変わる。ボード列をメイン幅に収めるだけで足りる。
- **`touch-action: manipulation`**: ダブルタップズームまで切る。hover 停止とは別なので足さない。
- **バックログへ min-width を足す**: ボードの `min-width: max-content` とは別。今回は触らない。
- **cdkDrag をモバイルで外す**: ハンドルでの並べ替えは残す。タップ不達の主因は hover 移動。

## 受け入れ条件

1. 幅 700px 以下かつ `.board-mobile` では、選択中の 1 列が `.app-main` の内容幅に収まり、ボードが横にはみ出さない。
2. その条件ではカードフッターが列内で折り返す。
3. 細ポインタ以外ではボードカードの `translateY` が当たらない。無修飾の主クリック（detail 0 または 1）で詳細へ進む。detail > 1 は進まない。
4. 701px 以上は複数列・横スクロールを維持する。細ポインタの hover リフトも維持する。
5. サイドバーのトグル・幅・localStorage は変えない。
6. 既存テストに加え、(a) CSS に 700px かつ `.board-mobile` の min-width 解除と祖先付き hover 条件があること、(b) `onItemClick` 相当で detail 1 は遷移し detail 2 は遷移しないこと、を固定する。見た目だけの `pointer-events` 無効化は足さない。既存ドラッグハンドルの `aria-disabled` は今回直さない。

## 非目標

- バックエンド
- 詳細画面の全面改修
- スワイプ列切替
- サイドバー開閉の永続仕様変更

## 知見

- **L-792**: 上書きは `.board-page.board-mobile` 祖先。hover は `.board-page .task-card` に限定してからポインタ条件を付ける。
- **L-408**: `onItemClick` は `detail > 1` を捨てる。detail 0（キーボード）と detail 1（単タップ）は通す。サイドバーの repeat 抑止は触らない。
- **L-058**: 新規の見た目だけの無効（`pointer-events` のみ、`aria-disabled` のみ）は足さない。既存ハンドルは範囲外。

## リスク

- 縦積みでお気に入りがボードの上に来る。横はみ出しより優先する。
- `hover: hover` 非対応の古いブラウザではリフトが無い（タップ優先）。
