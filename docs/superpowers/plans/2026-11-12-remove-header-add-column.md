# Header Add Column Removal Implementation Plan

**Goal:** 見出し右上の列追加ボタンを削除する。
**Architecture:** 既存テンプレートの不要な入口と専用CSSのみを削除し、右端の列追加タイルを残す。
**Tech Stack:** 既存Angular/TypeScript。API・DB・依存の変更なし。
**Spec:** docs/superpowers/specs/2026-11-12-remove-header-add-column-design.md

## Global Constraints
右端の列追加機能、ダイアログ、既存APIは維持。通常DBへ検証列を追加しない。自動保存PR#5に依存しない独立PRとする。稼働中の自動保存画面を巻き戻さない。

## Review Focus
右端の追加入口が削除されないこと、不要なフォーカス対象が残らないこと、mobile専用CSSの削除範囲、列追加のdialogキャンセル、プレビューに既存自動保存を維持すること。

## 実施手順
- [x] board.htmlのpage-headingの列追加buttonだけを削除し、board.cssのそのボタン専用mobileルールを削除する。
- [x] Angular既存テストと本番Dockerビルドを実行。低影響の表示削除のため構造だけの新規テストは追加しない。
- [x] 稼働中の自動保存PRの確定済みソースを一時プレビューへ取り出し、今回のboard.html/cssを適用してローカルWebをビルド・反映。
- [x] 実ブラウザーで右上ボタン消失、右端からダイアログが開きキャンセルできることを確認。docs/verificationへ記録。
- [x] SRP確認と新規独立レビューをそれぞれ3周連続0件まで実施する。

以降はPR作成まで進め、対象カードへPR URLだけを紐付ける。Doingを保持する。

設計は独立レビューで指摘なし。L-048/058/059を範囲と確認方法へ反映。
