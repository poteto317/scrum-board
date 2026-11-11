# ステータス変更API Implementation Plan

**Goal:** 生成AIが公開タスク番号と列名だけでステータスを変更できるAPIを追加する。
**Architecture:** PATCHのHTTP検証→公開番号でカード取得→列名だけをDBで解決→既存のUpdateCardトランザクション。Card応答とID APIは維持する。
**Tech Stack:** 既存Go net/http/database/sql、MySQL8.4、Angularは回帰検証のみ。
**Spec:** docs/superpowers/specs/2026-11-12-card-status-api-design.md（新規担当の設計レビュー済み・指摘なし）

## Global Constraints
PATCH /api/cards/by-number/{number}/status、body {"status":"Doing"}、任意列名対応。番号と内部IDを混同しない。本文/番号/作成日時保持。空/null/過長/未知fieldは400、タスク未存在404、ステータス未存在400、DB失敗500。既存GET/PATCH APIを維持。PRのbaseはmain（作成時の基準だった先行PR#2はマージ済み）。feature/refactor/reviewではコミットしない。

## Review Focus
- number7/id22とnumber22/id7が交差しても正しい方だけ変更（L035）。
- title/descriptionを省略したステータス変更で既存本文を消さない（L454/456）。
- 任意列/Unicode・空白・不正JSON・未知名で正しく処理し失敗時は非更新。
- DBの取得/列解決/更新失敗を500にし内部詳細を返さない（L017）。
- フェイクだけでなく隔離MySQL・API/Webを実行（L059）。全カードを取得せず責務を分ける（L315）。

### Task 1: エンドポイントと列名解決
**Files:** backend/internal/kanban/{model.go,repository.go,status_handler.go,status_handler_test.go,handler.go,handler_test.go}
**Interfaces:** Repository.GetColumnByName(context.Context,string)(Column,error)。不明列はErrColumn。既存GetCardByNumber/UpdateCardを利用。200のCard JSONは従来通り。
- [x] HTTPテストを先に追加。交差ID、Doing/Done/custom列、60文字境界、同じstatus再送、本文保持、番号不変、全400/404/500、失敗時非更新を確認。
- [x] `go test ./...`で未実装パスのREDを確認。
- [x] status_handler.goで入力検証と処理の組立、repository.goでプレースホルダー付き列のみのSELECT、handler.goでルート登録、fakeの列名解決を追加。
- [x] `go test -race ./...`と`go vet ./...`が成功するまで修正。

### Task 2: 実DB・利用ガイド・受け入れ
**Files:** backend/internal/kanban/status_integration_test.go、必要なら共通mysql_test.go、scripts/smoke.py、docs/api.md、README.md
**Interfaces:** status APIは応答columnIdとGET/boardで結果確認。Docker/Web経由の同一パスで利用。
- [x] 専用テストDBで内部IDを公開番号からずらし、HTTPハンドラーを通して列名解決・状態変更、本文・日時・番号保持、エラー非更新を確認。既存の明示的な専用DB名ガードを利用する。
- [x] smokeへ新APIによるDoing/任意Review列・再送と未知列を追加し、専用ComposeのAPI直通とWeb経由で確認。
- [x] docs/api.mdに列一覧・番号取得・curl --fail-with-bodyによる変更・応答確認・エラー・内部IDとの違いを記載。READMEから案内する。新規MCPや認証は作らない。
- [x] Go実MySQL race/vet、Angular全テスト、production buildを成功させる。利用中のカード7をテストのために変更しない。
- [x] ローカルAPIへビルド反映し、health/GET/不正リクエストの非更新のみで稼働確認。検証用Composeは削除する。

### Task 3: PR作成までの後続処理
**Files:** docs/verification.md、.claude/dev-flow/state.json/review-log.md（管理外）
- [x] SRPを別観点で3周連続要対応0件まで実施。独立レビューも毎周新規担当者で3周連続0件まで実施。必要な修正はRED→GREEN・全検証する。
- [x] 今回分のファイルだけ日本語コミットし、pushして検証を明記したPRを作成する（作成時は先行PR#2に依存していたため、#2のマージ後にmainへrebaseしてbaseを変更した）。
- [x] PR URL/検証結果を報告して終了。この段階ではPRレビュー/マージは開始しない。
