# 全体の文字サイズ拡大（約1.4倍）実装プラン

**Goal:** 文字サイズ拡大（約1.4倍）に対応し、フロントエンド全体の文字サイズを約1.4倍に拡大してレイアウト崩れなく表示できるようにする。
**Architecture:** 既存の5つのCSSファイル（`styles.css`, `app.css`, `board.css`, `card-detail.css`, `card-history.css`）の全 `font-size` を約1.4倍の整数 `px` に引き上げ、文字サイズ未指定だった要素（`body` と `.history > p` は既定の16pxから周囲の17pxへ、`.avatar` は継承していた11pxから20pxへ）を明示し、合わせて見切れ・折り返し崩れを防ぐ固定寸法・ブレークポイントのみを調整する。HTML/TS/API/DBは変更しない。
**Tech Stack:** Angular 21（CSS / Vitest / Angular CLI）。
**Spec:** `docs/superpowers/specs/2026-11-13-larger-text-design.md`

## Global Constraints

- HTMLテンプレート構造・TypeScriptロジック・Go API・DBスキーマは変更しない。
- `L-048`・`L-059`・`L-499`・`L-671` を満たすこと。
- `npm run build`（本番ビルド）で `angular.json` の `anyComponentStyle` 予算（warning 6kB / error 8kB）を超えないこと。
- 実ブラウザー確認では通常DBへ検証用カードや列を作成・変更しない（モーダル確認はキャンセルで閉じる）。

## Task 1: 共通スタイル (`frontend/src/styles.css`) の拡大と狭幅モーダル対応

**対象ファイル:** `frontend/src/styles.css`

- [x] `body` に `font-size: 17px;` を追加する。
- [x] `.primary, .secondary, .danger-button` を `font-size: 17px; padding: 12px 18px;` に更新する。
- [x] `.icon-button` を `width: 36px; height: 36px; font-size: 27px;` に更新する。
- [x] `label` を `font-size: 17px;` に更新する。
- [x] `input, textarea, select` を `font-size: 18px;` に更新する。
- [x] `.required, .optional` を `font-size: 13px;` に更新する。
- [x] `.field-note` を `font-size: 14px;` に更新する。
- [x] `.form-error` を `font-size: 17px;` に更新する。
- [x] `.form-actions` に `flex-wrap: wrap;` を追加する（375px以下のモバイルモーダルでボタンが横溢れしないようにする）。
- [x] `.state-panel` を `font-size: 18px;`、`.spinner` を `width: 28px; height: 28px;` に更新する。
- [x] `.modal` を `width: 540px;`、`.modal h2` を `font-size: 25px;` に更新する。

## Task 2: アプリヘッダー (`frontend/src/app/app.css`) の拡大とブレークポイント調整

**対象ファイル:** `frontend/src/app/app.css`

- [x] `.app-header` を `height: 84px;` に更新する。
- [x] `.brand` を `font-size: 34px; gap: 12px;` に更新し、`.brand-dot` を `margin-left: -11px;` に更新する。
- [x] `.brand-mark` を `height: 30px;`、`.brand-mark i` を `width: 6px; height: 30px;`、`:nth-child(2)` を `height: 21px;`、`:nth-child(3)` を `height: 13px;` に更新する。
- [x] `.header-divider` を `height: 26px;` に更新する。
- [x] `.workspace-name` を `font-size: 17px;` に更新する。
- [x] `.header-end` を `font-size: 15px;`、`.local-dot` を `width: 8px; height: 8px;` に更新する。
- [x] `.avatar` を `width: 40px; height: 40px; font-size: 20px;` に更新する。
- [x] `@media (max-width: 650px)` を `@media (max-width: 800px)` に引き上げ、`.app-header` の `height` を `74px;` に更新する。

## Task 3: かんばんボード (`frontend/src/app/board.css`) の拡大と列幅・固定枠調整

**対象ファイル:** `frontend/src/app/board.css`

- [x] 見出し・ツールバー周りを更新する:
  - `.breadcrumb`: `font-size: 15px;`
  - `.eyebrow`: `font-size: 13px;`
  - `h1`: `font-size: 45px;`
  - `.page-heading p`: `font-size: 17px;`
  - `.board-toolbar`: `min-height: 62px; height: auto;`
  - `.active-tab`: `font-size: 17px; padding: 12px 4px;`
  - `.board-icon`: `font-size: 28px;`
  - `.toolbar-count`: `font-size: 14px; padding: 4px 9px;`
  - `.board-summary`: `font-size: 14px;`
- [x] 列・カード・空状態・追加タイル・フッターを更新する:
  - `.kanban-column`: `width: 360px; flex: 0 0 360px;`
  - `.column-heading h2`: `font-size: 17px;`
  - `.status-dot`: `width: 10px; height: 10px;`
  - `.column-count`: `font-size: 14px; min-width: 24px; padding: 3px 6px;`
  - `.card-id`: `font-size: 13px;`
  - `.card-arrow`: `font-size: 20px;`
  - `.task-card h3`: `font-size: 18px; line-height: 1.65;`
  - `.card-description`: `font-size: 15px; line-height: 1.75;`
  - `.card-status`: `font-size: 13px; padding: 4px 8px;`
  - `.detail-hint`: `font-size: 13px; white-space: nowrap;`
  - `.add-card`: `font-size: 15px;`、`.add-card > span`: `font-size: 24px;`
  - `.empty-column`: `min-height: 210px; height: auto; padding: 20px 12px;`
  - `.empty-symbol`: `width: 44px; height: 44px; font-size: 27px;`
  - `.empty-column p`: `font-size: 15px;`
  - `.empty-column > span:last-child`: `font-size: 13px;`
  - `.add-column-tile`: `flex: 0 0 165px; font-size: 15px;`
  - `.board-footer`: `font-size: 14px;`
  - `.tip-icon`: `width: 19px; height: 19px; font-size: 13px;`
  - `.footer-note`: `font-size: 13px;`
- [x] レスポンシブメディアクエリを更新する:
  - `@media (min-width: 1905px)`: `.kanban-column` を `width: 390px; flex-basis: 390px;`（4列が `1885px` 以上で収まる。切替幅は常時表示スクロールバー分に20px上乗せ）
  - `@media (min-width: 1645px) and (max-width: 1904px)`: `.kanban-column` を `width: 330px; flex-basis: 330px;`（拡大前に4列が収まっていた `1646px` 以上を維持。4列が `1645px` 以上で収まる）
  - `@media (min-width: 701px) and (max-width: 1399px)`: `.kanban-column` を `width: 320px; flex-basis: 320px;`（`1265px` 以上で3列が収まる）
  - `@media (min-width: 701px) and (max-width: 1279px)`: `.kanban-column` を `width: 296px; flex-basis: 296px;`（`1193px` 以上で3列が収まる。拡大前に収まっていた `1196px` 以上を維持）
  - `@media (max-width: 700px)`: `.page-heading h1` を `font-size: 35px;`、`.eyebrow` を `font-size: 11px;`、`.kanban-column` を `width: 310px; flex-basis: 310px;`

## Task 4: カード詳細 (`frontend/src/app/card-detail.css`) と変更履歴 (`frontend/src/app/card-history.css`) の拡大

**対象ファイル:** `frontend/src/app/card-detail.css`, `frontend/src/app/card-history.css`

- [x] `card-detail.css`:
  - `.detail-page`: `max-width: 1200px;`
  - `.back-link`: `font-size: 17px;`
  - `.eyebrow`: `font-size: 14px;`
  - `h1`: `font-size: 39px;`
  - `.detail-heading p`: `font-size: 17px;`
  - `.detail-layout`: `grid-template-columns: minmax(0, 1fr) 330px;`
  - `.section-label`: `font-size: 15px;`
  - `.properties .field-note`: `font-size: 14px;`
  - `.timestamps`: `font-size: 14px;`、`.timestamps time`: `font-size: 15px;`
  - `.detail-tip`: `font-size: 14px;`
  - `.danger-link`: `font-size: 15px;`
  - `.delete-copy`: `font-size: 18px;`
  - `.success-message`: `font-size: 17px;`
  - `.properties input`: `font-size: 17px;`
  - `.pr-link`: `font-size: 17px;`
  - `.save-state`: `font-size: 17px;`
- [x] `card-history.css`:
  - `h2`: `font-size: 22px;`
  - `.history-event`: `font-size: 17px;`
  - `time, .recorded`: `font-size: 15px;`
  - `.value span`: `font-size: 14px;`
  - `.history > p`: `font-size: 17px;` を追加する。

## Task 5: テスト・ビルド・実ブラウザー検証・検証記録

- [x] `frontend` で `npm test -- --watch=false` と `npm run build` を実行し、全テスト成功・本番ビルド成功・スタイル予算警告/エラーなしを確認する。
- [x] ワークツリーから一時開発サーバー（例: `ng serve --port 4212` + `proxy.conf.json`）を起動し、実ブラウザーで以下を確認して停止する（DBのカード・列は書き換えない）:
  - デスクトップ幅（1440px）でボード一覧（空列・追加タイル・ヘッダー・フッター）、列追加/カード追加モーダルを開いてキャンセル、カード詳細（`cards/2` 含む、プロパティ・変更履歴・削除確認モーダルを開いてキャンセル）を確認し、計算済み `font-size` が約1.4倍で見切れ・重なりがないこと。
  - 中間幅（800px 前後・751px 境界）でヘッダーや詳細2カラムが溢れないこと。
  - モバイル幅（375px）でボード横スクロール・モーダルボタン折り返し・カード詳細が崩れないこと。
- [x] `docs/verification.md` に今回の検証結果を追記する。
