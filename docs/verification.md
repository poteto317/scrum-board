# 検証記録

主要機能の確認内容の要約です。アプリ手順の正本は [README](../README.md)、HTTP API 契約の正本は [OpenAPI](openapi.yaml) です（[短い API 案内](api.md) は非規範）。個人の作業メモやローカルボードのアイテム番号は含みません。

## 自動化

- Go: `go test -race ./...`、`go vet ./...`（専用 MySQL 向け統合テストは `KANBAN_TEST_DSN` 指定時。未指定は skip）
- Angular: 単体テストと本番ビルド（`npm test -- --watch=false`、`npm run build`）

## Docker / smoke

- Compose で MySQL・Go API・Nginx 配信の Angular が起動すること
- 使い捨ての Compose プロジェクト（別ポート・`-p`）で `scripts/smoke.py` による API 直通と Web プロキシ経由の受け入れ確認（手順は README）

## 機能ごとの確認（要約）

### MVP 基盤

- 実 MySQL での CRUD、Unicode、部分更新、ステータス変更、同名列 409、不正入力 400、削除後 404
- 再起動前後のボード JSON 一致、初期サンプルの重複なし
- 狭い画面での列横スクロール、広い画面での縦積み・折返し

### タスク番号

- 表示用 `number` と内部 `id` の分離、詳細 URL は `/items/:number`
- 採番の冪等性、作成失敗時の番号非消費、削除後の非再利用、並行作成

### ステータス変更 API

- `PATCH /api/items/by-number/{number}/status` による列名指定の変更
- 交差する number/id、境界値、失敗時の非更新と内部詳細の非漏洩

### GitHub PR 紐付け

- HTTPS の PR URL のみ保存、trim、解除、部分更新での保持
- 補助表移行・rollback・削除 cascade、同時初回保存時の deadlock 回避

### 詳細の自動保存

- デバウンス / 最大間隔 / blur / ステータス変更での保存
- IME 中の非送信、失敗時の入力保持、ルート再利用・遷移前 flush

### 変更履歴と復元

- 作成・更新の同トランザクション追記、no-op 非増加、ページング
- 導入時 baseline、専用 CLI による過去記録の import（冪等・全体 rollback）

### AI で整えて Todo 起票

- 偽 Anthropic サーバーでのリクエスト形・失敗分類・センチネル非漏洩の単体/統合確認
- **実 Claude API への接続確認は未実施**（鍵設定後は `POST /api/items/refined` を実キーで1回呼び、契約は OpenAPI の同 path を参照）
- `scripts/smoke.py` は課金のため新エンドポイントを呼ばない

### 文字サイズ拡大

- CSS の文字サイズ拡大と固定寸法の調整、複数幅での横溢れ回帰の解消
- HTML / TypeScript / API / DB は変更なし

### 文字サイズ縮小

- CSS の文字サイズを現状の約0.8倍に縮小し、関連固定寸法・列幅帯を調整
- HTML / TypeScript / API / DB は変更なし
- 複数幅（1440 / 列幅帯境界 / 680 ヘッダー境界 / 375）での表示確認
- 列幅帯修正後に 1051→237px・1052→256px の境界を再確認

### 列の並び替え

- `PUT /api/columns/order` と UI のドラッグ&ドロップ / キーボード並び替え
- 400 / 409 / 永続化、並び替え後の列追加、専用 Compose での smoke

### カード自由配置（高さを保つ横移動）

- 初回（未設定）は上詰め（`pack`）。見た目・操作は従来どおり
- ツールバー「自由配置」トグルで `pack` ↔ `free`。読込中・失敗中・設定保存中・並び替え保存中・切替シーケンス中・カードドラッグ中は切替不可（理由を aria / 短文で示す）
- `pack` → `free`: DOM 計測で全カードの `offsetY` を `PUT /api/items/order`（`offsetYs`）→ 成功後に `PATCH /api/board/settings`。どちらか失敗で設定は `free` にせず UI を戻しバナーで知らせる
- `free` → `pack`: `PATCH /api/board/settings`。応答の `items` でボードを置換（再 GET しない）。失敗時はトグルを戻す
- `free` では絶対配置。列間ドロップで `offsetY` 不変（高さ維持）。同列ドロップで掴みオフセット込みのカード上端 Y を更新し空きが残る。CDK sorting 無効・`connectedTo` 維持。上下矢印キー並べ替えは `pack` のみ
- ライブ更新（ポーリング）で `settings` / `offsetY` が落ちないこと。再読込・別クライアントでもサーバーから復元
- `GET /api/board` の `settings` / `offsetY`、`PATCH /api/board/settings`、`PUT /api/items/order` の `offsetYs`（省略時は offset 維持・長不一致/負/小数/100000 超・`columns[]` 未知フィールドは 400）

### アイテムの並び替え・列間移動

- `PUT /api/items/order` と CDK ドラッグ&ドロップ（列内・列間）/ 上下キー
- 複数 PR を持つアイテム: `GET /api/board`・バックログ・並び替え（`PUT /api/items/order`、`PUT /api/backlog/order`）・列移動の応答に重複や欠落がなく、`prUrls` が登録順で保たれ、並び替え・列移動の履歴は status だけが変わること（`TestMultiPRCardsStayWholeThroughEveryReadAndMoveMySQL`）。`prUrls` の更新は全列ロックで直列化され、並行初回保存で 1213 にならないこと
- アイテムのドラッグ開始領域の限定（左端中央ハンドル `.card-drag-handle`）: `<article class="task-card" cdkDrag>` の直下にドラッグハンドル `<button type="button" class="card-drag-handle" cdkDragHandle>`（`⋮⋮` アイコン、アイテム左端の上下中央に常時表示）、`<div class="card-quick-actions">`（コマンドメニューとコピーボタン `<button class="copy-card-link">`）、本文リンク `<a class="task-card-body" href>` を兄弟として配置。コピーボタンは `.card-quick-actions` の中にあり、本文リンクの中にはない。マウスドラッグ（8px 閾値）およびタッチ長押しドラッグ（200ms 遅延）は `.card-drag-handle` からのみ開始でき、`.task-card`・`.task-card-body`・`.copy-card-link` からはドラッグが開始されないこと。`.task-card-body` の通常クリックと Enter は詳細へ遷移し、Ctrl/Cmd 付きのクリックはブラウザー既定に任せ、`.card-drag-handle` の単なるクリックやドラッグ後は遷移が起きないこと
- ボードの自動反映（5 秒ごとのポーリング。`startLiveRefresh`）との両立: アイテムのドラッグ中・保存中（`reordering` / `saving`）・作成モーダル表示中・列のドラッグ中は、ボードを更新しない（取得もしない）。ドラッグは `cdkDragStarted` から `cdkDragEnded`（離してからプレビューが戻り終わるまでの最大 300ms を含む）まで。CDK はドロップのインデックスをドラッグ開始時のリストに対して出すので、ドラッグ中にボードが差し替わると別のアイテムが動いて保存される。再現していた条件は、Todo に A〜E を置き、B を掴んだまま別経路で A を消して 5 秒待ってからドロップする、というもの（修正前の PUT は `[B,D,E,C]` で、B ではなく C が動いた）。修正後は動くのは B で、PUT の `itemIds` は掴んだときの並び `[A,B,C,D,E]` を元にした `[A,C,D,B,E]` になる（A は消えているのでサーバーは 409 を返し、誤ったアイテムは保存されない。画面は元に戻り、次のポーリングで `[B,C,D,E]` になる）。別経路で並びだけを変えた場合（同じアイテム集合）は 200 で保存され、動くのは掴んだアイテムである。ドロップ時は、`item.data` の id が移動元の `previousIndex` のアイテムと一致しなければ何も保存しない。ドラッグが終われば（no-op のドロップを含む）ポーリングは再開し、次の取得で別経路の変更が入る。保存より前に出した取得の遅い応答が、保存した順序を巻き戻さない（応答は、取得を始めたときの `data` のままのときだけ適用）。実ブラウザー（使い捨て MySQL につないだ別ポートの API と `ng serve`。マウスイベントを JavaScript から `mousedown` → 段階的な `mousemove` → 待つ → `mouseup` で送る）で、修正前のコードは上の `[B,D,E,C]` を再現し、修正後は、掴んでいる間は 12 秒待っても画面が差し替わらず取得のリクエストも出ない（ドロップ後に再開し、5 秒後には最新の `[B,C,D,E]` になる）ことを確認。`board-card-drag-live-refresh.spec.ts`（fake timers と `Api.board` のモック。実マウスのドラッグも含む）で、ガードを 1 つずつ外す変異（`enabled` から `draggingCardId` を外す／照合を外す／古い応答のフィルターを外す／`ended` で下ろさない／`released` で下ろす／立てない）がどれも落ちることを確認
- コピーボタン（アイテムリンクのコピー機能との両立）: 単なるクリックは URL のコピーだけで、遷移も並べ替えも起きない。コピーボタンや本文リンク上からドラッグしてもアイテムは移動しない。上下矢印キー（↑/↓）による列内移動は `.card-drag-handle` にフォーカスがあるときのみ動作し、移動完了・失敗後も `.card-drag-handle` にフォーカスが残ること（コピーボタンや本文リンク上の ↑/↓ ではアイテムは動かない）
- タッチ: ハンドル（`.card-drag-handle`）を 200ms 押し続けてから動かしたときだけドラッグが始まり（マウスはハンドル上で 8px 移動時に即時開始）、押し続けずにスワイプしたときやハンドル以外（`.task-card`・`.task-card-body`・`.copy-card-link`）を触ったときはドラッグが始まらず、`touchmove` が `preventDefault` されないこと
- ドラッグ中、ポインターを端に置いたまま動かさなくてもボード（横）とページ（縦）がスクロールし続け、ドロップで止まること（実ブラウザーで、端に 1.5 秒静止して横に約 460px 進むことを確認）。列ごとに縦スクロールバーは出ないこと
- キーボード操作のアナウンスに移動後の位置が入り、続けて動かしても毎回読み上げられること。アイテムのフォーカス枠が `.card-list` の padding 内で切れないこと（実ブラウザーの Tab キーで確認）
- 400 / 409 / 永続化、詳細ステータス移動が末尾、再起動で DnD 順が消えないこと
- 使い捨て MySQL（`scrumboard_numbering_test`）で、`CreateItem` / `UpdateItem`（列移動・タイトル・説明の編集。PR リンクの書き換えは別のテストで固定）/ `DeleteItem` / `ReorderItems` の並行混在が MySQL 1213（デッドロック）にならないこと（ストレステスト。交差が起きるかはタイミング次第で、`CreateItem` / `UpdateItem` が全列ロックを取っていなかった修正前は reorder の大半が 1213 になった）。あわせて、決定的なテストで、7 つのアイテム書き込み経路（作成・列移動・PR リンクの書き換えを伴う更新・削除・アイテムの並べ替え・バックログの並べ替え・履歴取り込み）がどれも、別のトランザクションが全列ロックを保持している間は、アイテム行に触れる前にそこで待つことを確認する（どの経路のロックを外してもこのテストが落ちる）。履歴取り込み（`ImportHistory`）も、`ReorderItems` / `CreateItem` と交差してデッドロックしないこと（決定的テスト。修正前は取り込み側が 1213 で失敗）。`ReorderItems` の 409 / 400 が、古いアイテム集合・他列のアイテム混入・存在しない列などで返り、DB が変わらないこと
- 列内の並び替えや位置のずれで、触っていないアイテムの `updatedAt` が変わらないこと（列が変わったアイテムだけ更新）
- `position` 列のない旧スキーマの DB から `InitializeCardPositions` で `created_at, id` 順に採番され、再起動で手動の順序が保たれ、`updatedAt` が変わらないこと
- `go test` / `npm test -- --watch=false`（全件）/ `npm run build`

### プロダクトバックログ

- `GET /api/backlog` / `PUT /api/backlog/order` と `/backlog` UI のドラッグ&ドロップ / 上下キー並び替え
- 全ステータス（Done 含む）表示、バックログ／ボードからの新規追加（ステータス選択なし・常に Todo）
- 400 / 409 / 永続化、並び替え後のアイテム追加が末尾、Create と Reorder の並行
- `ReorderBacklog` もアイテム行に触れる前に全列ロック（`lockColumnRows`）を取り、`ReorderItems` / `CreateItem` / `UpdateItem` / `DeleteItem` / `ImportHistory` と交差してデッドロックしないこと（使い捨て MySQL の決定的テスト `TestCardWritersQueueOnTheAllColumnsLockMySQL` で、`ReorderBacklog` のロックを外すと落ちることを確認。統合前の `ReorderBacklog`（`items` を主キー順にロックするだけ）は、`ReorderItems` と 80 並行で混在させると約 3 分の 1 が MySQL 1213 になることをレビューで実測した。マージ時にこのリポジトリの Go テストで並行ストレステストを組んだが交差を再現できず検出力がなかったため、決定的テストを根拠にする）
- アイテムの `position`（列内の並び順）と `backlogPosition`（バックログの優先順位）が独立していること。一方の並び替えがもう一方を変えないこと

### コマンドテンプレート

- `GET` / `POST` / `PATCH` / `DELETE /api/command-templates`。作成は 201、部分更新は 200、削除は 204。`name` は前後空白を除去し、`template` は除去しない。制御文字、長さ（`name` 1〜60、`template` 1〜2000）、型不正、未知フィールド、空の PATCH は 400。全体 50 件を超える作成は 400。無い id は 404。プレースホルダクエリだけで保存し、サーバーは文字列を実行せず `{{url}}` も置換しない
- フロントの `resolveCommand` はリテラル `{{url}}` だけを、そのアイテムの絶対詳細 URL（`origin + /items/{number}`）へ置換する。複数の `{{url}}` はすべて置換し、`{{x}}` や `{{URL}}` は残す
- ボードと詳細のコマンドメニューは**そのアイテムの表示セット**のみ（カタログ全件ではない）。0 件は「このアイテムにコマンドがありません。詳細画面で選べます。」でコピーしない。アイテム分の GET 失敗は通信エラー文言で、空案内と混同しない。成功は「コマンドをコピーしました」、失敗は「コマンドをコピーできませんでした」
- 詳細の「このアイテムで出すコマンド」で紐付けを保存できる。管理ダイアログでカタログ CRUD に加え、チェック後の任意操作「全アイテムに適用」（置き換え）と「新規の初期にする」がある。押すまでサーバーは変わらない。アイテム作成時に defaults がコピーされ、defaults 変更は既存に追従しない
- 詳細画面だけの「コマンドを管理」ダイアログで追加・更新・削除の成否を伝える。成功は短い成功文、400 は API の `message`、通信失敗と 5xx も失敗文を出し、黙ってダイアログを閉じない。テンプレート本文はテキストとして表示し、HTML として挿入しない

### 開発用画面（web-dev / 自動反映）

- `./scripts/dev-web.sh`（または `stop web` + `--profile dev up -d web-dev`）で `:4200` に `ng serve` が起動すること
- 公開ポート経由の `/api/board` が JSON（HTML フォールバックでない）を返すこと
- 既定の `docker compose`（profile なし）では `web-dev` が含まれないこと
- `frontend` の CSS 変更で `web-dev` が再ビルドし、クライアントへ反映されること
- `npm test -- --watch=false`（75）と `npm run build` が通ること
