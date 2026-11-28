# ロードマップ（ノード ↔ PBI・完了色）設計

## 背景

プロジェクトの機能ノードを一覧し、各ノードに必要な PBI（アイテム）を紐付ける。紐づく PBI の完了状況と、人手の動作確認によりノードを色分けする。

将来は draw-my-map 側でロードマップを管理する想定のため、本リポジトリでは **最小 MVP** に留める（キャンバス・依存線・自由配置・親子は作らない）。

## 決めたこと

ユーザー確認で方針 A を採用（2026-11-28）。

### スコープ

| 項目 | 決定 |
|--|--|
| 単位 | **プロジェクト単位**。ロードマップはノード一覧がその実体（プロジェクトに複数ロードマップは持たない） |
| 見せ方 | **フラット一覧**（縦リスト）。自由配置・グラフ線・浅い階層はしない |
| 権限 | ログイン済みなら **誰でも** 閲覧・編集（ノード CRUD・紐付け・動作確認） |
| 紐付け | ノード ↔ 同一プロジェクトのアイテム（公開番号）。1 アイテムが複数ノードに付くことは **許容** |
| 完了の定義 | 列名 **`Done`** のみを完了とみなす（Close / Review / Todo / Doing は未完了） |
| 紐付け 0 件 | 常に **未完了** |
| 移行 | draw-my-map 連携・エクスポートは **今回やらない** |

### 表示状態（永続化しない／都度計算）

| 状態 | `status` | 条件 | 色の意図 |
|--|--|--|--|
| 未完了 | `incomplete` | 紐付け 0、または Done 以外の PBI がある | ニュートラル／薄い警告 |
| PBI完了 | `items_done` | 1 件以上あり、すべて Done、かつ未確認 | 進行中（青系など） |
| 動作確認済み | `verified` | 上記 + `verified_at` あり | 完了（緑系など） |

### 動作確認と自動フォールバック

- 人が「動作確認する」を実行すると `verified_at` をセット（前提: すべて Done。否则 **409**）
- 確認の明示解除（DELETE verify）は任意で用意する
- **自動で落とす**（採用）: 紐付け変更や、紐づく item の status 変更で「すべて Done」が崩れたら `verified_at` をクリアし、`incomplete` / `items_done` へ戻す

### データモデル

テーブルは起動時 `CREATE TABLE IF NOT EXISTS`（既存の migrate パターンに合わせる）。

**`roadmap_nodes`**

- `id` BIGINT PK AI
- `project_id` BIGINT NOT NULL（INDEX）
- `title` VARCHAR(200) NOT NULL
- `description` TEXT NULL（上限はアプリで。0〜10000 程度）
- `position` INT NOT NULL DEFAULT 0
- `verified_at` DATETIME(6) NULL
- `created_at` / `updated_at` DATETIME(6)

**`roadmap_node_items`**

- `node_id` BIGINT NOT NULL
- `item_id` BIGINT NOT NULL（内部 ID。API 入出力は公開番号）
- PRIMARY KEY または UNIQUE `(node_id, item_id)`
- INDEX `(item_id)`（status 変更時の逆引き用）

プロジェクト削除時は `DeleteProject` の TX 内で両テーブルを掃除（L-1298）。FK の有無は既存表に合わせ、無くてもアプリ削除で孤児を残さない。

### API

いずれも認証必須。`projectId` クエリ必須（省略 400、存在しない 404）。

| Method | Path | 概要 |
|--|--|--|
| GET | `/api/roadmap-nodes?projectId=` | 一覧。各ノードに `items[]`（number, title, columnName 等）と計算済み `status` |
| POST | `/api/roadmap-nodes?projectId=` | `{ title, description? }` → 201 |
| PATCH | `/api/roadmap-nodes/{id}?projectId=` | title / description / position（未知キー 400） |
| DELETE | `/api/roadmap-nodes/{id}?projectId=` | 204。紐付け行も削除 |
| PUT | `/api/roadmap-nodes/{id}/items?projectId=` | `{ itemNumbers: number[] }` で紐付けを **置換**。他プロジェクト番号は 400 |
| POST | `/api/roadmap-nodes/{id}/verify?projectId=` | 動作確認。前提未達は 409 |
| DELETE | `/api/roadmap-nodes/{id}/verify?projectId=` | 確認解除 |

OpenAPI を同変更で更新する。item の status PATCH 成功後に、その item を含むノードの `verified_at` を再評価してクリアする。

### 画面

- ルート `/roadmap`（`authGuard`）。サイドナビに追加
- 縦リスト: 色帯 + タイトル + 状態ラベル + 紐づく PBI チップ
- 操作: 追加 / 編集 / 削除 / 並べ替え（position）/ PBI 紐付け / 「動作確認する」（`items_done` のときだけ活性）
- PBI チップ → 既存 `/items/:number`

### やらないこと（今回）

- 自由配置・依存線・親子階層・キャンバス
- draw-my-map 連携／移行エクスポート
- 公開 URL、管理者限定への権限分割
- ノード単位の担当者・期限・マイルストーン期日

## 受け入れ条件

1. プロジェクトのロードマップページでノードを追加・編集・削除・並べ替えできる
2. ノードに同一プロジェクトの PBI を紐付け／外せる
3. 状態が色とラベルで分かる（未完了 / PBI完了 / 動作確認済み）
4. 紐づく PBI がすべて Done のときだけ「動作確認」できる
5. Done 以外に戻す／未完了 PBI を足すと、動作確認済みが自動で外れる
6. ログイン済みメンバーなら編集可能

## 実装分割（Scrumboard）

1. ノードの永続化と CRUD API
2. PBI 紐付け API
3. 状態計算と動作確認（status 連動の verified クリア含む）
4. 一覧 UI（`/roadmap`・ナビ・色分け・操作）
5. プロジェクト削除時のノード掃除（小さく後続でも可）

## テスト方針（概要）

- Handler: CRUD、紐付けの project 境界、verify の 200/409、status 変更後の verified クリア
- FE: 状態ラベル／ボタン活性、紐付け・確認の操作経路
- MySQL テストの DROP 一覧に新テーブルを足す（L-1213）
