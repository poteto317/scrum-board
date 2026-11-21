# バックログにリンク／コマンドコピーアイコン（アイテム #74）

## 背景

カード要件:

- バックログの方を見てアイテムを選ぶ場合もあるので、こちらにもワンクリックでリンクやコマンドをコピーできるアイコンが欲しい。

現状:

- ボードのカードには `card-quick-actions` としてコマンドメニュー＋リンクコピーがあり、`CopyLinkFeedback` / `CopyCommandFeedback` / `CopyFeedbackBanner` で結果を出す。
- バックログ行は番号・タイトル・ステータス・「詳細」リンクのみ。コピー UI は無い。

## 決めたこと

| 事項 | 採用 |
|------|------|
| スコープ | **1A** ボードと同機能（リンクコピー＋コマンドメニュー一式） |
| 配置 | **2A** 各行の右側に quick-actions。順序はボードと同じ（コマンド → リンク） |
| 実装 | **3A** 既存ヘルパをバックログへ配線。共有コンポーネント抽出は必須にしない |
| フィードバック | **4A** バックログ頁にも同型のコピー結果バナー |

ユーザーは推奨を一括採用。

## 目的と受け入れ条件

1. バックログの各行に、ボードと同型のコマンドアイコンとリンクコピーアイコンがある（マークアップ・a11y・動作）。
2. リンクコピー: クリックでアイテム URL をクリップボードへ。成功／失敗はボードと同じ文言・バナー。
3. コマンド: クリックでテンプレート一覧を開き、1 件なら自動コピー（ClipboardItem 経路含む）、複数ならメニューから選択。空／読込中／エラー表示はボードと同型。閉じる条件: 再クリック（L-879）、外側クリック、Esc、**window resize**、**window scroll**、**`.backlog-scroll` の scroll**。
4. コマンド一覧の in-flight 応答は `commandMenuLoadGeneration` と `openCommandItemId` で世代ガードし、古い一覧／ClipboardItem 成功後の `announce` でメニューやバナーを更新しない（ボードと同型）。
5. プロジェクト切替・`load`／フィルタで対象行が一覧から消えたとき・コンポーネント破棄時はメニューを閉じ generation を進める。一覧の `backlogLoadGeneration` とは別カウンタだが、load／切替成功時にメニューも閉じる。
6. コピー操作は `loading` / `projectSwitching` / 追加モーダル open 中でも無効化しない（ボード同様）。`reordering()`・行 DnD 中もコピーボタンは押せる。
7. ドラッグ開始はコピー UI 上で起きない: quick-actions を **`.backlog-drag-zone` の外**（行内の兄弟）に置くか、`onItemDragStart` で `.copy-command` / `.copy-card-link` を詳細リンクと同様に `preventDefault`。`draggable="false"` をボタンに付ける。
8. `projectId` 付き URL／API 呼び出しはボードと同じスコープ規則。
9. API／DB スキーマ変更なし。
10. メニューはボードと同じ **viewport 固定座標**（`fixedCommandMenuStyle` 相当）と開中行の `command-menu-open` 相当クラスで、`.backlog-scroll` の overflow にクリップされない。
11. 見た目: アイコン SVG・メニュー見た目はボードに揃える。grid は下記 UI 節。狭幅でも両ボタンが押せる（非表示にしない。タイトル側を ellipsis）。
12. バナーは既存 `LatestCopyFeedback`（タイマー所有権はボード／#45 と同じ）。連続コピーで古いタイマーが新メッセージを消さない。

## UI

- **行レイアウト（確定）:** grid 列を  
  `rank | number | title | status | quick-actions | detail`  
  とする。`quick-actions` はステータスと「詳細」の**間**。中身はボードと同じく **コマンド → リンク**。
- **バナー（確定）:** `app-list-filter-bar` の直下、`.backlog-scroll` の直前（`reorder-alert` があるときはその下でも可だが、スクロール領域の外）。`LatestCopyFeedback` 経路。
- **a11y（ボード必須セット）:** コマンドボタンに `aria-haspopup="menu"` / `aria-expanded` / `aria-label`（番号含む）。メニュー `role="menu"`、項目 `role="menuitem"`、空・読込・エラーは `role="status"`。リンクボタンは `aria-label`（番号＋「のリンクをコピー」）。

## 実装方針

- `backlog.ts` にボード相当のメニュー状態・`toggleCommandMenu` / `copyItemLink` / `copyCommand` / HostListener／`.backlog-scroll` scroll を追加。ボードからコピーして差分を最小にする（3A）。共通コンポーネント化は本カードの完了条件に含めない。
- CSS: **本カードでは `backlog.css` にボード同型の規則を書く**（`board.css` の共通抽出は非対象。重複は許容）。`quick-actions` 列は `auto`、狭幅でもボタンを畳まない。

## 非対象

- 共有 Angular コンポーネントへの抽出リファクタ（任意・後続可）
- ボード CSS／挙動の変更・共通スタイル抽出
- 新しいコマンド API

## 知見（手順 4）

- **L-037 / L-040（コマンドメニュー）:** `listItemCommandTemplatesByNumber` の応答と `commandMenuLoadGeneration` / 開中 id。切替・load・行消失・破棄でも閉じる
- **L-037（バナー）:** `LatestCopyFeedback` のタイマー所有権（ボードと同じクラスを使う）
- **L-879:** メニュー開中の再クリックで閉じる
- ボード既存の ClipboardItem 経路（単一テンプレートの即コピー）を壊さない

## テスト方針

- バックログ: リンクコピー成功バナー、コマンド 1 件で自動コピー、複数でメニュー、外側クリック／`.backlog-scroll` scroll で閉じる、generation で古い一覧を捨てる、load／切替でメニューが閉じる、コピー UI から DnD が始まらない。
- 既存ボードのコピー系 spec は回帰として触らない（壊さない）。

## サブエージェントによる設計書レビュー

### 第1周（記述の確かさ）

対応: 配置を status と detail の間に固定、バナー位置、drag zone 外／除外、`.backlog-scroll` でも閉じる、fixed メニュー、a11y セット、grid 列、busy 時の有効性、generation の対象を限定。

### 第2周（範囲と知見）

対応: 切替／load／行消失でメニュー閉じ、バナーのタイマー所有権、CSS は backlog 内重複に限定（board 横断抽出は非対象）。L-879 は既反映。
