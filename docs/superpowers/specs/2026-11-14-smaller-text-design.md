# 全体の文字サイズ縮小（約0.8倍）設計書

## 目的と対象

カード #31「全体的に文字を小さくしたい」への対応。
カード #2 で約1.4倍に拡大したあと、思ったより大きいため、**現在の約8割**の大きさにする。

フロントエンド全画面（ヘッダー、かんばんボード、モーダル、カード詳細、変更履歴、状態表示、列並び替えのハンドル／アラート）の文字サイズを、現在値の約0.8倍に縮小し、文字縮小に伴い相対的に大きすぎる固定寸法も合わせて縮める。

バックエンド・API・DB・テンプレートHTML構造・ルーティングは変更しない。ユーザー選択式の文字サイズ切替や設定保存など、頼まれていない機能は追加しない。

## 前提（カード #2 の拡大）

- 仕様: `docs/superpowers/specs/2026-11-13-larger-text-design.md`
- 実装: 5つのスタイルシートの全 `font-size` を `Math.round(元のpx * 1.4)` 基準で引き上げ、関連する固定寸法・列幅帯も調整した。
- 今回の「今」は、その拡大後の現状値を指す。

## 設計判断

### 1. 各 `font-size` と関連固定寸法の明示的スケーリング

**採用案**: 既存の5つのスタイルシート（`styles.css`、`app.css`、`board.css`、`card-detail.css`、`card-history.css`）にある全 `font-size` を約0.8倍の整数 `px`（`Math.round(現在のpx * 0.8)` 基準）に引き下げ、拡大時に合わせて広げた固定寸法（アイコン枠・列幅・モーダル幅・ヘッダー高など）も同基準で縮める。拡大後に追加された `.reorder-alert` / `.column-drag-handle` の `font-size` も対象に含める。

**不採用案**:
- CSS `zoom` による全体縮小: ブラウザー互換性やビューポート単位・スクロール計算への副作用があるため不採用（拡大時と同じ理由）。
- 全スタイルの `rem` 化と `:root` 基準値変更: 既存の余白・角丸・幅・高さが `px` で記述されており、拡大時の方針と揃える。
- `font-size` だけを下げて固定寸法を現状のまま残す: アイコン枠・列・モーダルが文字に対して過大になり、カード #2 で揃えた比率が崩れる。

### 2. 倍率と丸め

- 倍率は要望どおり約0.8倍（`Math.round(現在のpx * 0.8)`）。
- 拡大前の元値へ戻すのではなく、**現在値×0.8**とする（結果として拡大前の約1.12倍付近になるが、要件は「今の8割」）。

### 3. 対象要素とサイズ一覧

#### `frontend/src/styles.css`
- `body`: `17px` → `14px`
- `.primary`, `.secondary`, `.danger-button`: `font-size: 17px` → `14px`、`padding: 12px 18px` → `10px 14px`
- `.icon-button`: `font-size: 27px` → `22px`、`width/height: 36px` → `29px`
- `label`: `17px` → `14px`
- `input`, `textarea`, `select`: `18px` → `16px`（全体0.8倍だと14pxだが、iOS Safari のフォーカスズーム回避のためフォームコントロールのみ16pxを下限とする）
- `.required`, `.optional`: `13px` → `10px`
- `.field-note`: `14px` → `11px`
- `.form-error`: `17px` → `14px`
- `.state-panel`: `18px` → `14px`（`.spinner`: `28px` → `22px`）
- `.modal`: `width: 540px` → `432px`
- `.modal h2`: `25px` → `20px`
- `.reorder-alert`: `12px` → `10px`
- `.column-drag-handle`: `12px` → `10px`（ヒット領域は `min-width/min-height: 24px` と `display: inline-grid; place-items: center` で確保）
- `.form-actions` の `flex-wrap: wrap` は維持（狭幅でのボタン折り返し）

#### `frontend/src/app/app.css`
- `.app-header`: `height: 84px` → `67px`（`@media (max-width: 800px)` を `680px` へ下げ、`height: 74px` → `59px`。文字縮小でヘッダー要素の合計幅が減るため、折りたたみ開始幅を下げる）
- `.brand`: `34px` → `27px`、`gap: 12px` → `10px`（`.brand-mark` 高さ `30px` → `24px`、各バー `width: 6px` → `5px`、高さ `30px`/`21px`/`13px` → `24px`/`17px`/`10px`）
- `.brand-dot`: `margin-left: -11px` → `-9px`
- `.header-divider`: `26px` → `21px`
- `.workspace-name`: `17px` → `14px`
- `.header-end`: `15px` → `12px`（`.local-dot`: `8px` → `6px`）
- `.avatar`: `40px` → `32px`、`font-size: 20px` → `16px`

#### `frontend/src/app/board.css`
- `.breadcrumb`: `15px` → `12px`
- `.eyebrow`: `13px` → `10px`（`@media (max-width: 700px)`: `11px` → `9px`）
- `h1`: `45px` → `36px`（モバイル `.page-heading h1`: `35px` → `28px`）
- `.page-heading p`: `17px` → `14px`
- `.board-toolbar`: `min-height: 62px` → `50px`（`height: auto` 維持）
- `.active-tab`: `17px` → `14px`（`padding: 12px 4px` → `10px 4px`）
- `.board-icon`: `28px` → `22px`
- `.toolbar-count`: `14px` → `11px`（`padding: 4px 9px` → `3px 7px`）
- `.board-summary`: `14px` → `11px`
- `.kanban-column`: 既定 `360px` → `288px`。列幅帯は必要幅 `列幅×列数＋20×列数＋追加タイル132＋左右余白80＋.board-columns左右padding12` で再計算し、**重複しない閉区間**にする（L-757。拡大時と同様、後勝ちのメディアクエリで帯を隣接させる）:
  - 既定（メディアクエリ非該当 = おおむね `1148〜1359px`）: `288px`（3列が `1148px` 以上で収まる）
  - `@media (min-width: 1572px)`: `312px`（4列が `1552px` 以上で収まる。常時表示スクロールバー分に約20px上乗せした切替幅）
  - `@media (min-width: 1360px) and (max-width: 1571px)`: `264px`（4列が `1360px` 以上で収まる）
  - `@media (min-width: 701px) and (max-width: 1147px)`: `256px`（3列が `1052px` 以上で収まる。`1148px` 未満では既定288より狭い）
  - `@media (min-width: 701px) and (max-width: 1051px)`: `237px`（上記より後に書き、`701〜1051px` を上書き。3列が `995px` 以上で収まる。256帯の必要幅1052未満では237のまま）
  - `@media (max-width: 700px)`: `248px`（モバイルは従来どおり横スクロール前提。700px はビューポート種別の分岐として維持し、文字倍率では動かさない）
  - 実効帯の一覧: `≤700→248` / `701〜1051→237` / `1052〜1147→256` / `1148〜1359→288` / `1360〜1571→264` / `≥1572→312`
- `.column-heading h2`: `17px` → `14px`（`.status-dot`: `10px` → `8px`）
- `.column-count`: `14px` → `11px`、`min-width: 24px` → `19px`、`padding: 3px 6px` → `2px 5px`
- `.card-id`: `13px` → `10px`
- `.card-arrow`: `20px` → `16px`
- `.task-card h3`: `18px` → `14px`（`line-height: 1.65` 維持）
- `.card-description`: `15px` → `12px`（`line-height: 1.75` 維持）
- `.card-status`: `13px` → `10px`（`padding: 4px 8px` → `3px 6px`）
- `.detail-hint`: `13px` → `10px`（`white-space: nowrap` 維持）
- `.add-card`: `15px` → `12px`（`.add-card > span`: `24px` → `19px`）
- `.empty-column`: `min-height: 210px` → `168px`（`height: auto` 維持、`padding: 20px 12px` → `16px 10px`）
- `.empty-symbol`: `27px` → `22px`、`width/height: 44px` → `35px`
- `.empty-column p`: `15px` → `12px`
- `.empty-column > span:last-child`: `13px` → `10px`
- `.add-column-tile`: `flex: 0 0 165px` → `0 0 132px`、`font-size: 15px` → `12px`
- `.board-footer`: `14px` → `11px`
- `.tip-icon`: `13px` → `10px`、`width/height: 19px` → `15px`
- `.footer-note`: `13px` → `10px`

#### `frontend/src/app/card-detail.css`
- `.detail-page`: `max-width: 1200px` → `960px`
- `.back-link`: `17px` → `14px`
- `.eyebrow`: `14px` → `11px`
- `h1`: `39px` → `31px`
- `.detail-heading p`: `17px` → `14px`
- `.detail-layout`: 右カラム `330px` → `264px`
- `.section-label`: `15px` → `12px`
- `.properties .field-note`: `14px` → `11px`
- `.timestamps`: `14px` → `11px`、`.timestamps time`: `15px` → `12px`
- `.detail-tip`: `14px` → `11px`
- `.danger-link`: `15px` → `12px`
- `.delete-copy`: `18px` → `14px`
- `.success-message`: `17px` → `14px`
- `.properties input`: `17px` → `16px`（グローバル input と同じく iOS ズーム回避の下限）
- `.pr-link`: `17px` → `14px`
- `.save-state`: `17px` → `14px`
- `@media (max-width: 750px)` の1カラム化はビューポート種別の分岐として維持

#### `frontend/src/app/card-history.css`
- `h2`: `22px` → `18px`
- `.history-event`: `17px` → `14px`
- `time`, `.recorded`: `15px` → `12px`
- `.value span`: `14px` → `11px`
- `.history > p`: `17px` → `14px`

## 決めたこと

- 縮小倍率は要望どおり約0.8倍（`Math.round(現在のpx * 0.8)`）。基準は拡大前ではなく**現在のCSS値**。例外: フォームの `input` / `textarea` / `select` は iOS のフォーカスズーム回避のため `16px` を下限とする。
- 手法はカード #2 と同じく、明示的な `px` の一括スケール＋関連固定寸法の調整。`zoom` / `rem` 化はしない。
- 列幅のメディアクエリ閾値は、縮小後の列幅・タイル幅から必要幅を再計算する（L-757）。モバイル用の `700px` / 詳細の `750px` は画面レイアウト種別の分岐として据え置く。
- ヘッダー折りたたみは `800px` → `680px` に下げる。
- 頼まれていない機能（ユーザー設定の文字サイズ切替、テーマ、API変更）は入れない。
- 知見: `L-048`（既存の拡大対応の方針・対象ファイルを踏襲）、`L-671`（固定枠が縮小後の文字と釣り合うか）、`L-757`（列幅帯の再計算）、`L-499`（詳細度の意図しない上書きを増やさない）、`L-059` / `L-176`（実ブラウザーで表示確認）、`L-371`（寸法変更が既存の検証手順の前提幅を壊さないか、`docs/verification.md` の期待を現状に合わせて追記）。

## 検証方針

- `frontend` で `npm test -- --watch=false` と `npm run build`（本番ビルド、`anyComponentStyle` 予算の警告・エラーがないことも含む）を実行し、全件成功を確認する。
- 実ブラウザーでデスクトップ幅（1440px）・中間幅（680px 前後のヘッダー境界、列幅帯の境界付近）・モバイル幅（375px）のボード一覧（空列・追加モーダル・列ドラッグUI含む）、カード詳細（変更履歴・削除確認モーダル含む）、状態表示（`.state-panel`）を確認し、計算済み `font-size` が約0.8倍であること、見切れ・重なり・折り返し崩れ・拡大前より悪化した横スクロールがないことを目視確認し、結果を `docs/verification.md` に記録する。
- 通常DBへ検証用カードや列を作成・変更しない（モーダル確認はキャンセルで閉じる）。
