# 公開 URL・用語をアイテム（items）に揃える（カード #26）

## 背景

カード説明: 「cards ではなく items の方が適切。なぜならプロダクトバックログアイテムだから。」

現状の公開詳細は `/cards/:number`、表示プレフィックスは `TASK-`、画面文言は「カード」「アイテム」が混在。API は `/api/cards`、JSON の集合キーは `cards`、関連の kind は `"card"`。

## 決めたこと

| 事項 | 採用 |
|------|------|
| 公開詳細パス | **`/items/:number`** |
| 旧 `/cards/:number` | **`/items/:number` へリダイレクト**（Angular `redirectTo`） |
| API パス | **`/api/items…` にリネーム**（`/api/cards…` は廃止。リポジトリ内クライアントはすべて更新） |
| JSON 集合キー | board / backlog 応答の **`cards` → `items`** |
| ドメイン型・UI 層の名前 | **`Card` → `Item`**（FE/BE の型・主要コンポーネント・ファイル名・API クライアントメソッド） |
| 画面文言 | 主要な「カード」を **「アイテム」** に寄せる（ユーザー向け UI・aria・エラーメッセージ） |
| 番号プレフィックス | **`TASK-` → `ITEM-`**。表示は **常に3桁ゼロ埋め**（`ITEM-003`）。ボード・詳細・バックログ・aria・announce・関連フォールバックで統一 |
| 関連 kind | JSON / DB の **`card` → `item`**（起動時マイグレーションで既存行を更新） |
| 公開 JSON の id 配列キー | 列内／バックログ並び替えの **`cardIds` → `itemIds`**（リクエスト・ドキュメントとも） |
| DB 物理表名 | **`cards` / `card_*` → `items` / `item_*`**（起動時 `RENAME TABLE`。列名 `card_id` などは当面維持） |
| ドキュメント | **README・docs/api.md・verification・smoke 等の利用者向けを更新**。過去の specs/plans は歴史として原則触らない |
| 対象外 | 英語の CSS クラス名（`.task-card` 等）の一括リネーム、外部に出た旧 `/cards` ブックマーク以外の互換 API、DB 列名 `card_id` の物理リネーム |

## 目的と受け入れ条件

1. 詳細は `/items/{公開番号}` で開き、コピーリンク・`{{url}}`・関連のアプリ内リンクも同形式になる。
2. `/cards/{公開番号}` にアクセスすると `/items/{公開番号}` へ遷移する。
3. HTTP API は `/api/items` 系のみ。旧 `/api/cards` は 404。
4. board / backlog の JSON は `items` 配列を返す。
5. 画面上の番号表示は **3桁ゼロ埋めの** `ITEM-` で始まる（例: 詳細・ボード・バックログとも `ITEM-003`）。
6. ユーザー向けの主要な「カード」文言が「アイテム」になる（ツールバー、追加ダイアログ、詳細、バックログ、関連入力の案内、コマンド管理の説明など）。
7. コード上の公開型・主要サービスが `Item` 命名になる（`Item`, `ItemDetail`, `itemDetailUrl`, `api.itemByNumber` 等）。
8. 関連 kind `"item"` で読み書きでき、既存 `"card"` 行は起動時に変換される。
9. 既存の並び替え・autosave・履歴・コマンド等の回帰テストが通る。

## 公開 URL（FE）

- ルート: `path: 'items/:number'` → 既存詳細コンポーネント（リネーム後 `ItemDetail`）。
- 互換: `path: 'cards/:number'` → `redirectTo: 'items/:number'`（パラメータ引き継ぎ）。
- `itemDetailUrl(origin, number)` → `{origin}/items/{number}`（旧 `cardDetailUrl` を置換）。
- board / backlog / 関連の `routerLink`・`navigate`・`prepareExternalUrl` を `/items` に更新。

## API（BE + FE クライアント）

パス対応（例）:

| 旧 | 新 |
|----|----|
| `GET/POST /api/cards` | `GET` なし作成は `POST /api/items` |
| `GET /api/cards/{id}` | `GET /api/items/{id}` |
| `GET /api/cards/by-number/{n}` | `GET /api/items/by-number/{n}` |
| `PATCH /api/cards/{id}` | `PATCH /api/items/{id}` |
| `PATCH …/by-number/{n}/status` | 同左を items 配下 |
| `PATCH …/assignee` | 同 |
| `DELETE /api/cards/{id}` | `DELETE /api/items/{id}` |
| `PUT /api/cards/order` | `PUT /api/items/order` |
| `POST /api/cards/refined` | `POST /api/items/refined` |
| `…/history` | items 配下 |
| `…/command-templates` | items 配下 |
| `POST /api/command-templates/apply-to-all-cards` | `…/apply-to-all-items` |

JSON:

- `{ "cards": [...] }` → `{ "items": [...] }`（board / backlog）。
- 関連: `{ "kind": "item", "number": N, ... }`。書き込みも `"item"`。`"card"` は受理しない（移行後）。
- 並び替えボディの id 配列は **`itemIds`**（下記表）。

FE `Api` のメソッド名も `itemByNumber` / `updateItem` 等に合わせる。

## 表示プレフィックス

共通ヘルパー（例: `formatItemNumber(n: number): string` → `` `ITEM-${padStart(3,'0')}` ``）を1か所に置き、ボード・詳細・バックログ・aria・announce・関連フォールバックがすべてこれを使う。

## 公開 JSON の識別子キー

| 場所 | 旧 | 新 |
|------|----|----|
| board / backlog 配列 | `cards` | `items` |
| `PUT /api/items/order` 等の列内順 | `cardIds` | `itemIds` |
| `PUT /api/backlog/order` | `cardIds`（または同等） | `itemIds` |
| 履歴インポート等でクライアントが送る公開フィールド名に `cardId` がある場合 | `cardId` | `itemId`（DB 列は `card_id` のまま） |

## 文言

ユーザー向け日本語の「カード」を「アイテム」へ。コマンドテンプレート文言（「全カードに適用」等）も「全アイテム」へ。テストの期待文字列を追従。

開発者向けコメントや `.claude` は必須ではない。

## コードリネーム方針

- **やる:** 型 `Item` / `ItemInput` / `ItemPatch`、Go 同名、Angular コンポーネント・サービスファイルの `card-*` → `item-*`（`git mv`）、セレクタ `app-item-detail` 等、テストファイル名。
- **やらない（今回）:** DB 表・列の物理名、CSS の `.task-card` / `data-card-id`（動作に無関係な識別子。必要なら追従リネームは別カード）。
- 関連テーブルの kind 値だけアプリ＋マイグレーションで `item` に変更。

一括機械置換は誤爆しやすいので、プランでは層ごとに（URL → API → 型 → UI 文言 → ファイル名）分割する。

## DB

- 表 `cards` 等はリネームしない。
- `card_related_items.kind`: `'card'` → `'item'` を起動時マイグレーションで `UPDATE`（冪等）。
- CHECK / アプリ検証を `item` に更新。

## ドキュメント・スクリプト

- `README.md`, `docs/api.md`, `docs/verification.md`, `scripts/smoke.py` 等のパス・用語を更新。
- 過去の superpowers specs/plans は変更しない（#26 を指す一文があるコピーリンク設計はそのまま）。

## 知見

- **L-018**: 検証したパス／kind と保存・生成する値が一致すること。
- **L-035**: 公開番号と内部 id の取り違えをリネーム時に持ち込まない。
- **L-037 / L-040**: ルート名変更後もカード切替の cancel$ が動くこと。
- **L-456**: マイグレーションで id / created_at を作り直さない（kind の UPDATE のみ）。
- **L-002**: 関連 kind 欠損を空と取り違えて壊さない。

## 対象外

- DB 列名 `card_id` などの物理リネーム（表名は `items` / `item_*` へ移行済み）
- CSS クラス一括リネーム
- 外部ツールがまだ `/api/cards` を叩く場合の永久互換レイヤ（必要なら別カード）
- 英語 UI コピー（YOUR WORK…）の変更

## レビュー済み

- サブエージェントレビュー **Approved**（ゼロ埋め3桁固定、`cardIds`→`itemIds` を反映済み）。
