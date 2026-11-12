# GitHub PR紐付け Implementation Plan

**Goal:** カードへGitHub PR URLを保存・参照し、既存Doneカードへ対応PRを反映する。
**Architecture:** Card JSONと既存CRUDを拡張。補助表を起動時に冪等準備し、URLとカードを同一トランザクションで保存する。
**Tech Stack:** 既存Angular/TypeScript、Go標準ライブラリ、MySQL 8.4、Docker。依存追加なし。
**Spec:** docs/superpowers/specs/2026-11-12-card-pr-link-design.md

## Global Constraints
1カード1 URL。HTTPS github.comのPRパスのみ、ASCII2048文字まで、`.`/`..`単独owner/repo拒否。前後空白はtrim。prUrl省略/nullは保持、空文字は解除。公開番号と内部IDは維持。通常DBでテストカード作成しない。Doneの状態と本文は変更しない。

## Review Focus
- URL偽装ホスト、credentials、query/fragment、port、制御文字、ドットセグメントを拒否。
- 既存データを再初期化せず起動可能で、未登録URLは空文字として取得。
- タイトルのみ・statusのみの更新でURLを失わない。
- ルート切替・保存失敗で古いカードのURLが混入しない。
- 本番カード更新は公開番号で取得し、返却内部IDを使用する。

## Task 1: APIと永続化
- [x] pr_link_handler_test.goで既存PATCHへのURL追加・trim・解除・省略/null保持、不正URLと本文非更新、作成時のURL、GET/board反映をテスト。未実装で失敗を確認。
- [x] model.goのCard/CardInputへPRURL string、CardPatchへ*stringを追加。pr_link.goで正規表現検証と補助表InitializePRLinksを定義。handler.goでcreate/updateの検証を組み込む。
- [x] repository.goのscanCard/cardFields/numberedCardsへLEFT JOINを追加し、create/update tx内でURLをupsert。空文字は空文字保存、省略は書き換えない。server/main.goでHTTP公開前に準備する。
- [x] mysql_test.goの専用fixtureで補助表削除順と初期化を追加。pr_link_integration_test.goで旧データ移行・冪等初期化・番号/本文保持・再取得・同時部分更新・30カード同時初回URL保存・更新rollbackとcascadeを確認。
- [x] 専用MySQL DB名ガードを維持し、go test -race -count=1 ./... と go vet ./... を実行。

## Task 2: 詳細画面
- [x] card-detail.spec.tsへURLロード/保存/解除/失敗保持・未保存URLをリンクにしない・不正URL非送信のテストを追加し、RED確認。
- [x] models.tsのCardにprUrl、CardInputに任意prUrlを追加。既存テストfixtureへ未登録空文字を補う。
- [x] pr-url.ts/pr-url.spec.tsでGoと同じ境界規則のValidatorFnを実装、card-detail.tsでform.reset/saveに接続。
- [x] card-detail.htmlのpropertiesへラベル付きinputとエラー・保存済みリンクを追加、CSSで狭い画面のはみ出しを防ぐ。target=_blank、rel=noopener noreferrer。
- [x] npm test -- --watch=false、npm run buildを実行。

## Task 3: 実環境確認とDoneの紐付け
- [x] scripts/smoke.pyへURL保存・状態変更後保持・解除・不正入力非更新を追加、専用Compose(API8081/Web4201/DB3308)で両経路確認して専用volumeのみ削除。
- [x] README/docs/api.mdへ仕様、補助表とバックアップ・切替手順を追記。docs/verification.mdへ実行結果を記録。
- [x] 通常DBをダンプし、新API/Webを反映。Doneの#3/#7を再取得し根拠のあるPR#2/#3をPATCH。URLとupdatedAt以外の完全保持を照合。
- [x] ブラウザーで保存済みリンクと編集欄を確認。SRP/独立レビューを3周連続0件まで実施。
開発フロー: PR作成後、対象カードへ自身のPR URLを同様に反映し、状態は変えず停止する。

## 適用する知見
L-018 URLの検証・保存・リンク先を統一。L-454/456省略時と移行の保持。L-035番号とID。L-037/040ルート切替取消。L-059実MySQL/HTTP/ブラウザー確認。設計レビュー1回目の`.`/`..`拒否を反映済み。

設計・計画は独立サブエージェントでレビュー済み。SRP確認でURLの純粋検証(pr_url.go)とDDL(pr_link.go)を分離。実装はexecuting-plans/TDDで直接実施し、API・画面のRED→GREENを確認。

SRPは4周（1件分離後3周連続0件）、独立コードレビューは4周（deadlock1件修正後3周連続0件）で完了。
