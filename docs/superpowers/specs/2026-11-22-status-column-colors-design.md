# ステータス列の色分け（#110）— 設計

- カード: [#110 ステータスの色分けをした](https://scrum-board-jkcejsb6ka-an.a.run.app/items/110?project=1)
- 日付: 2026-11-22

## 背景

- かんばん列の status-dot とカード上の `.card-status` バッジで、**Todo と Review が同じ色**（デフォルト灰）のため区別できない。
- Doing だけ金（`#b99342` / `#cfb56b` とバッジ `#93712e` / `#f6efdc`）が付いている。
- 要望: **Doing を青系**にし、**いま Doing に使っている色を Review へ移す**。
- 関連: `docs/superpowers/specs/2026-11-20-project-status-dots-design.md`（#81）は当時「ボードに Review 専用色は足さない」「セレクトの Review もデフォルト灰」「`board.html` の Review クラスは変えない」としていた。**本カード（#110）の設計を正**とする。実装時に #81 設計の次を #110 参照で改訂する: 色表（Doing=金 / Review=灰）、セレクタ形、非目標の「Review 専用色」、UI 構造コメント、受け入れの同色前提。旧プラン `docs/superpowers/plans/2026-11-20-project-status-dots.md` は履歴のため **改訂しない**（非目標）。矛盾時は常に本設計を優先。

## 決めたこと

| 事項 | 採用 |
|------|------|
| 対象 UI | (1) 列見出し `.status-dot` (2) カードフッタ `.card-status` (3) プロジェクト listbox の状態ドット（共有 CSS） |
| Doing 色 | **青系**。ドット: border `#4a7ab0` / fill `#6b9ac9`。バッジ: ink `#2f4f6a` / bg `#dce8f5`（既存 `.card-assignee[data-assignee='cursor']` と同系で統一感を保つ） |
| Review 色 | **現行 Doing の金**をそのまま移す。ドット: border `#b99342` / fill `#cfb56b`。バッジ: ink `#93712e` / bg `#f6efdc` |
| Todo | 現行デフォルトのまま（灰リング `#9ba698`、バッジ既定 `#edf0e9` / `#727c6c`）。専用修飾クラスは付けない |
| Done | 現行どおり緑（`var(--accent)`）。変更しない |
| 列修飾クラス | `board.html` に `[class.review]="column.name === 'Review'"` を追加。Doing / Done は既存 |
| CSS 配置 | status-dot は `styles.css` に次の完全セレクタ: `.kanban-column.doing .status-dot` / `.project-select-list .doing .status-dot`（青）と `.kanban-column.review .status-dot` / `.project-select-list .review .status-dot`（金）。`card-status` は `board.css` の `.doing .card-status` / `.review .card-status` / `.done .card-status` |
| セレクト Review ドット | 祖先 `.review` に色上書きを **書く**（#81 の「色上書きしない」を本カードで撤回）。Doing+Review 同時表示は青＋金で区別できる |
| 列名照合 | 完全一致 `"Doing"` / `"Review"` / `"Done"`（既存と同じ） |
| BE / API | **変更なし** |
| カスタム列・Close | デフォルト色のまま。対象外 |

### 検討したが採らなかった案

- **Doing を別パレットの鮮やか青にする**: 既存 UI の青（Cursor 担当バッジ）とずらすとノイズ。同系を採用。
- **列全体の背景色を変える**: 要望はドット／区別であり、列キャンバスまでは不要。
- **CSS 変数を増やして全テーマ化**: 本カードの範囲を超える。ハードコード hex の付け替えで足りる。
- **Todo にも専用色**: 要望は Review との区別。Todo はニュートラルのままがよい。

## 目的と受け入れ条件

1. ボード上で Doing 列の status-dot が青系、Review 列の status-dot が旧 Doing の金になる。
2. 各列のカード `.card-status` も同じ色対応（Doing=青、Review=金、Done=緑、Todo=既定）。`board.spec.ts` で Review 列クラスと `.review .card-status` の存在を固定する。
3. プロジェクト listbox の Doing / Review ドットもボードと同じ色になる。`styles.css` の両祖先（`.kanban-column.*` と `.project-select-list .*`）に Doing/Review ルールが揃っていることを回帰で固定する（片側だけ更新の検知）。
4. Todo / Done / Close / カスタム列の見た目は意図した範囲外の変更をしない（Done は現行維持）。
5. `board.spec.ts` で Review 列に `.review` が付くこと、`app.spec.ts` で listbox の `.review .status-dot` 配線が残ることを固定する（hex の視覚スナップショットは必須にしない）。

## 非目標

- バックエンド・DB・API
- 列背景・ボード全体テーマの刷新
- Close / カスタム列の専用色
- アクセシビリティ用のパターン（ハッチ）追加（色のみで要件を満たす）
- OpenAPI / README の必須更新
- 完了済み #81 実装プラン（`plans/2026-11-20-project-status-dots.md`）の改訂

## 実装概要（FE）

1. `board.html`: `[class.review]` を追加。
2. `styles.css`: Doing ドットを青へ。Review ドットを `.kanban-column.review .status-dot` / `.project-select-list .review .status-dot` に旧金で追加（両祖先を必ずペアで更新）。
3. `board.css`: `.doing .card-status` を青系へ。`.review .card-status` に旧金を追加。
4. テスト:
   - `board.spec.ts`: Review 列に `.review`、かつ `.kanban-column.review .card-status` が存在すること（AC2）。
   - `app.spec.ts`: listbox の `.doing .status-dot` / `.review .status-dot` 配線と aria-label の回帰（#81 L-060 継続）。
   - 共有 CSS の両祖先: 実装後に `styles.css` を目視または grep で `.kanban-column.(doing|review) .status-dot` と `.project-select-list .(doing|review) .status-dot` が揃うことを確認（片側欠落をプランの完了条件にする）。
5. #81 設計書の該当節を本カード参照で改訂（旧プランは触らない）。

## 知見（手順 4）

| ID | 扱い |
| --- | --- |
| L-792 | **守る**: グローバルへ色を足すとき祖先（`.kanban-column` / `.project-select-list`）で限定する |
| L-060 | **守る**: `board.spec.ts` で列 `.review` 配線、`app.spec.ts` で listbox ドット／aria-label 配線を継続固定 |
| （経緯） | #81 が Review 色を意図的に付けなかった点は、本カードの背景／#81 設計改訂で扱う |

## レビュー記録

### 第 1 周（記述の確かさ）2026-11-22 04:26
対応: L-048 誤紐付けを外す、セレクタ完全形、AC3/AC2 のテスト手段、#81 同期、テストファイル名を明記。

### 第 2 周（範囲と知見）2026-11-22 04:27
対応: #81 改訂対象節の列挙、旧プラン改訂を非目標、L-060 に app.spec、両祖先 CSS の完了条件を実装概要へ。
