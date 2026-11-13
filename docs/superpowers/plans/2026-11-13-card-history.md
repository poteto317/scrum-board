# Card History Implementation Plan

**Goal:** 変更履歴と、根拠のある過去記録の復元を実装する。
**Architecture:** card_history補助表へ既存CRUDと同じtxで追記。公開番号のページングAPIと詳細の独立表示。復元は冪等な専用CLIから一括import。
**Tech Stack:** 既存Go標準ライブラリ/MySQL8.4、Angular/TypeScript/RxJS。依存追加なし。
**Spec:** docs/superpowers/specs/2026-11-13-card-history-design.md

## Global Constraints
既存カードの番号・ID・本文・状態・日時を移行/importで変更しない。baselineは履歴0件の既存カードのみ。更新と履歴は同一tx、no-op履歴なし。復元は根拠と不確実性を表示し、変更時刻や初期値を捏造しない。通常DBの更新前にAPI停止・ダンプ。削除履歴閲覧・巻戻し・認証なし。

## Review Focus
- 履歴INSERT失敗でカードや番号発行もrollbackすること。
- 別カードcursorを受け付けず、同時刻のイベントや古い復元イベントも欠落なくページングすること。
- 再起動でcreatedカードへbaselineが増えないこと。
- importのID/作成日時照合、重複キー再実行、全体失敗時rollback。
- 古い履歴取得が別カードや保存成功後の新しい履歴に混ざらないこと。

## Task 1: 永続化とAPI
- [x] history型、冪等初期化、差分計算、ページング取得をhistory*.goへ分離。model RepositoryとhandlerへGET履歴を追加する。
- [x] 実MySQLのテストを先に作りRED確認。既存fixtureの削除順と履歴DDLのみ準備を追加し、CRUDtxでcreated/updatedを記録してGREENにする。
- [x] 移行時のカード完全保持・再実行・新規作成後の再起動、全field差分/no-op/並行保存、INSERT失敗rollback、cursor/50件境界/同日時/import古い日時、HTTP400/404を検証。

## Task 2: 復元CLI
- [x] ImportHistoryとCLIを実装。JSON入力のfield・URL・日時・number/期待ID/createdAtを検証し、一括txと一意キーで安全にimportする。
- [x] 不正入力/ID・作成日時不一致/中途失敗の全rollback、再実行非増加を実MySQLで検証。
- [x] SQL/JSONバックアップとPR記録を調査し、復元manifestをignored領域に作る。根拠と観測時刻/マージ時刻/作成時刻のみの区別を注記。

## Task 3: 詳細UI
- [x] card-history.ts/html/cssへ独立コンポーネント。初回/追加/保存成功再読込/別カード切替取消/エラー再試行をテストから実装する。
- [x] Api/ModelsへhistoryPage追加、詳細へnumber/updatedAtを渡して接続。before/afterの空欄・長文と復元注記/出典を表示。
- [x] Angular全テスト/本番ビルド、Go race/vet（専用MySQL）、専用Compose HTTP/ブラウザーで確認。

## Task 4: ローカル反映とPR
- [x] README/docs/api/verificationへ仕様、移行とimport、履歴復元の限界を記載する。
- [x] 通常DBをバックアップして反映、baselineとimport実行前後で既存カード完全一致と件数を照合、import再実行で非増加を確認する。
- [x] SRPと独立コードレビューを3周連続0件まで実施する。

以降PR作成後、対象カードへPR URLだけを紐付け、Doingを保持して終了する。

設計レビューでbaseline対象条件の不足を修正済み。L035/455/456、038/454、037/040、059を反映する。
