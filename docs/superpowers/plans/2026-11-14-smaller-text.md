# 全体の文字サイズ縮小（約0.8倍）実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **`/feature` 実行中はコミットしない。**

**Goal:** 文字サイズを現在の約0.8倍に縮小し、フロントエンド全体をレイアウト崩れなく表示できるようにする。
**Architecture:** 既存の5つのCSSファイル（`styles.css`, `app.css`, `board.css`, `card-detail.css`, `card-history.css`）の全 `font-size` と、拡大時に広げた関連固定寸法を `Math.round(現在のpx * 0.8)` 基準で引き下げる。列幅のメディアクエリは縮小後の必要幅で重複しない帯に書き換える。HTML/TS/API/DBは変更しない。
**Tech Stack:** Angular 21（CSS / Vitest / Angular CLI）。
**Spec:** `docs/superpowers/specs/2026-11-14-smaller-text-design.md`

## Global Constraints

- HTMLテンプレート構造・TypeScriptロジック・Go API・DBスキーマは変更しない。
- 倍率は現状値×0.8（拡大前への復帰ではない）。`zoom` / `rem` 化はしない。
- `L-048`・`L-059`・`L-176`・`L-371`・`L-499`・`L-671`・`L-757` を満たすこと。
- `npm run build`（本番ビルド）で `angular.json` の `anyComponentStyle` 予算（warning 6kB / error 8kB）を超えないこと。
- 実ブラウザー確認では通常DBへ検証用カードや列を作成・変更しない（モーダル確認はキャンセルで閉じる）。
- ヘッダー折りたたみ幅は `800px` → `680px`（`Math.round(800*0.8)=640` に「直さない」。設計書の意図どおり 680）。
- 列幅メディアクエリは設計書の順序どおり書く（`701–1147` のあと `701–1051` で上書き。順序を逆にしない）。
- `/feature` のため各タスク末尾で git commit しない。

## File Map

| ファイル | 責務 |
| --- | --- |
| `frontend/src/styles.css` | 共通ボタン・フォーム・モーダル・状態表示・列DnD UI の文字/枠 |
| `frontend/src/app/app.css` | アプリヘッダー |
| `frontend/src/app/board.css` | ボード見出し・列幅帯・カード・フッター |
| `frontend/src/app/card-detail.css` | カード詳細 |
| `frontend/src/app/card-history.css` | 変更履歴 |
| `docs/verification.md` | 検証結果の追記 |

---

### Task 1: 共通スタイル (`frontend/src/styles.css`) の縮小

**Files:**
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: なし
- Produces: 共通 UI の約0.8倍の文字・枠サイズ（後続タスクの画面が継承/併用）

- [x] **Step 1: `font-size` と関連寸法を更新する**

次の値に置き換える（設計書どおり）:

- `body`: `font-size: 14px;`
- `.primary, .secondary, .danger-button`: `font-size: 14px; padding: 10px 14px;`
- `.icon-button`: `width: 29px; height: 29px; font-size: 22px;`
- `label`: `font-size: 14px;`
- `input, textarea, select`: `font-size: 16px;`（iOS フォーカスズーム回避の下限。全体0.8倍の例外）
- `.required, .optional`: `font-size: 10px;`
- `.field-note`: `font-size: 11px;`
- `.form-error`: `font-size: 14px;`
- `.state-panel`: `font-size: 14px;`
- `.spinner`: `width: 22px; height: 22px;`
- `.modal`: `width: 432px;`
- `.modal h2`: `font-size: 20px;`
- `.reorder-alert`: `font-size: 10px;`
- `.column-drag-handle`: `font-size: 10px;` に加え `min-width: 24px; min-height: 24px; display: inline-grid; place-items: center;`
- `.form-actions` の `flex-wrap: wrap;` は維持

- [x] **Step 2: ファイル内に残る拡大後サイズがないか確認する**

Run: `rg -n 'font-size:\\s*(1[7-9]|2[0-9]|3[0-9])px' frontend/src/styles.css`  
Expected: 縮小後に残ってよい大きい値は無い（このファイルの対象はすべて ≤16px 前後。`.modal h2` の 20px と `.icon-button` の 22px のみ例外として残る）

---

### Task 2: アプリヘッダー (`frontend/src/app/app.css`) の縮小

**Files:**
- Modify: `frontend/src/app/app.css`

**Interfaces:**
- Consumes: Task 1 の共通スタイル
- Produces: 縮小後ヘッダー（折りたたみ `680px`）

- [x] **Step 1: ヘッダー寸法を更新する**

- `.app-header`: `height: 67px;`
- `.brand`: `font-size: 27px; gap: 10px;`
- `.brand-dot`: `margin-left: -9px;`
- `.brand-mark`: `height: 24px;`
- `.brand-mark i`: `width: 5px; height: 24px;`
- `.brand-mark i:nth-child(2)`: `height: 17px;`
- `.brand-mark i:nth-child(3)`: `height: 10px;`
- `.header-divider`: `height: 21px;`
- `.workspace-name`: `font-size: 14px;`
- `.header-end`: `font-size: 12px;`
- `.local-dot`: `width: 6px; height: 6px;`
- `.avatar`: `width: 32px; height: 32px; font-size: 16px;`

- [x] **Step 2: 折りたたみブレークポイントを更新する**

`@media (max-width: 800px)` を `@media (max-width: 680px)` に変更し、`.app-header` の `height` を `59px;` にする。**640px にしない。**

---

### Task 3: かんばんボード (`frontend/src/app/board.css`) の縮小と列幅帯

**Files:**
- Modify: `frontend/src/app/board.css`

**Interfaces:**
- Consumes: Task 1 の `.icon-button` 等
- Produces: 縮小後ボードと L-757 準拠の列幅帯

- [x] **Step 1: 見出し・ツールバー・カード・空状態・フッターを更新する**

- `.breadcrumb`: `font-size: 12px;`
- `.eyebrow`: `font-size: 10px;`
- `h1`: `font-size: 36px;`
- `.page-heading p`: `font-size: 14px;`
- `.board-toolbar`: `min-height: 50px; height: auto;`
- `.active-tab`: `font-size: 14px; padding: 10px 4px;`
- `.board-icon`: `font-size: 22px;`
- `.toolbar-count`: `font-size: 11px; padding: 3px 7px;`
- `.board-summary`: `font-size: 11px;`
- `.kanban-column`（既定）: `width: 288px; flex: 0 0 288px;`
- `.column-heading h2`: `font-size: 14px;`
- `.status-dot`: `width: 8px; height: 8px;`
- `.column-count`: `font-size: 11px; min-width: 19px; padding: 2px 5px;`
- `.card-id`: `font-size: 10px;`
- `.card-arrow`: `font-size: 16px;`
- `.task-card h3`: `font-size: 14px; line-height: 1.65;`
- `.card-description`: `font-size: 12px; line-height: 1.75;`
- `.card-status`: `font-size: 10px; padding: 3px 6px;`
- `.detail-hint`: `font-size: 10px; white-space: nowrap;`
- `.add-card`: `font-size: 12px;`
- `.add-card > span`: `font-size: 19px;`
- `.empty-column`: `min-height: 168px; height: auto; padding: 16px 10px;`
- `.empty-symbol`: `width: 35px; height: 35px; font-size: 22px;`
- `.empty-column p`: `font-size: 12px;`
- `.empty-column > span:last-child`: `font-size: 10px;`
- `.add-column-tile`: `flex: 0 0 132px; font-size: 12px;`
- `.board-footer`: `font-size: 11px;`
- `.tip-icon`: `width: 15px; height: 15px; font-size: 10px;`
- `.footer-note`: `font-size: 10px;`

- [x] **Step 2: 列幅メディアクエリを設計書の帯に置き換える（順序厳守）**

既存の `1905` / `1645` / `1399` / `1279` 系を削除し、次の順で書く:

```css
@media (min-width: 1572px) {
  .kanban-column {
    width: 312px;
    flex-basis: 312px;
  }
}
@media (min-width: 1360px) and (max-width: 1571px) {
  .kanban-column {
    width: 264px;
    flex-basis: 264px;
  }
}
@media (min-width: 701px) and (max-width: 1147px) {
  .kanban-column {
    width: 256px;
    flex-basis: 256px;
  }
}
@media (min-width: 701px) and (max-width: 1051px) {
  .kanban-column {
    width: 237px;
    flex-basis: 237px;
  }
}
@media (max-width: 700px) {
  /* このブロック全体を置き換えない。既存ルール（.board-page padding、
     .mobile-break、.board-summary / .footer-note の display:none 等）は残し、
     次の3つだけ値を更新する */
  .page-heading h1 { font-size: 28px; }
  .eyebrow { font-size: 9px; /* letter-spacing 等は既存のまま */ }
  .kanban-column { width: 248px; flex-basis: 248px; }
}
```

実効帯（必要幅に `.board-columns` 左右 padding 12px を含む）: `≤700→248` / `701–1051→237` / `1052–1147→256` / `1148–1359→288` / `1360–1571→264` / `≥1572→312`

---

### Task 4: カード詳細・変更履歴の縮小

**Files:**
- Modify: `frontend/src/app/card-detail.css`
- Modify: `frontend/src/app/card-history.css`

**Interfaces:**
- Consumes: Task 1 の共通フォームスタイル
- Produces: 縮小後の詳細・履歴画面

- [x] **Step 1: `card-detail.css` を更新する**

- `.detail-page`: `max-width: 960px;`
- `.back-link`: `font-size: 14px;`
- `.eyebrow`: `font-size: 11px;`
- `h1`: `font-size: 31px;`
- `.detail-heading p`: `font-size: 14px;`
- `.detail-layout`: `grid-template-columns: minmax(0, 1fr) 264px;`
- `.section-label`: `font-size: 12px;`
- `.properties .field-note`: `font-size: 11px;`
- `.timestamps`: `font-size: 11px;`
- `.timestamps time`: `font-size: 12px;`
- `.detail-tip`: `font-size: 11px;`
- `.danger-link`: `font-size: 12px;`
- `.delete-copy`: `font-size: 14px;`
- `.success-message`: `font-size: 14px;`
- `.properties input`: `font-size: 16px;`（フォーム下限に合わせる）
- `.pr-link`: `font-size: 14px;`
- `.save-state`: `font-size: 14px;`
- `@media (max-width: 750px)` は維持（1カラム化のビューポート分岐）

- [x] **Step 2: `card-history.css` を更新する**

- `h2`: `font-size: 18px;`
- `.history > p`: `font-size: 14px;`
- `.history-event`: `font-size: 14px;`
- `time, .recorded`: `font-size: 12px;`
- `.value span`: `font-size: 11px;`

---

### Task 5: テスト・ビルド・実ブラウザー検証・検証記録

**Files:**
- Modify: `docs/verification.md`（「文字サイズ縮小」節を追加）

**Interfaces:**
- Consumes: Task 1–4 のCSS変更
- Produces: 自動化・実機の検証証拠

- [x] **Step 1: 自動化を通す**

Run（`frontend` ディレクトリ）:

```bash
npm test -- --watch=false
npm run build
```

Expected: 全テスト成功、本番ビルド成功、`anyComponentStyle` の warning/error なし。

- [x] **Step 2: 一時開発サーバーで実ブラウザー確認する**

例: `npx ng serve --port 4212` + 既存 `proxy.conf.json`。DBは書き換えない。

確認観点:

1. デスクトップ幅（1440px）: ボード・ヘッダー・フッター・空列・追加タイル。列追加/カード追加モーダルを開いてキャンセル。カード詳細（履歴・削除確認を開いてキャンセル）。`.state-panel`（読込中表示）と列ドラッグ UI（`.column-drag-handle` / 失敗時の `.reorder-alert` が出ていればその文字サイズ）も確認。主要要素の計算済み `font-size` が変更前の約0.8倍。
2. ヘッダー境界（680px 前後）: `680px` 以下で workspace 等が隠れ、`681px` 以上で見える（`max-width: 680px`）。
3. 列幅帯境界（1051 / 1147 / 1360 / 1572 付近）: 実効帯どおりの列幅。拡大時より悪化した横スクロールが無いこと。
4. モバイル幅（375px）: ボード横スクロール・モーダルボタン折り返し・詳細1カラム。

終わったらサーバーを止める。

- [x] **Step 3: `docs/verification.md` に追記する**

「機能ごとの確認」に次を追加する:

```markdown
### 文字サイズ縮小

- CSS の文字サイズを現状の約0.8倍に縮小し、関連固定寸法・列幅帯を調整
- HTML / TypeScript / API / DB は変更なし
- 複数幅（1440 / 列幅帯境界 / 680 ヘッダー境界 / 375）での表示確認
```

---

## Spec coverage (self-review)

| 設計書 | タスク |
| --- | --- |
| styles.css 一覧 | Task 1 |
| app.css + 680px | Task 2 |
| board.css + 列幅帯 | Task 3 |
| card-detail / card-history | Task 4 |
| 検証・verification.md | Task 5 |
| L-048/059/176/371/499/671/757 | Global Constraints + Task 3/5 |
| コミットしない | Global Constraints |
