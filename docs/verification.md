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

### 列の並び替え

- `PUT /api/columns/order` と UI のドラッグ&ドロップ / キーボード並び替え
- 400 / 409 / 永続化、並び替え後の列追加、専用 Compose での smoke
