# 検証記録

主要機能の確認内容の要約です。再現手順の正本は [README](../README.md) と [APIガイド](api.md) です。個人の作業メモやローカルボードのカード番号は含みません。

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

- 表示用 `number` と内部 `id` の分離、詳細 URL は `/cards/:number`
- 採番の冪等性、作成失敗時の番号非消費、削除後の非再利用、並行作成

### ステータス変更 API

- `PATCH /api/cards/by-number/{number}/status` による列名指定の変更
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
- **実 Claude API への接続確認は未実施**（鍵設定後は `docs/api.md` の実機手順）
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

### カードの並び替え・列間移動

- `PUT /api/cards/order` と CDK ドラッグ&ドロップ（列内・列間）/ 上下キー
- 短いドラッグ距離では詳細へ遷移、長いドラッグでは DnD（カードは `<a href>`。ドラッグか click かは CDK の閾値に任せる。実ブラウザーで、短いクリックと Enter は遷移し、列内・列間のドラッグ後は click も遷移も起きないことを確認）
- タッチ: 200ms 押し続けてからドラッグ（マウスは即時）。押し続けずにカード上をスワイプしたときはドラッグが始まらず、`touchmove` が `preventDefault` されない（単体テストとエミュレーションした合成 `touchmove` で確認。実機でのスクロール動作は未確認）
- キーボード操作のアナウンスに移動後の位置が入り、続けて動かしても毎回読み上げられること。カードのフォーカス枠が `.card-list` のスクロール領域で切れないこと（実ブラウザーの Tab キーで確認）
- 400 / 409 / 永続化、詳細ステータス移動が末尾、再起動で DnD 順が消えないこと
- 使い捨て MySQL（`scrumboard_numbering_test`）で、`CreateCard` / `UpdateCard`（列移動・編集）/ `DeleteCard` / `ReorderCards` の並行混在が MySQL 1213（デッドロック）にならないこと（ストレステスト。交差が起きるかはタイミング次第で、`CreateCard` / `UpdateCard` が全列ロックを取っていなかった修正前は reorder の大半が 1213 になった）。あわせて、決定的なテストで、6 つのカード書き込み経路（作成・列移動・削除・カードの並べ替え・バックログの並べ替え・履歴取り込み）がどれも、別のトランザクションが全列ロックを保持している間は、カード行に触れる前にそこで待つことを確認する（どの経路のロックを外してもこのテストが落ちる）。履歴取り込み（`ImportHistory`）も、`ReorderCards` / `CreateCard` と交差してデッドロックしないこと（決定的テスト。修正前は取り込み側が 1213 で失敗）。`ReorderCards` の 409 / 400 が、古いカード集合・他列のカード混入・存在しない列などで返り、DB が変わらないこと
- 列内の並び替えや位置のずれで、触っていないカードの `updatedAt` が変わらないこと（列が変わったカードだけ更新）
- `position` 列のない旧スキーマの DB から `InitializeCardPositions` で `created_at, id` 順に採番され、再起動で手動の順序が保たれ、`updatedAt` が変わらないこと
- `go test` / `npm test -- --watch=false`（全件）/ `npm run build`

### プロダクトバックログ

- `GET /api/backlog` / `PUT /api/backlog/order` と `/backlog` UI のドラッグ&ドロップ / 上下キー並び替え
- 全ステータス（Done 含む）表示、バックログからの新規追加（初期ステータス選択）
- 400 / 409 / 永続化、並び替え後のカード追加が末尾、Create と Reorder の並行
- `ReorderBacklog` もカード行に触れる前に全列ロック（`lockColumnRows`）を取り、`ReorderCards` / `CreateCard` / `UpdateCard` / `DeleteCard` / `ImportHistory` と交差してデッドロックしないこと（使い捨て MySQL の決定的テスト `TestCardWritersQueueOnTheAllColumnsLockMySQL` で、`ReorderBacklog` のロックを外すと落ちることを確認。統合前の `ReorderBacklog`（`cards` を主キー順にロックするだけ）は、`ReorderCards` と 80 並行で混在させると約 3 分の 1 が MySQL 1213 になることをレビューで実測した。マージ時にこのリポジトリの Go テストで並行ストレステストを組んだが交差を再現できず検出力がなかったため、決定的テストを根拠にする）
- カードの `position`（列内の並び順）と `backlogPosition`（バックログの優先順位）が独立していること。一方の並び替えがもう一方を変えないこと

### 開発用画面（web-dev / 自動反映）

- `./scripts/dev-web.sh`（または `stop web` + `--profile dev up -d web-dev`）で `:4200` に `ng serve` が起動すること
- 公開ポート経由の `/api/board` が JSON（HTML フォールバックでない）を返すこと
- 既定の `docker compose`（profile なし）では `web-dev` が含まれないこと
- `frontend` の CSS 変更で `web-dev` が再ビルドし、クライアントへ反映されること
- `npm test -- --watch=false`（75）と `npm run build` が通ること
