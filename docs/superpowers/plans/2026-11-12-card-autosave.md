# Card Autosave Implementation Plan

**Goal:** カード詳細の編集を自動保存へ変更する。
**Architecture:** 画面単位CardAutosaveにフォーム・最大待ちつき予約・直列部分PATCHを集約。CardDetailとルートguardで未保存の遷移を保護する。
**Tech Stack:** 既存Angular21/TypeScript/RxJS、Go/MySQL。依存追加なし。
**Spec:** docs/superpowers/specs/2026-11-12-card-autosave-design.md

## Global Constraints
600ms debounce、2秒maxWait、blur/statusは即時。IME中の対象項目を送らない。保存中も編集可能。成功応答で未送信入力を消さない。失敗は明示再試行か次回編集まで停止。利用中カード本文は検証で変更しない。作成時はPR#4に積み上げたが、PR#4のマージ後に最新のmainへrebaseし、PRのbaseをmainへ変更した。

## Review Focus
- 応答待ち中の値の変更と元値への復帰を未保存として扱う。
- 無効項目や日本語変換中の項目を送らず、有効な独立項目は保存する。
- 旧画面のタイマー/応答が新しいカードに作用しない。
- ナビゲーション前に保留保存をflush、失敗/不正入力なら破棄確認を拒否できる。
- 削除後に遅延PATCHせず、タブ終了時は標準の未保存確認を出す。

## Task 1: 保存の制御
- [x] card-autosave.spec.tsで初期非送信、debounce/maxWait/即時、差分PATCH、遅延応答時の入力保持と続行、失敗/再試行、無効項目、IME、reset/破棄をテストしてRED確認。
- [x] card-autosave.tsをコンポーネントproviderとして実装。既存フォーム定義を移動し、送信snapshot・confirmedCard・現在formを分離。各成功応答は送信時から変わっていない項目だけ正規化。保存待ちを解決するsettleと予約/購読の停止処理を設ける。
- [x] テストをGREENにする。

## Task 2: 画面・遷移
- [x] card-detail.spec.tsを自動保存の実際の操作に合わせ更新。手動保存ボタンが無い、ステータス即保存、初期ロード非保存、保存済みPRリンク、失敗保持、遷移flush/拒否と削除を検証する。
- [x] card-detail.tsでproviderとロードreset、削除、canLeave/beforeunloadを接続。app.routes.tsにcanDeactivateを設定。
- [x] card-detail.htmlで保存ボタン/ngSubmitを削除、blur/status/IMEイベントと保存状態・再試行表示を追加。保存中にフォームを無効化しない。必要なCSSのみ変更。
- [x] npm test -- --watch=false と npm run build、Go test/vetを実行。

## Task 3: 実環境・ドキュメント・PR
- [x] README/docs/verificationへ自動保存仕様と検証結果を記録する。
- [x] 専用Compose(DB3308/API8081/Web4201)でHTTP smokeとブラウザー自動保存、連続編集・別ページ移動・再読込を確認し、専用volumeだけを削除する。
- [x] 元チェックアウトのPRリンク表示変更を保持したまま、ローカルWebへ反映する。利用中カード本文は変更しない。
開発フロー: SRP確認・新規独立レビューをそれぞれ3周連続0件まで実施。PRを作り、対象カードへPR URLだけを部分更新しDoingは保持する。

## 設計レビューと知見
設計は独立レビューで指摘なし、手順により自動承認済み。L-625/628、037/040、399、473/474、542をテストと責務に反映する。
