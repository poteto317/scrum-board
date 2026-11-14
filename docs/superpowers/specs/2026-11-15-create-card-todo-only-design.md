# アイテム追加時のステータスは TODO 設計書

- 対象機能: カード #17「アイテム追加時のステータスはTODO」
- 概要: かんばん／バックログの「アイテムを追加」ダイアログからステータス（列）選択を外し、新規カードは常に Todo 列へ作成する。

## 決めたこと

| 項目 | 選択 | 根拠 |
| --- | --- | --- |
| 対象画面 | **A: ボードとバックログの両方** | カード文言はダイアログ全般。両方にステータス／初期ステータス select がある |
| ボードの列内「＋」 | **A: モーダルは開くが常に Todo** | 列から追加しても途中作業は後でステータス変更、というカード意図 |
| API `POST /api/cards` | **A: 変更しない（`columnId` 受付のまま）** | エージェント／CLI の既存契約を壊さない。UI だけ強制。`POST /api/cards/refined` は既に Todo 固定 |
| Todo 列が無いとき | **A: 作成せずフォームエラー** | 列を勝手に作らない既存方針に合わせる |

## 1. 現状と課題

1. ボードの追加モーダルに「ステータス」`<select formControlName="columnId">` があり、列の「＋」は `openCard(column.id)` でその列を初期選択する。
2. バックログの追加モーダルにも「初期ステータス」select があり、既定は Todo だが他列も選べる。
3. カード #17 は「基本 Todo 以外で作らない／ダイアログにステータス不要」と明記している。

## 2. 設計方針

- **UI のみ**で作成時ステータスを Todo に固定する。API・DB・履歴の契約は変えない。
- 作成後のステータス変更は従来どおり（詳細・DnD・`PATCH .../status`）。
- YAGNI: サーバ側の「常に Todo」強制、列名の国際化、作成確認の文言追加はしない。

## 3. フロントエンド

### 3.1 ボード（`board.html` / `board.ts`）

- カード追加フォームからステータスの label／select を削除する。
- `cardForm` から `columnId` コントロールを外す（タイトル・説明のみ）。
- `openCard(_columnId?: number)`: 引数はボタン配線の互換のため残してもよいが、**送信時は使わない**。モーダルを開くとき Form は title/description のみ reset。
- `addCard()`: `columns` から `name === 'Todo'` の id を解決して `api.createCard({ title, description, columnId: todoId })` に渡す。Todo が無ければ `formError` に日本語メッセージ（例: 「Todo 列が見つかりません。」）を出し、リクエストしない。
- 列追加モーダルは対象外。

### 3.2 バックログ（`backlog.html` / `backlog.ts`）

- 「初期ステータス」select を削除する。
- `cardForm` から `columnId` を外す。
- `openCard` / `addCard` はボードと同じく Todo 名で列 id を解決する（既存の Todo 既定ロジックを必須化）。

### 3.3 表示・文言

- README／verification に「追加ダイアログにステータス選択は無く、常に Todo」と書く。
- `docs/api.md` の `POST /api/cards` は現状どおり（`columnId` 必須のまま）でよい。UI 変更である旨を verification に書く。

## 4. バックエンド

変更なし。`CreateCard` は従来どおり任意の既存 `columnId` を受け付ける。

## 5. テスト

- ボード: モーダルに `#card-status` が無いこと。`addCard` が Todo 列 id で `createCard` を呼ぶこと（Doing 列の「＋」から開いても Todo）。**Todo 列が無い**（名前 `Todo` の列が columns に無い）ときリクエストせず formError を出すこと。カード 0 件の Todo 列は正常に作成できる。
- バックログ: `#backlog-card-status` が無いこと。同様に Todo id で作成すること。Todo 列が無いときも同上。
- 既存の `cardForm` に `columnId` を含むテストを title/description のみに更新する。

## 6. 非目標

- API で `columnId` を拒否／無視する変更
- Todo 列の自動作成
- 作成直後のステータス変更 UI の追加

## 7. 知見（優先度 A 関連）

- L-203: README・verification・設計／プランの文言を実装に同期する
- L-060: 組み立て役の配線（Todo id 解決）を外す変異で落ちるテストを置く
- L-057: Todo 欠落時は無言にせず formError で伝える

## サブエージェントのレビュー済み

- 2026-11-15: 承認推奨（§5「空」→「列が無い」の矛盾を解消後）
