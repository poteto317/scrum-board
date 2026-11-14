# かんばんカードの左端中央ドラッグハンドルによる並び替え 設計書

- 対象機能: かんばんでアイテムの順番を並び替えられるようにする（カード #14: `http://127.0.0.1:4200/cards/14`）
- 概要: かんばんボードのカード（アイテム）をドラッグ＆ドロップで並び替える際、誤操作を防ぐためにドラッグ可能な領域をカード左端の上下中央に配置したドラッグハンドル（`⋮⋮` アイコン）に限定する。

## 決めたこと

| 項目 | 選択 | 根拠 |
| --- | --- | --- |
| ベース実装 | **先行 PR #5（`feat/card-drag-drop`）マージ後の `main` を土台にする** | ユーザー選択。`cards.position`・`PUT /api/cards/order`・`@angular/cdk/drag-drop` の永続化・同期基盤をそのまま活かす |
| ドラッグの移動範囲 | **A: 左端中央のドラッグハンドルを掴んだときのみドラッグを開始でき、同一列内の順番変更と別ステータス列への移動の両方を行えるようにする** | ユーザー選択。ハンドル以外のカード面クリックは通常の詳細リンク遷移のみとし、誤ドラッグを防止する |
| ハンドルアイコンと表示 | **B: 列ヘッダーと同じドット型（`⋮⋮`）アイコンをカード左端の上下中央に常時表示する** | ユーザー選択。列ヘッダー（`.column-drag-handle`）やプロダクトバックログ（`.backlog-drag-handle`）と操作記号を統一し、タッチ端末やキーボード操作でも位置を見失わないようにする（`L-498`） |

## 1. 背景と現状の課題

1. 先行のカード #1（PR #5）により、`cards.position` の永続化・`PUT /api/cards/order`・`@angular/cdk/drag-drop`（`CdkDropList` / `CdkDrag`）による列内並び替えと列間移動が実装された。
2. しかし現状の `board.html` では `<article class="task-card" cdkDrag>` 内に `cdkDragHandle` が存在しないため、カードのタイトル・説明文（`.task-card-body`）やリンクコピーボタン（`.copy-card-link`）、カード余白のどこをドラッグしてもカードが移動してしまう。
3. カード #14 の要件は以下のとおりである。
   - プロダクトバックログのように、優先順位の高いものを上に持ってこれるようにする。
   - ドラッグアンドドロップで行えるようにする。
   - 間違えて操作してしまわないように、ドラッグできる場所を**カードの左端の中央**に限定し、そのためのアイコンを用意し、そこをドラッグした場合のみ並び替えられるようにする（YouTube のプレイリスト等のハンドル操作のイメージ）。

## 2. 設計方針

- **バックエンドは変更しない**: `cards.position` カラム、`PUT /api/cards/order`、トランザクション・ロック順序・履歴記録の仕様はすべて現状の `main` をそのまま使用する。
- **`CdkDragHandle` によるドラッグ起点の限定**: `<article class="task-card" cdkDrag>` の直下に `<button type="button" class="card-drag-handle" cdkDragHandle>` を追加する。`@angular/cdk/drag-drop` の `DragRef` は `_handles` が 1 つ以上登録されている場合、ポインターイベントの `target` がハンドル要素（またはその子孫）であるときのみドラッグシーケンスを開始し、それ以外の領域（`.task-card`・`.task-card-body`・`.copy-card-link`）からのドラッグ開始を一切行わない。
- **インタラクティブ要素の兄弟構造を維持（`L-494`, `L-761`, `L-785`）**: `<article class="task-card">` の直下に「ドラッグハンドル `<button class="card-drag-handle">`」「リンクコピーボタン `<button class="copy-card-link">`」「本文リンク `<a class="task-card-body">`」を兄弟として配置し、`<a>` の中に `<button>` を入れ子にしない。
- **キーボード操作とフォーカスの責務をハンドルへ集約（`L-785`）**:
  - 列ヘッダー（`.column-drag-handle`）およびプロダクトバックログ（`.backlog-drag-handle`）と同じく、上下矢印キー（`ArrowUp` / `ArrowDown`）による列内移動のキーハンドラー（`onCardKeydown`）、操作説明の関連付け（`aria-describedby="card-drag-help"`）、保存中の無効化表現（`[attr.aria-disabled]="!canReorderCards()"`、`disabled` 属性は使わない: `L-157`）、移動完了・失敗後のフォーカス復帰（`focusCardAfterRender`）を `.card-drag-handle` に集約する。
  - `.task-card-body`（`<a [attr.href]="cardHref(card)">`）は詳細画面を開くリンクに専念させ（`cursor: pointer`）、リンク上やコピーボタン上での矢印キーではカードを動かさない。

## 3. フロントエンド詳細設計

### 3.1 テンプレート構造（`frontend/src/app/board.html`）

1. 各カード（`<article class="task-card" cdkDrag ...>`）の先頭の子要素として `.card-drag-handle` を配置する:

```html
<article
  class="task-card"
  cdkDrag
  [attr.data-card-id]="card.id"
  [cdkDragData]="card"
  [cdkDragDisabled]="!canReorderCards()"
  (cdkDragStarted)="onCardDragStarted(card)"
  (cdkDragMoved)="onCardDragMoved($event)"
  (cdkDragReleased)="onCardDragReleased()"
  (cdkDragEnded)="onCardDragEnded()"
>
  <button
    type="button"
    class="card-drag-handle"
    cdkDragHandle
    [cdkDragHandleDisabled]="!canReorderCards()"
    [attr.aria-disabled]="!canReorderCards()"
    [attr.aria-label]="
      'TASK-' +
      card.number.toString().padStart(3, '0') +
      ' ' +
      card.title +
      'を移動（ドラッグまたは上下矢印キー）'
    "
    aria-describedby="card-drag-help"
    (keydown)="onCardKeydown($event, column.id, cardIndex)"
  >
    <span aria-hidden="true">⋮⋮</span>
  </button>
  <button
    type="button"
    class="copy-card-link icon-button"
    [attr.aria-label]="
      'TASK-' + card.number.toString().padStart(3, '0') + ' のリンクをコピー'
    "
    (click)="copyCardLink(card.number)"
  >
    ...
  </button>
  <a
    class="task-card-body"
    [attr.href]="cardHref(card)"
    (click)="onCardClick($event, card)"
  >
    ...
  </a>
</article>
```

2. `#card-drag-help` の補助説明文:
   - `canReorderCards()` が `true` のとき: `左端のハンドルをドラッグして別の位置やステータスへ移動できます。ハンドルで上下矢印キーを押すと列内を移動できます。`
   - `canReorderCards()` が `false` のとき: `保存中などのため、いまはカードを移動できません。`（`L-154`）
3. `.board-footer` の案内文言:
   - `列の見出しやカード左端のハンドルをドラッグ（または矢印キー）すると並び替えられます。` に更新する。

### 3.2 コンポーネント処理（`frontend/src/app/board.ts`）

1. `@angular/cdk/drag-drop` から `CdkDragHandle` をインポートし、`Board` コンポーネントの `imports` 配列に追加する。
2. `CDK_DRAG_CONFIG` の設定（`dragStartThreshold: CARD_DRAG_THRESHOLD_PX`, `dragStartDelay: { touch: CARD_TOUCH_DRAG_DELAY_MS, mouse: 0 }`）は維持する。
   - マウスでは `.card-drag-handle` を掴んで 8px（`CARD_DRAG_THRESHOLD_PX`）動かした時点でドラッグが始まる。
   - タッチでは `.card-drag-handle` 上の素早いスワイプ（200ms 未満）はスクロールのまま通し、200ms 長押ししてから動かしたときにドラッグが始まる（`L-783`）。
   - `.task-card`・`.task-card-body`・`.copy-card-link` をマウスやタッチでドラッグしても、`CdkDragHandle` の外であるためドラッグは一切始まらない。
3. `focusCardAfterRender(cardId: number)`:
   - フォーカス復元先セレクターを `[data-card-id="${cardId}"] .card-drag-handle` に変更する。
   - `this.destroyRef.destroyed || this.modal() !== null` の事前・描画後チェックを維持し、モーダル表示中や破棄後にフォーカスを奪わない（`L-762`）。
4. 既存の保護機能はすべてそのまま維持する:
   - ドラッグ中（`draggingCardId`）・保存中（`reordering`）の自動反映ポーリング抑止と古い in-flight 応答の破棄（`L-775`）
   - 端でのドラッグ時および静止時の横・縦自動スクロールと `(cdkDragReleased)` での即時停止（`L-781`, `L-782`）
   - ドロップ時のインデックス範囲チェックと移動元カード ID の照合（`L-541`, `L-775`）
   - 失敗時のスナップショットへのロールバックと非破壊エラーバナー（409 時は再読込のみ、500 等は閉じるボタン付き: `L-001`, `L-038`）

### 3.3 スタイル設計（`frontend/src/styles.css`, `frontend/src/app/board.css`）

1. `angular.json` の `anyComponentStyle` 予算（warning 6kB / error 8kB）を超えないよう、ドラッグハンドルの共通見た目（`.column-drag-handle, .card-drag-handle`）およびカード外枠・CDK ドラッグ状態（`.task-card`, `.task-card-body`, `.task-card .copy-card-link` 等）を `frontend/src/styles.css` にまとめる（`.copy-card-link` は詳細画面 `card-detail.html` でも使われるため `.task-card .copy-card-link` にスコープを限定する）。
2. カードのレイアウト（`board.css` / `styles.css`）:
   - `.task-card`: `display: flex; align-items: stretch;` とし、カード自体からは `cursor: grab` を削除する。
   - `.card-drag-handle`:
     - `.column-drag-handle` と共通のボタンスタイル（`cursor: grab`, `border: 0`, `border-radius: 4px`, `background: none`, `color: #9ba698`, `font-size: 10px`, `line-height: 1`, `letter-spacing: -1px`, `flex-shrink: 0`, `min-width: 24px`, `min-height: 24px`, `display: inline-grid`, `place-items: center`）を適用する。
     - `align-self: center; margin-left: 6px;` を指定し、**カードの左端・上下中央**に常時配置する。カードタイトルが複数行に折り返したり説明文（最大 3 行）が付いてカード高さが変わっても、常に左端の上下中央に保たれる。
     - `:active`（ただし `[aria-disabled='true']` でないとき）は `cursor: grabbing` とする。
     - `[aria-disabled='true']` のときは `cursor: default; opacity: 0.45;` とする。
   - `.task-card-body`:
     - `flex: 1; min-width: 0; padding: 17px 44px 13px 8px;` とし、`cursor: grab` を削除してリンク本来のポインターカーソル（`cursor: pointer`）にする。
   - `.task-card.cdk-drag-preview`:
     - `transition: none` を維持し（`L-784`）、`<body>` 直下に複製されたドラッグプレビューでも `display: flex` により左端中央ハンドルと本文のレイアウトがそのまま保たれる。
   - フォーカス表示（`L-412`, `L-785`）:
     - `.card-drag-handle:focus-visible` は `styles.css` の `button:focus-visible` による明確なアウトラインを表示する。
     - `.task-card:has(.task-card-body:focus-visible)` は本文リンクにフォーカスがあるときのカード外枠アウトラインとして維持する。

### 3.4 ドキュメント更新

- `README.md`: 「できること」の記述を、カード左端のハンドルによるドラッグ＆ドロップ・上下矢印キーでの並び替え・ステータス移動に合わせて更新する。
- `docs/verification.md`: かんばんカードの左端中央ドラッグハンドル限定に関する確認項目を追記する。

## 4. テストと検証計画（`L-059`, `L-789`）

1. **DOM 構造・CDK ハンドル配線テスト（`board-card-structure.spec.ts`, `board-cdk-wiring.spec.ts`）**:
   - 各 `.task-card`（`<article cdkDrag>`）の直下に `.card-drag-handle`（`<button type="button" cdkDragHandle>`）、`.copy-card-link`（`<button>`）、`.task-card-body`（`<a>`）が兄弟として存在し、入れ子になっていないこと。
   - `.card-drag-handle` のテキストに `⋮⋮` が含まれ、`aria-label` と `aria-describedby="card-drag-help"` を持つこと。
   - `CdkDragHandle` ディレクティブが各カードの `.card-drag-handle` に配線され、保存中（`reordering() === true`）は `disabled` が `true`、`aria-disabled="true"` になること。
2. **ドラッグ開始領域の限定テスト（`board-touch-drag.spec.ts`, `board-card-drag-live-refresh.spec.ts`, `board-cdk-wiring.spec.ts`）**:
   - **ハンドルからのドラッグ開始**: `.card-drag-handle`（およびその内側の `<span>⋮⋮</span>`）からのマウスドラッグ（8px 以上の移動）およびタッチ長押し（200ms 経過後の移動）で `CdkDrag.started` が発火すること（`L-789`）。
   - **ハンドル以外からのドラッグ抑止**: `.task-card`・`.task-card-body`・`.copy-card-link` からのマウスドラッグ（8px 以上の移動）およびタッチ長押し（200ms 経過後の移動）では、`CdkDrag.started` が**発火しない**こと。
   - `.card-drag-handle` の単なるクリックではカード詳細画面へ遷移しないこと。一方 `.task-card-body` の通常クリックでは詳細画面へ遷移し、修飾キー付きクリック・中クリックはブラウザー既定動作に任せること。
3. **キーボード移動とフォーカス保持テスト（`board.spec.ts`, `board-card-reorder-state.spec.ts`, `board-card-structure.spec.ts`）**:
   - `.card-drag-handle` 上での `ArrowUp` / `ArrowDown` で列内のカード順序が入れ替わり、保存成功時・失敗時ともに移動したカードの `.card-drag-handle` にフォーカスが戻ること。
   - `.task-card-body` や `.copy-card-link` 上での `ArrowUp` / `ArrowDown` ではカードが移動しないこと。
4. **全体検証**:
   - `cd frontend && npm test -- --watch=false && npm run build`
   - `cd backend && go test -race ./... && go vet ./...`

## 5. 非目標（YAGNI）

- バックエンド API・DB スキーマの変更
- プロダクトバックログ画面（`backlog.*`）や列ヘッダー（`.column-drag-handle`）の DnD 方式の変更
- キーボードでの列間（別ステータスへ）の直接移動（既存どおり詳細画面のステータス選択またはドラッグで行う）

## 6. 反映した知見 ID

- `L-001`, `L-038`, `L-059`, `L-154`, `L-157`, `L-412`, `L-494`, `L-498`, `L-541`, `L-761`, `L-762`, `L-775`, `L-780`, `L-781`, `L-782`, `L-783`, `L-784`, `L-785`, `L-789`
