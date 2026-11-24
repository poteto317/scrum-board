# ハンバーガーメニューをヘッダーの一番右へ（#139）実装プラン

設計書: `docs/superpowers/specs/2026-11-23-header-menu-right-edge-design.md`

## ファイル

- 変更: `frontend/src/app/header-menu.component.css`（`:host` を追加し、`.header-menu-root` の `margin-left: auto` と `flex-shrink: 0` を外す。`position: relative` は残す）
- 変更: `frontend/src/app/header-menu.component.spec.ts`（既存のテスト `places hamburger outside .header-end with margin-left auto`を書き換える。新しいテストは足さず、既存の誤ったテストの置き換えにする。`app.spec.ts` は触らない）

## 既存のテストについて

既存のテストは、`.header-menu-root`（ホストの子）の計算済みスタイルの `margin-left` が `auto` であることを検証していた。これがまさにバグの本体（フレックスアイテムではない要素に付いていて効かない）を「正しい」としていたので、バグの間も通っていた。この修正で `.header-menu-root` から `margin-left: auto` を外すので、このテストは必ず落ちる。ホスト（`app-header-menu`）を対象にした検証へ書き換える。

## Task 1: テストを書き換えて、失敗させる

- [ ] `header-menu.component.spec.ts` の既存のテストを書き換える。
  - テスト名を `places the hamburger host last in .app-header with margin-left auto` のように、ホストに付くことが分かる名前にする。
  - 既存の検証（`.header-end` が `app-header-menu` より前にあること、`#project-add` が無いこと）は残す。
  - `menu`（`app-header-menu` のホスト）が `.app-header` の最後の直接の子であること（`header.lastElementChild === menu`）を検証する。
  - `getComputedStyle(menu)` の `marginLeft` が `'auto'`、`flexShrink` が `'0'` であることを検証する。`.header-menu-root` の `marginLeft` の検証は外す。
  - `display` は検証しない（実ブラウザーでフレックスアイテムは `:host` が無くてもブロック化されるので、`:host` の有無の判別にならない。`display: block` はコメント付きの任意指定）。
- [ ] `cd frontend && npm test -- --watch=false` を実行し、書き換えたテストが落ちることを確認する。失敗の理由が、`marginLeft` の比較（`expected '' to be 'auto'` に相当）であることを確認する（要素が `null`・描画エラーなど別の理由で落ちていないこと）。
- [ ] 判別のため、テストを落とす前に `:host { margin-left: auto; flex-shrink: 0; }` を一時的に足して jsdom が値を返すかを確かめ、すぐ戻す。値が返らない（`:host` を解決しない）場合は、`getComputedStyle` の検証を、`document.querySelectorAll('style')` の本文を結合して `:host`（エンキャプス属性付き）のブロックに `margin-left: auto` と `flex-shrink: 0` があることを正規表現で確かめる検証に置き換える（知見 L-795: dev-flow-kit の lessons/review-lessons.md）。`lastElementChild` の検証は残す。設計書の条件 4 は、どちらの方法でも `margin-left: auto` と `flex-shrink: 0` の両方を固定することとする。

## Task 2: CSS を直す

- [ ] `header-menu.component.css` の先頭に、コメント付きで `:host { display: block; margin-left: auto; flex-shrink: 0; }` を足す（コメント: ホストが `.app-header` の flex の子なので、右端に寄せるにはホストに付ける）。
- [ ] `.header-menu-root` から `margin-left: auto` と `flex-shrink: 0` を外す（`position: relative` は残す）。
- [ ] テストを実行し、Task 1 のテストが通り、他のテストが落ちないことを確認する。

## Task 3: 検証

- [ ] `cd frontend && npx prettier --check "src/**/*.{ts,html,css}" && npm test -- --watch=false && npm run build`。
- [ ] 変異の確認（各変異の前に Task 2 後のテストが通ることを確認し、変異後に `git diff` で適用を確認し、失敗メッセージが該当の `expect` であることを確認し、戻した後に `git diff` が Task 2 の差分と一致することを確認する。それぞれ、Task 1 のテストが落ちることを確認してから戻す）: (a) `:host` の `margin-left: auto` を外す、(b) `:host` の `flex-shrink: 0` を外す、(c) `app.html` の `app-header-menu` を `.header-end` の前へ動かす。
- [ ] 実ブラウザーで位置を測る（設計書の受け入れ条件 1・3）。本番のボードの画面に、`app-header-menu { display: block; margin-left: auto; flex-shrink: 0; }` と、既存ルールの打ち消し `.header-menu-root { margin-left: 0; flex-shrink: 1; }` を一時的なスタイルとして注入し（`:host` はグローバル CSS では効かないのでホスト名のセレクターに書き換え、注入後に `app-header-menu` の計算済みスタイルを確かめてから測る。再読み込みで消える。サーバーには何も書かない）、幅 1456px / 1024px / 681px / 680px / 375px で測る。
  - 注入する前に、各幅で `.header-end` の `getBoundingClientRect().left` とボタンの右端を記録し、注入後の値と比べる。
  - ボタンの右端と `.app-header` の右端の距離は、681px 以上で 40px、680px 以下で 20px。
  - `.header-end` が動かないことの比較は、681px 以上だけ（680px 以下は `display: none`）。
  - ポップオーバーを開いて、画面の内側に収まることを確認する。
- [ ] 変更はコミットしない（後続の `/commit-ja` が行う）。

## 気をつける知見

- jsdom はレイアウトを計算しないので、自動テストは「規則の存在（computed style）」を固定し、位置は実ブラウザーで測る（CSS の値だけを変える差分は、実測で確かめる）。
- フレックスの子（ホスト要素）と、その内側の要素を取り違えない。既存のテストが取り違えたまま「正しい」と検証していたので、直すときは、そのテストの対象も確かめる。
