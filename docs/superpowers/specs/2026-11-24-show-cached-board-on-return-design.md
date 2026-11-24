# ボードやバックログに戻ったとき、前回の内容をすぐ表示する（#124）設計

## 背景

アイテム詳細からボード（またはバックログ）へ戻ると、画面が作り直され、読み込み中の表示だけになる。取得が終わってから、全カードを作り直す。直前の内容のキャッシュ（`ProjectBoardCache`）はあるが、使うのはプロジェクトを切り替えたときだけ。「一覧 → 詳細 → 戻る」のたびに、全件の転送と全カードの描画の待ちが出る（モバイルで体感できる）。

## 決めたこと

- **最初の読み込みでも、キャッシュがあればすぐ表示する。** ボード・バックログの `ngOnInit` から呼ぶ `load(true)` だけがキャッシュを使う（「再試行」ボタンの `load()` は使わない）。キャッシュの内容を `data`／`items`・`columns` に入れ、読み込み中の表示（スピナー）を出さずに、続けて最新を取得して差し替える。
- **取得が終わるまでは `loading` を true のままにする。** 並べ替え・ドラッグ・設定変更・自動反映は、これまでどおり `loading()` を条件に止まる。古い内容に対する編集を防ぐ。表示だけを `showingCached` で切り替える（`@if (loading() && !showingCached())` がスピナー）。これまで `loading()` を見ていなかった操作（ボードの「アイテムを追加」「列を追加」、モバイルの表示ステータス切替）も、`loading()` の間は止める（ボタンの `disabled` と、メソッドの先頭の判定）。以前は読み込み中にボードが描画されず、到達できなかった操作のため。
- **キャッシュに設定とバックログの列を足す。**
  - ボード: スナップショットに `settings`（レイアウトなど）を持たせる。保存の入り口（画面で読み込んだボード、プリフェッチ、更新）で、応答の `settings` も写す。`settings` が無いスナップショットは、レイアウトを決められないので使わない（スピナーのまま）。
  - バックログ: アイテムと、読み込んだときの列を組にして持つ（`putBacklog(id, items, columns)`、`getBacklogView`）。列が無ければ使わない。
- **応答が来たら、内容が変わっていなければ描画し直さない。** `sameJson` で比べ、同じなら `data`／`items`・`columns` を置き換えない（全カードの作り直しを避ける）。キャッシュ自体は常に最新で更新する。
- **取得に失敗したら、これまでどおりエラーの表示（再試行）にする。** 古い内容を出したままにしない。キャッシュを表示していた場合は、`data`／`items`・`columns` も空に戻す（AI チャットの候補に古い内容を残さない）。
- **キャッシュを表示してよい条件:** 表示中のプロジェクトが決まっていて（`activeId` あり）、プロジェクトの切替中でなく、ボードは保存した設定の `activeProjectId` が `activeId` と一致するときだけ。別のプロジェクトのスナップショットや、古いプリフェッチ由来の設定を出さない。
- **キャッシュ表示中にプロジェクトを切り替えたら、スピナーに戻す。** 旧プロジェクトの列と新プロジェクトのアイテムが混ざって見えるのを避ける（`reloadAfterProjectSwitch` の先頭で `showingCached` を false にする）。
- **キャッシュを最新に保つ:** モバイルで選んだ列を保存したら、その設定もキャッシュに反映する。バックログは、アイテムだけでなく列だけが変わったときもキャッシュを更新する。
- **スクロール位置の復元** は、キャッシュを表示した時点で予約する（既存の `scrollRestoreAttempted` で 1 回だけ）。
- **ログアウトでキャッシュを消す（セキュリティの #100）** は、既存の `AuthSession.clearSubject()`（`ProjectBoardCache.clear()`）で満たされている。今回は、キャッシュを使う側を足すだけで、消す仕組みは変えない。

## 受け入れ条件

各条件に、固定するテストを添える（`board-cached-return.spec.ts`・`backlog-cached-return.spec.ts` は両方、記載のないものはボード側）。

1. 戻ったとき、キャッシュがあれば、読み込み中の表示を挟まずに、前回の内容が出る（`shows the previous content at once, ...`）。
2. 最新が届いたら置き換わり、キャッシュも最新になる。内容が同じなら、置き換えない（`replaces the cached content with the response, ...`、`keeps the same ... when the response equals the cached ...`）。
3. 最新が届くまでは、編集と自動反映は止まったまま。ボードの追加・列の追加・モバイルの列切替も止まる（`keeps editing blocked until ...`、`refuses to open the add forms or change the mobile column ...`）。
4. キャッシュが無い・使えない（ボードの `settings` なし、バックログの列なし）、表示中のプロジェクトが無い、切替中、設定のプロジェクトが違うときは、これまでどおり読み込み中の表示（`shows the loading panel when ...`、`... while a project switch is in progress`、`does not show a board whose settings belong to another project`）。
5. 取得に失敗したら、古い内容でなく、エラーの表示になり、古いデータも残らない（`shows the error panel, not the stale cache, ...`、`drops the cached cards when the request fails, ...`）。
6. キャッシュ表示中にプロジェクトを切り替えたら、スピナーに戻る（`goes back to the loading panel when the project is switched ...`）。
7. 選んだモバイルの列がキャッシュに反映される（`saves the chosen mobile column into the cache`）。バックログの列だけの変更もキャッシュに反映される（自動反映の `apply` で、アイテムまたは列のどちらかが変わったときに更新する。この分岐を通す専用のテストは無い。保存と取得は `project-board-cache.spec.ts`、アイテムと列を組で持つことは `drops the earlier columns ...` で確認）。
8. キャッシュの `settings`・バックログの列が、コピーとして保存・取得され、`clear()` で消える（`project-board-cache.spec.ts`）。
9. ログアウトでキャッシュが消える（`auth-session.spec.ts` の `clearSubject clears board cache ...`。設定つきのボードとバックログの表示用データも消えることを確認）。
10. 既存のテストが通る（`ng test` 全体）。

## 範囲外

- バックログのプリフェッチ（`prefetchBacklog`）は、アイテムだけを入れて列は入れない。その状態では、バックログは即表示にならず、これまでどおりスピナーになる（ボードのプリフェッチは設定も入れるので、即表示できる）。
- `reloadAfterProjectSwitch` は `loading` を変えない。キャッシュ表示中に切り替えると、`showingCached` だけが false に戻り、応答までスピナー（`loading` は true のまま）になる。

- アイテム詳細やほかの画面のキャッシュ。
- キャッシュの有効期限（古さに関わらず、最新を取得して差し替える）。
- ページの再読み込み（F5）後のキャッシュ（メモリ上のキャッシュなので、再読み込みでは消える）。

## 実装プラン

変更が小さい（キャッシュ 1 ファイルと、ボード・バックログの読み込み）ため、実装プランは作らず、設計書のサブエージェントレビューも省く。
