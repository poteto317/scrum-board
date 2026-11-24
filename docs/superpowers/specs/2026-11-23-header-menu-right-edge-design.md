# ハンバーガーメニューをヘッダーの一番右へ（アイテム #139）

## 背景

アイテム #139「ハンバーガーメニューの場所をヘッダーの一番右まで持っていく」。説明は「今の場所は思っていたところにない。」。

アイテム #69 の設計（`2026-11-19-header-hamburger-menu-design.md`）は、ハンバーガーを「ヘッダー右端」に置き、`Personal workspace` / avatar をその左に残すとしていた。実装も `.header-menu-root` に `margin-left: auto` を付けていた。

## 原因

`.app-header` は `display: flex` で、その直接の子は `<app-header-menu>` のホスト要素である（フレックスアイテム。`display` が `inline` でもブロック化される）。`margin-left: auto` は `.header-menu-root`（ホストの子）に付いており、フレックスアイテムではないので効かない。ホスト（フレックスアイテム）に `margin-left: auto` が無いので、余白が分配されず、ホストは中身の幅だけを取って、前の要素（`.header-end`）のすぐ右に並ぶ。実際の画面では、ハンバーガーが avatar の直後（ヘッダーの中ほど）に出る。同じ理由で、`.header-menu-root` の `flex-shrink: 0` も、親がフレックスコンテナではないので効かない。

## 決めたこと

| 事項 | 採用 |
|------|------|
| 直し方 | `HeaderMenu` のホスト要素（`:host`）に `margin-left: auto; flex-shrink: 0` を付ける。`display: block` も付ける（カスタム要素を明示的にブロックにするための任意の指定で、直す要因ではない）。`.header-menu-root` から、効かない `margin-left: auto` と `flex-shrink: 0` の両方を外し、`position: relative`（ポップオーバーの基準）は残す |
| 並び | 変えない。DOM の順序（`.header-end` の後に `app-header-menu`）はそのまま。`.header-end` はプロジェクト選択の隣に残る |
| モバイル（680px 以下） | `.header-end` が非表示になっても、ハンバーガーは右端のまま。`app.css` の `.app-nav { margin-left: auto }` は、ヘッダー内に対象が無い（`.app-nav` はサイドバーの縦並びの `nav`）ので、ヘッダーの配置に影響せず、触らない |
| ポップオーバー | `.header-menu-popover` は `.header-menu-root` 基準の `right: 0` で、右端に収まる。変えない |
| 範囲 | CSS とそのテストだけ。メニューの項目・設定・API は変えない |

## 受け入れ条件

1. 画面幅 1456px / 1024px / 681px / 680px / 375px（680px の前後で、`.header-end` の表示と内側余白が切り替わるので、境界の両側を測る）で、ハンバーガーのボタンの右端が、ヘッダーの右の内側余白（40px、680px 以下は 20px）の位置に来る。
2. ポップオーバーを開いても、画面の外にはみ出さない（既存の挙動のまま）。
3. `.header-end`（ユーザー名・avatar）の位置は、プロジェクト選択の隣のまま変わらない。
4. 自動テスト（jsdom の Vitest。jsdom は配置を計算せず、宣言された値を返す）: `app-header-menu` が `.app-header` の最後の直接の子で、その計算済みスタイルの `margin-left` が `auto`、`flex-shrink` が `0`（jsdom は `:host` の宣言を解決して値を返すことを実装時に確認したので、`getComputedStyle` で検証する）。判別の本体はこの 2 つで、`display: block` は補助（実ブラウザーでは、フレックスアイテムは `:host` を付けなくてもブロック化されるので、`display` では `:host` の有無を判別できない）。実ブラウザーの位置は条件 5 で測る（実ブラウザーの計算済みの `margin-left` は解決後のピクセル値になる）。
5. 実ブラウザー（jsdom は配置を計算しない）で、位置を測って確認する。

## 決めなかったこと

- ハンバーガーのボタンの大きさ・デザイン、メニューの内容の変更。
- `.header-end` を右へ寄せる変更（ユーザーが指定したのはハンバーガーだけ）。
