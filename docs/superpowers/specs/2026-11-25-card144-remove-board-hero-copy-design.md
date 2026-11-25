# ボード画面上部のヒーロー文言を削除する（#144）設計

## 背景

ボード画面（`frontend/src/app/board.html` 3〜9 行目）には、パンくず（`.breadcrumb`）とボードツールバー（`.board-toolbar`）の間に `<section class="page-heading">` が配置されており、以下の 3 つの文言と上下の大きな余白（`margin: 37px 0 38px`）を表示している。

- `YOUR WORK, ONE STEP AT A TIME`
- `小さく始めて、前へ進める.`
- `アイデアをタスクに。ひとつずつ、着実に。`

このヒーロー見出し領域があることで、ページを開いた際にブラウザのファーストビュー領域が大きく占有され、かんばんボード本体が下へ押し下げられている。

## 目的と完了条件（チケットから）

- ボード画面から上記 3 文言およびそれを表示している領域（`<section class="page-heading">`）を削除し、ページを開いた際に不要な領域占有をなくす。

## 決めたこと

### 1. ヒーロー文言セクションを削除する（`frontend/src/app/board.html`）

- 3〜9 行目の `<section class="page-heading">...</section>` を削除し、`.breadcrumb` の直後に `.board-toolbar` が配置される構造にする。

### 2. 見出し階層（`h1`）の維持とグローバル `h1` スタイルの打ち消し

- ボード画面には列見出し（`<h2>`）およびカード見出し（`<h3>`）が存在するため、アクセシビリティ・文書構造上のページ主見出し `<h1>` を維持する目的で、`.board-toolbar` 内の `<div class="active-tab">`（11〜13 行目）を `<h1 class="active-tab">` に変更する。
- `frontend/src/styles.css`（215〜221 行目）にグローバルの `h1` ルール（`font-size: 36px; letter-spacing: -1px; line-height: 1.4; font-weight: 650; margin: 0;`）が存在し、他画面のページ見出しでも参照されている。そのため `styles.css` は変更せず（L-792）、`frontend/src/app/board.css` の `.active-tab` に `margin: 0; letter-spacing: normal; line-height: normal;` を明示する（`font-size: 14px; font-weight: 650;` は既に指定済み）。これにより元の `div.active-tab` と同一の見た目と高さを保ち、領域の膨張や字間の詰まりを防ぐ。

### 3. 未使用スタイルの削除とツールバー上余白の最小確保（`frontend/src/app/board.css`）

- デスクトップ側の未使用スタイル（`.page-heading`・`.eyebrow`・`h1`・`.heading-dot`・`.page-heading p`・`.mobile-break`：19〜50 行目）を削除する。
- `@media (max-width: 700px)` 内の未使用スタイル（`.page-heading`・`.page-heading h1`・`.mobile-break`・`.eyebrow`：401〜413 行目）を削除する。
- `.board-toolbar` に `margin-top: 12px;` を追加し、`.breadcrumb` との最小限の余白を確保する。

### 4. テストによる回帰防止（`frontend/src/app/board.spec.ts`）

- `frontend/src/app/board.spec.ts` にテストを追加し、以下を検証する。
  - 削除した 3 文言（`YOUR WORK, ONE STEP AT A TIME`・`小さく始めて`・`前へ進める`・`アイデアをタスクに。ひとつずつ、着実に。`）および `.page-heading` が DOM に描画されないこと。
  - `h1.active-tab` がちょうど 1 つ存在し、`かんばんボード` を含むこと。
  - 注入済み `board.css` テキスト（`document.querySelectorAll('style')`）において、`.active-tab` ルールが `margin: 0`・`letter-spacing: normal`・`line-height: normal`・`font-size: 14px` を宣言し、`.board-toolbar` ルールが `margin-top: 12px` を宣言していること。
  - 同注入済み CSS テキストから、削除対象とした不要セレクタ（`.page-heading`・`.eyebrow`・`.heading-dot`・`.mobile-break` および `board.css` 内の単独 `h1`）が除去されていること（`board.css` 以外の `<style>` が混入しないよう、テスト内で注入する `styles.css` の `<style>` とは分離するか、対象コンポーネントのスコープ属性付きテキストまたは `Board` マウント時注入スタイルで確認する）。
  - 単体テスト（jsdom）環境では `frontend/src/styles.css` が読み込まれず（`frontend/angular.json` 上 `build` 専用）、また `styles.css` 側の `h1` ルール自体は `margin: 0;` を持ちつつ実ブラウザーの UA スタイルシートは `h1` に上下マージンを付けるため、`board.spec.ts` の `dialog.modal-backdrop` テストと同様にテスト内で一時 `<style>` 注入（`try ... finally { tag.remove(); }`）を行う。具体的には `styles.css` の競合プロパティ（`font-size: 36px; letter-spacing: -1px; line-height: 1.4; font-weight: 650;`）に加えて実 UA の上下マージンを再現する非ゼロ余白（`margin: 24px 0;`）を与えた競合 `h1` ルールを注入したうえで、`getComputedStyle(h1)` が `fontSize: '14px'`・`letterSpacing: 'normal'`・`lineHeight: 'normal'`・`marginTop: '0px'`・`marginBottom: '0px'` を保ち、グローバル `h1` や UA 余白に上書きされないことを確かめる。

## 範囲外

- `frontend/src/index.html`（11 行目）の `<meta name="description">`: 画面表示領域を占有しないメタ情報のため変更しない。
- ボード画面以外の他画面（`backlog.html`・`sprints.html`・`sprint-detail.html`・`trash.html`・`recurring.html`・`login.html`・`projects.html`・`users.html`・`settings.html`・`archive.html`・`item-detail.html`・`item-solution.html`）の `.page-heading`・`.eyebrow`。
- `frontend/src/styles.css` のグローバル `h1`・`.page-heading`・`.eyebrow` 定義: 他画面が参照しているため変更しない。

## 気をつける知見

- **L-792**: 他画面と共有されるグローバル `styles.css` は変更せず、ボード専用スタイルは `board.css` 内に閉じて `.active-tab` へ明示リセットを与える。
- **L-060 / L-175**: 文言削除と `h1.active-tab` の双方、およびグローバル `h1` 打ち消しスタイルをテストで固定し、見た目の退行や要素残存を確実に検出できるようにする。
- **L-590**: 実装プランと検証記録に記載するテストファイル・件数・実行対象を実測値と一致させる。
