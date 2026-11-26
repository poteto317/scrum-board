# カード #154: トップに戻るボタン（設計）

## 目的

アイテムが多いと、ページの先頭まで戻るスクロールに時間と手間がかかる。ページを下へスクロールしたときだけ、右下に「トップに戻る」ボタンを出し、押すとページの先頭へ戻れるようにする。

## 前提（今のレイアウト）

- ページの縦スクロールは文書（`window`）が持つ。ボードもバックログも、ページの高さは `min-height` で、一覧が伸びると文書が伸びる（バックログの `.backlog-scroll` は `overflow: auto` だが、親が `min-height` のため通常は文書がスクロールする。`backlog.ts` の位置の計算も `.backlog-scroll` の `scrollTop` と `window.scrollY` を足している）。そこで、見るのは `window.scrollY`、戻す先も `window` にする。`page-scroll.ts` の `pageScrollElement()` はドラッグ中の自動スクロール用で、`scroll` イベントの受け口と `scrollTo` の動き（smooth）を持たないため使わない。
- 右下には、ボード・バックログ・アイテム詳細だけ「AIに聞く」ボタン（`.ai-chat-fab-entry`、`position: fixed; right: 1.25rem; bottom: 1.25rem`）が出る（`App.showAiChatFab()`）。AI チャットのドックを開くと、右端に幅 `--ai-chat-dock-width` のパネルが出る（`App.dockOpen()`）。

## 変更

1. `frontend/src/app/back-to-top.ts`（新規、純粋な関数）
   - `isBackToTopVisible({ scrollY, viewportHeight, focused }): boolean` — `focused`（キーボードのフォーカスがある）なら `true`。それ以外は、`viewportHeight > 0` かつ `scrollY > viewportHeight / 2`（画面の半分より下へスクロールした）のとき `true`。一番上付近（半画面以内）では出さない。
   - `backToTopScrollBehavior(reducedMotion: boolean): ScrollBehavior` — `reducedMotion` なら `'auto'`（即座に移動）、そうでなければ `'smooth'`。
2. `frontend/src/app/back-to-top.component.ts`（新規、部品は 1 つだけ）
   - セレクタ `app-back-to-top`。`window` の `scroll`・`resize` を受けて（`passive: true`、破棄時に外す）、`scrollY` と `innerHeight` を signal に入れ、`isBackToTopVisible` で表示を決める。ボタンの `blur` でも `scrollY` と `innerHeight` を読み直す（次の `scroll` を待たずに、その場で表示を決め直す）。
   - 表示中だけ `<button type="button" class="secondary back-to-top">トップに戻る</button>` を描く（ラベルは表示の文字そのもの。`aria-live` は使わない）。押すと `window.scrollTo({ top: 0, behavior })`。`behavior` は `matchMedia('(prefers-reduced-motion: reduce)')` の結果を `backToTopScrollBehavior` に渡して決める。フォーカスは動かさない。
   - フォーカスを body に落とさない: ボタンの `focus`・`blur` で `focused` を持ち、フォーカスがある間は、先頭へ戻っても消さない（`isBackToTopVisible` の `focused`）。フォーカスが外れたら、その場で読み直した位置が半画面以内なら消える。
   - 入力 `aiChatFab: boolean`、`dockOpen: boolean` を受け、ホスト要素にクラス `with-ai-chat-fab`・`dock-open` を付ける（`host: { '[class.with-ai-chat-fab]': 'aiChatFab()', '[class.dock-open]': 'dockOpen()' }`）。位置の指定はボタン（`.back-to-top`）に当て、ホストのクラスは `:host(.with-ai-chat-fab) .back-to-top` のように使う（下記）。
3. `frontend/src/app/app.html`・`app.ts`
   - 画面の枠（`showChrome()`）の中、`@if (showAiChatFab())` の外（その `@if` の直前）に `<app-back-to-top [aiChatFab]="showAiChatFab()" [dockOpen]="dockOpen()" />` を 1 回だけ置く。これで、ログイン画面以外のすべてのページ（ボード、バックログ、アイテム詳細、スプリント、アーカイブ、ゴミ箱、設定など）に出る。ページごとのコピーはしない。
4. `frontend/src/app/back-to-top.component.css`（新規）
   - 規則はすべてボタン（`.back-to-top`）に当てる。見た目は既存の `.secondary`（枠・背景・文字色・角丸・余白）のまま。影とアイコンは足さない。`position: fixed; right: 1.25rem; bottom: 1.25rem; z-index: 11`（ドック 12・「AIに聞く」13 より下）。`min-height: 44px`（押しやすい大きさ）。
   - 「AIに聞く」が出るページ（`:host(.with-ai-chat-fab) .back-to-top`）では、そのボタンの上へ積む: `bottom: 4.5rem`（72px）。「AIに聞く」は下端 20px（1.25rem）から、高さ約 42px（`padding: 0.65rem` の上下 約 21px ＋文字の行 約 17px ＋枠 2px）で、上端は約 62px。72px ならその上に約 10px の隙間ができる。
   - ドックが開いている間（`:host(.dock-open) .back-to-top`）は、ドックの左へ寄せる: `right: calc(var(--ai-chat-dock-width) + 1.25rem)`。狭い画面（639px 以下）ではドックが画面幅いっぱい（`min(100vw, 28rem)`）を覆いうるため、`@media (max-width: 639px)` の中で `:host(.dock-open) .back-to-top { display: none }` にする（ドックの中で操作している間は不要）。

## 決めたこと

- 出すしきい値は「画面の高さの半分より下」。固定の px より、画面の大きさに合う。
- 出すページは、画面の枠を持つすべてのページ（部品を `App` に 1 回置くため）。短いページではスクロールしないので出ない。
- 押した後のフォーカスはボタンのまま。先頭の見出しへは移さない。キーボードでフォーカスがある間はボタンを消さない（body に落とさない）。マウス・タッチで押して入ったフォーカス（`pointerdown` の直後の `focus`）は保たず、先頭に戻ったら消える（先頭なのにボタンが残り続けるのを避ける）。押し終わり（`pointerup`・`pointercancel`・`pointerleave`）で印を戻す。押してもフォーカスが入らないブラウザ（Safari）や、指を外へずらして離した・タッチが取り消された場合にも印が残らず、後のキーボードのフォーカスを取り違えない。
- 出る・消えるときの読み上げの通知はしない（`aria-live` なし）。
- バックログの `.backlog-scroll` など、内側のスクロール領域は対象外（通常は文書がスクロールするため）。

## 知見の反映

- L-154（固定の aria-label が状態に追従しない）: `aria-label` は付けず、ラベルは表示の文字「トップに戻る」だけ。状態でラベルが変わる場面は無い。
- L-887（固定オーバーレイ）: ボタンは行に紐づかない固定要素で、表示は文書のスクロール位置だけで決まる。重なりは z-index（ボタン 11、ドック 12、「AIに聞く」13）と、`with-ai-chat-fab`・`dock-open` での位置の切り替えで避ける。
- 狭い画面でドックが開くときに隠す件: ドックを開くには「AIに聞く」を押す（フォーカスはそちらへ移る）ため、トップに戻るボタンにフォーカスがある状態で隠れることは無い。

## テスト

- `back-to-top.spec.ts`: `isBackToTopVisible` の境界（0、半画面ちょうど、半画面を超える、`viewportHeight` 0、`focused`）と、`backToTopScrollBehavior` の 2 値。
- `back-to-top.component.spec.ts`: 先頭ではボタンが無い。`scrollY` を半画面より下にして `scroll` を送るとボタンが出て、`type="button"`・文字「トップに戻る」・`aria-live` なし。押すと `window.scrollTo` が `{ top: 0, behavior: 'smooth' }`（reduced なら `'auto'`）で呼ばれる。キーボードのフォーカス中は先頭へ戻っても消えず、blur でその場で消える。`pointerdown` の直後の `focus` は保たない。押し終わり（`pointerup`・`pointercancel`・`pointerleave`）の後のキーボードの `focus` は保つ。入力 `aiChatFab`・`dockOpen` に応じて、ホストに `with-ai-chat-fab`・`dock-open` が付く。
- `app.spec.ts`: 枠のあるページに `app-back-to-top` が 1 つある。

## 範囲外

無限スクロールの変更、ページの途中の目次、スクロール位置の保存。バックエンドは触らない。
