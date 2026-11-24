# ドラッグ中に、ボード全体を毎回再チェックしないようにする（#127）設計

## 背景

アプリは Angular 21 で、zone.js を使わない（zoneless）。テンプレートのイベント出力（`(cdkDragMoved)`、`(dragover)` など）は、イベントのたびにそのビューを dirty にして、変更検知を予約する。どのコンポーネントにも `OnPush` が無いので、予約された変更検知は、ボード（またはバックログ）の全カードのバインディングを評価し直す。

- **ボード:** カードのドラッグ中、ポインターが動くたびに `(cdkDragMoved)` が発火し、全カードの番号の整形・リンクの組み立てなどを再評価する。
- **バックログ:** `dragover`（数十ミリ秒ごと）のたびに、同じ再評価に加えて、全行の位置を測り（`getBoundingClientRect`）、レイアウトの再計算を強制していた。

## 決めたこと

- **ボード:** テンプレートの `(cdkDragMoved)` をやめ、ドラッグの開始（`onItemDragStarted`）で、そのドラッグの `moved` を直接購読する。購読はドラッグの終了（`onItemDragEnded`）と破棄で解除する。購読のコールバックは、テンプレートのイベント出力と違い、ビューを dirty にしない。ポインターの位置からの自動スクロールは従来のまま（DOM を直接動かすだけ）。ドラッグの開始と終了の信号（`draggingItemId`）が変わるときだけ、変更検知が走る。
- **バックログ:** テンプレートの `(dragover)` をやめ、ドラッグの間だけ直接聞く。
  - `dragover` は `document` に登録する。対象がスクロール枠の中のときだけ処理する（ドラッグ中に、読み込み・エラー・一覧の表示の切り替えで枠の要素が作り直されても、登録が失われない。リストの外の `dragover` には触らない）。
  - 行の位置は、ドラッグの開始時に 1 回だけ測り、その後は、リストとページのスクロールの変化分だけずらして使う。ドロップ位置の表示は `box-shadow` で、行の位置を動かさないので、表示のたびの測り直しは要らない。
  - 測り直すのは、行の要素が測ったものと違うとき（自動反映などで再描画・並べ替えされた。行の数が同じでも）と、ウィンドウの大きさが変わったとき（`resize` も、ドラッグの間だけ聞く）。
  - ドラッグ元の行が消えたとき（`dragend` が届かない）は、ドラッグを終わらせて登録を外す。
- **範囲外にしたこと:** カードを `OnPush` の子コンポーネントに切り出すこと、リンク・番号の表示を事前に計算しておくこと。ドラッグ中の毎回の再チェックは、変更検知が走らなくなったことで起きなくなる。ドラッグの開始・終了、フィルタの入力、コピーの通知で全件の再チェックが走る点は、このカードの完了条件（ドラッグ中に、動かしていないカードの再評価が走らない）の外なので、別の課題にする。

## 受け入れ条件

1. ボードで、カードを実際のマウスのドラッグで動かしている間、ポインターが動くだけでは、カードのバインディングが再評価されない（`drag-change-detection.spec.ts` の `runs no change detection while a real mouse drag only moves`）。
2. ボードで、ドラッグの端での自動スクロールが従来どおり動く（既存の `board-cdk-wiring.spec.ts`、`board-card-reorder-state.spec.ts`）。ドラッグの `moved` が購読され、終了で解除される（`takes the pointer from the drag it started ...`）。
3. バックログで、`dragover` が繰り返されても、カードのバインディングが再評価されず、行は 1 回しか測られない（`runs no change detection, and measures the rows once, while dragover repeats`）。
4. バックログで、ドラッグ中にリストがスクロールしても（下へも上へも）、ページがスクロールしても、ドロップ位置が、測り直さずに、スクロール分だけずれて計算される（`follows the list when it scrolls down during the drag, ...`、`follows the list when it scrolls back up during the drag`、`follows the page when it scrolls (window.scrollY) during the drag`）。
5. バックログで、行の要素が変わったときは、数が同じでも測り直す（`measures again when the list has more rows than were measured at the start`、`measures again when the same number of rows are re-ordered during the drag`）。ウィンドウの大きさが変わったときも測り直す（`measures again when the window is resized during the drag`）。
6. バックログで、ドロップ位置がビューに反映される（`shows the drop slot in the view`）。リストの外の `dragover` には触らない（`leaves a dragover outside the list alone`）。
7. バックログで、ドラッグの終了・ドラッグ中の破棄・ドラッグ元の行の消失で、`dragover` の登録が外れる（`stops listening when the drag ends`、`stops listening when the page is destroyed in the middle of a drag`、`ends the drag when the dragged row disappears and no dragend can come`）。
8. ボードで、連続したドラッグは 1 つずつ聞き、破棄で外す（`board-card-reorder-state.spec.ts` の `listens to one drag at a time: ...`）。
9. 既存のテストが通る（`ng test` 全体）。

## 実装プラン

変更が小さい（`board.ts/html`・`backlog.ts/html` の 2 画面）ため、実装プランは作らず、設計書のサブエージェントレビューも省く。
