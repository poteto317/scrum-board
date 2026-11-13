# 全体の文字サイズ拡大（約1.4倍）設計書

## 目的と対象

文字サイズを約1.4倍に拡大する。
フロントエンド全画面（ヘッダー、かんばんボード、モーダル、カード詳細、変更履歴、状態表示）の文字サイズを現在の約1.4倍に拡大し、文字拡大に伴う固定寸法の見切れや折り返し崩れを防ぐ。

バックエンド・API・DB・テンプレートHTML構造・ルーティングは変更しない。ユーザー選択式の文字サイズ切替や設定保存など、頼まれていない機能は追加しない。

## 設計判断

### 1. 各 `font-size` と関連固定寸法の明示的スケーリング

**採用案**: 既存の5つのスタイルシート（`styles.css`、`app.css`、`board.css`、`card-detail.css`、`card-history.css`）にある全 `font-size` を約1.4倍の整数 `px`（`Math.round(元のpx * 1.4)` 基準）に引き上げ、文字サイズを明示していなかった要素にも整合する値を設定し、拡大で見切れる固定寸法を合わせて調整する。

**不採用案**:
- CSS `zoom` による全体拡大: ブラウザー互換性やビューポート単位（`100vw` / `100dvh`）・スクロール計算への副作用があるため不採用。
- 全スタイルの `rem` 化と `:root` 基準値変更: 既存の余白・角丸・幅・高さがすべて `px` で記述されており、学習用アプリとして他コンポーネントと表記を揃える方が見通しがよい。

### 2. 対象要素とサイズ一覧

#### `frontend/src/styles.css`
- `body`: `font-size: 17px` を明示（未指定要素がブラウザー既定の `16px` のまま周囲より小さくなるのを防ぐ）
- `.primary`, `.secondary`, `.danger-button`: `font-size: 12px` → `17px`（`padding: 12px 18px`）
- `.icon-button`: `font-size: 19px` → `27px`、`width/height: 26px` → `36px`（拡大した記号が枠から溢れないようにする）
- `label`: `font-size: 12px` → `17px`
- `input`, `textarea`, `select`: `font-size: 13px` → `18px`
- `.required`, `.optional`: `font-size: 9px` → `13px`
- `.field-note`: `font-size: 10px` → `14px`
- `.form-error`: `font-size: 12px` → `17px`
- `.state-panel`: `font-size: 13px` → `18px`（`.spinner`: `23px` → `28px`）
- `.form-actions`: `flex-wrap: wrap` を追加（375px 以下の狭い画面でボタンがモーダル幅からはみ出さないようにする）
- `.modal`: `width: 480px` → `540px`
- `.modal h2`: `font-size: 18px` → `25px`

#### `frontend/src/app/app.css`
- `.app-header`: `height: 76px` → `84px`（`@media (max-width: 800px)`: `height: 74px`、および `.workspace-name`, `.header-divider`, `.header-end` 非表示。文字拡大により全要素の合計幅が増え、フォールバックフォント時の余裕も確保するため、ブレークポイントを `650px` → `800px` へ引き上げる）
- `.brand`: `font-size: 24px` → `34px`、`gap: 12px`（`.brand-mark` 高さ `23px` → `30px`、各バー `width: 6px`、高さ `30px` / `21px` / `13px`）
- `.brand-dot`: `margin-left: -9px` → `-11px`（`.brand` の `gap: 12px` と合わせて文字とドットの間隔 `1px` を維持）
- `.header-divider`: `height: 22px` → `26px`
- `.workspace-name`: `font-size: 12px` → `17px`
- `.header-end`: `font-size: 11px` → `15px`（`.local-dot`: `6px` → `8px`）
- `.avatar`: `font-size: 20px` を明示、`width/height: 32px` → `40px`（親 `.header-end` からの継承 `11px` ではなく、直径 `40px` の円形アバター内で視認しやすい `20px` へ明示的に設定）

#### `frontend/src/app/board.css`
- `.breadcrumb`: `font-size: 11px` → `15px`
- `.eyebrow`: `font-size: 9px` → `13px`（`@media (max-width: 700px)`: `8px` → `11px`）
- `h1`: `font-size: 32px` → `45px`（`@media (max-width: 700px)` の `.page-heading h1`: `25px` → `35px`）
- `.page-heading p`: `font-size: 12px` → `17px`
- `.board-toolbar`: `height: 53px` → `min-height: 62px; height: auto`
- `.active-tab`: `font-size: 12px` → `17px`、`padding: 12px 4px`
- `.board-icon`: `font-size: 20px` → `28px`
- `.toolbar-count`: `font-size: 10px` → `14px`、`padding: 4px 9px`
- `.board-summary`: `font-size: 10px` → `14px`
- `.kanban-column`: `width/flex-basis: 310px` → 既定 `360px`。既定の3列（Todo/Doing/Done）と、利用中のボードの4列（＋Review）が、拡大前に収まっていた幅で横スクロールにならないよう、幅の帯ごとに列幅を変える（必要な幅は `列幅×列数＋20×列数＋追加タイル165＋左右の余白80px`。拡大前は列幅が `310px`、`1400px` 以上で `340px`、追加タイル `126px`）: `701〜1279px` は `296px`（3列が `1193px` 以上で収まる）、`1280〜1399px` は `320px`（3列が `1265px` 以上）、`1400〜1644px` は既定の `360px`（3列が `1385px` 以上）、`1645〜1904px` は `330px`（4列が `1645px` 以上で収まる。拡大前は4列が `1646px` 以上で収まっていた）、`1905px` 以上は `390px`（4列が `1885px` 以上、3列が `1475px` 以上で収まる。常時表示スクロールバー約15〜17pxの環境でも切替幅で溢れないよう、切替幅は `1885px` に20px上乗せした）。`max-width: 700px`: `285px` → `310px`（常に横スクロール）。4列で拡大前から収まらない幅（`1645px` 未満）は、拡大前と同じく横スクロールになる。文字拡大後も1行の文字数とフッター（ステータス＋詳細リンク）の収まりを維持する。
- `.column-heading h2`: `font-size: 12px` → `17px`（`.status-dot`: `8px` → `10px`）
- `.column-count`: `font-size: 10px` → `14px`、`min-width: 24px`、`padding: 3px 6px`
- `.card-id`: `font-size: 9px` → `13px`
- `.card-arrow`: `font-size: 14px` → `20px`
- `.task-card h3`: `font-size: 13px` → `18px`、`line-height: 1.65`
- `.card-description`: `font-size: 11px` → `15px`、`line-height: 1.75`
- `.card-status`: `font-size: 9px` → `13px`、`padding: 4px 8px`
- `.detail-hint`: `font-size: 9px` → `13px`、`white-space: nowrap`
- `.add-card`: `font-size: 11px` → `15px`（`.add-card > span`: `17px` → `24px`）
- `.empty-column`: `height: 178px` → `min-height: 210px; height: auto; padding: 20px 12px`
- `.empty-symbol`: `font-size: 19px` → `27px`、`width/height: 32px` → `44px`
- `.empty-column p`: `font-size: 11px` → `15px`
- `.empty-column > span:last-child`: `font-size: 9px` → `13px`
- `.add-column-tile`: `font-size: 11px` → `15px`、`flex: 0 0 126px` → `0 0 165px`（1行で収める）
- `.board-footer`: `font-size: 10px` → `14px`
- `.tip-icon`: `font-size: 9px` → `13px`、`width/height: 13px` → `19px`
- `.footer-note`: `font-size: 9px` → `13px`

#### `frontend/src/app/card-detail.css`
- `.detail-page`: `max-width: 1080px` → `1200px`
- `.back-link`: `font-size: 12px` → `17px`
- `.eyebrow`: `font-size: 10px` → `14px`
- `h1`: `font-size: 28px` → `39px`
- `.detail-heading p`: `font-size: 12px` → `17px`
- `.detail-layout`: `grid-template-columns: minmax(0, 1fr) 280px` → `minmax(0, 1fr) 330px`
- `.section-label`: `font-size: 11px` → `15px`
- `.properties .field-note`: `font-size: 10px` → `14px`
- `.timestamps`: `font-size: 10px` → `14px`
- `.timestamps time`: `font-size: 11px` → `15px`
- `.detail-tip`: `font-size: 10px` → `14px`
- `.danger-link`: `font-size: 11px` → `15px`
- `.delete-copy`: `font-size: 13px` → `18px`
- `.success-message`: `font-size: 12px` → `17px`
- `.properties input`: `font-size: 12px` → `17px`
- `.pr-link`: `font-size: 12px` → `17px`
- `.save-state`: `font-size: 12px` → `17px`

#### `frontend/src/app/card-history.css`
- `h2`: `font-size: 16px` → `22px`
- `.history-event`: `font-size: 12px` → `17px`
- `time`, `.recorded`: `font-size: 11px` → `15px`
- `.value span`: `font-size: 10px` → `14px`
- `.history > p`: `font-size: 17px`（読込中・エラー・空表示の文言を履歴項目と同じ基準に揃える）

## 決めたこと

- 拡大倍率は要望どおり約1.4倍（`Math.round(元のpx * 1.4)` 基準）とし、全コンポーネントの `px` 指定を一貫して引き上げる。
- `L-048`（既存全CSSの事前調査）、`L-671`（固定幅・固定高さ要素が拡大後の文字を受け止められる寸法か確認）、`L-499`（詳細度の意図しない上書きを避ける）、`L-059`（モックテストだけでなく実ブラウザーで表示と操作を確認）を実装・検証に反映する。

## 検証方針

- `frontend` で `npm test -- --watch=false` と `npm run build`（本番ビルド、`anyComponentStyle` 予算の警告・エラーがないことも含む）を実行し、全件成功を確認する。
- 実ブラウザーでデスクトップ幅（1440px）・中間幅（800px 前後、751px）・モバイル幅（375px）のボード一覧（空列・追加モーダル含む）、カード詳細（変更履歴・削除確認モーダル含む）、状態表示（`.state-panel`）を確認し、見切れ・重なり・折り返し崩れ・横スクロール破綻がないことを目視確認し、結果を `docs/verification.md` に記録する。
