# プロジェクトごとのアイテム番号（アイテム #192）

## 背景

カード要件: プロジェクトごとにアイテムの表示番号を分け、各プロジェクトで 1 から採番してほしい。現状はワークスペース全体で一意の `item_number`（シーケンス）であり、プロジェクト導入時も「番号は全体一意のまま」としていた。

## 決めたこと（推奨案を採用）

| 事項 | 採用 |
|------|------|
| 一意性 | **`(project_id, item_number)` で一意**。ワークスペース全体 UNIQUE は廃止 |
| 採番 | プロジェクトごとにシーケンス（`next_number`）。Create 時はその所属プロジェクトの次番号 |
| 表示 | JSON `number` はプロジェクト内番号。表示は従来どおり `ITEM-` + ゼロ埋め（プロジェクト接頭辞は付けない） |
| プロジェクト移動 | 移動先プロジェクトの **次番号を新規発行**して付け替える（移動元番号は欠番のまま残す。繰り下げない・L-455） |
| 詳細 URL | `/items/{number}` に加え、曖昧さ回避のため **`?project={projectId}` を正**とする。コピーリンクは必ず `project` を付ける |
| 取得 | すべての `.../by-number/{number}...` は任意クエリ `projectId`（正の整数）を受け、**同一解決ヘルパ**で解決。指定時はそのプロジェクト、省略時は解決後アクティブ。無ければ 404 |
| 深いリンクでアクティブ | `?project=` 付きで詳細を開いたとき、既存 **`ProjectSession.switchTo`（または同等）を再利用**: busy ON → アクティブ PATCH（既存 settings 経路・未知キー保持・L-459）→ 詳細 load 完了まで busy／poll 抑止（L-037/L-040）→ その後 busy OFF。同一 busy 中は addItem／作成モーダル／layout 変更を拒否（L-844）。PATCH 失敗時は詳細 load しない |
| RelatedItem | **`projectId` を JSON に載せ、リンク／番号解決に必須で使う**（推奨を採用） |
| 関連の番号→id | 入力または関連行の `projectId` 内で `(project_id, item_number)` を解決。`projectId` 省略時は 400。存在しなければ 404 |
| マイグレーション | 既存行をプロジェクトごとに旧 `item_number` 昇順（同点 `item_id`）で 1..n に振り直す。`items.id` / `created_at` は触らない（L-456） |
| シーケンス表 | `item_number_sequence` をプロジェクト単位へ（`project_id` PK）。グローバル singleton は廃止／置換 |
| 非目標 | 番号の手動編集、削除時の詰め直し、プロジェクト接頭辞付き表示、旧グローバル番号の永久リダイレクト表、RelatedItem 無しのクロスプロジェクト誤解決の許容 |

## 目的と受け入れ条件

1. 新規アイテムの `number` は、所属プロジェクト内で 1 から増え、他プロジェクトの番号と独立する。
2. ボード／バックログ／詳細に出る番号は、そのアイテムのプロジェクト内番号である。
3. 同じ数字が別プロジェクトに共存できる（例: 両プロジェクトに `ITEM-001`）。
4. 詳細のリンクコピーは `/items/{number}?project={projectId}` を入れ、別端末・別アクティブでも同じカードを開ける。
5. `projectId` 無しの `/items/{number}` は、解決後アクティブにその番号が無いと 404（他プロジェクトの同番は開かない）。
6. プロジェクト移動後、移動先で新しい番号が付き、移動元の番号は再利用しない（欠番可）。
7. 既存データはプロジェクト内で旧番号順に 1..n へ再割当され、内部 `id` は不変。

## データモデル

### `item_numbers`

| 列 | 変更 |
|----|------|
| item_id | PK・FK のまま |
| item_number | プロジェクト内番号（>0） |
| project_id | **追加** NOT NULL、FK → projects(id)。items.project_id と常に一致させる |

制約: `UNIQUE (project_id, item_number)`。旧 `UNIQUE (item_number)` は削除。

`project_id` 列は items と二重管理になるが、by-number 検索を JOIN 無し／軽い JOIN にするため持つ。Create／移動／マイグレーションで **items.project_id と同期**する。食い違い検知はテストで固定。

### `item_number_sequence`

| 列 | 変更 |
|----|------|
| project_id | PK（旧 singleton 廃止） |
| next_number | そのプロジェクトの次発行値 |

プロジェクト Create 時に `next_number=1` の行を入れる。マイグレーション後は各プロジェクトで `MAX(item_number)+1`。

## API

- `POST /api/items`（・refined）: 所属プロジェクトのシーケンスを `FOR UPDATE` して採番。`projectId` 省略時は解決後アクティブ。
- `PATCH /api/items/{id}` の `projectId` 変更: 移動先シーケンスで新番号。`item_numbers.project_id` と `item_number` を更新。
- **by-number 系（本イテですべて同一ヘルパ）**: `GET /api/items/by-number/{number}`、`.../status`、`.../assignee`、`.../history`、`.../command-templates` および同等の by-number ルート。任意クエリ `projectId`（正の整数）。指定時はそのプロジェクト、省略時は解決後アクティブ。無ければ 404。ヘルパ外の独自解決は禁止。
- 関連アイテム追加など number→id 変換: リクエストに `projectId` が必須（省略は 400）。`(projectId, number)` で解決し、無ければ 404。
- RelatedItem レスポンス: `number` に加え **`projectId` を必須で返す**（リンク生成・再解決用）。
- `GET /api/board` 等の `number` フィールド意味がプロジェクト内番号に変わる（破壊的。ドキュメントに明記）。

## FE

- `itemDetailUrl` / コピーリンク: `?project={projectId}` 必須。
- ルータ: `items/:number` で `project` クエリがあるとき、**`ProjectSession.switchTo` を再利用**し、順序は busy ON → アクティブ PATCH（既存 settings API・未知キー保持・L-459）→ `itemByNumber(number, projectId)` で詳細 load → **詳細 load 完了（成功／失敗）まで busy／poll 抑止を維持してから busy OFF**（L-037 / L-040）。同一 busy 中は addItem／作成モーダル／layout 変更を拒否（L-844。既存 switchTo が既に拒否していればそのまま使う）。PATCH 失敗時は詳細 load しない。
- `project` クエリ無しの深いリンク: 現在の解決後アクティブで by-number（クエリ無し）。無ければ 404。
- `itemByNumber(number, projectId?)` が API に `projectId` クエリを付ける。
- RelatedItem リンク: 現行／今後の RelatedItem API 応答の `projectId` を使い `/items/{number}?project={projectId}` を生成する。`projectId` 欠落はバグ扱い。
- 履歴イベント内の番号リンク: **現行以降の書込**で `projectId` を載せる。既存履歴 JSON の backfill は本イテ非目標。欠落時はアクティブ前提のフォールバック（誤解決しうる）とし、Known 制約に残す。

## マイグレーション手順（既存 DB）

起動時（`main` / Initialize）の順序（L-791）: **本マイグレーション（DDL・データ振り直し）を完了してから**、`item_numbers.project_id` を参照する SELECT／採番 Initialize／履歴初期化を走らせる。列追加より先にその列を読む処理を置かない。

1. `item_numbers` に `project_id` 追加（NULL 可）→ `items` から埋める → NOT NULL + FK。
2. 旧 UNIQUE(item_number) を落とし、UNIQUE(project_id, item_number) を張る前に、プロジェクトごとに `ORDER BY item_number, item_id` で 1..n に UPDATE（一時列または再挿入）。
3. `item_number_sequence` を新形へ（新表作成→プロジェクトごと next を投入→旧表削除、または ALTER で置換）。
4. 再実行しても id／番号が変わらないこと（冪等）。既に per-project 形ならスキップ。

## 知見

優先度 A: L-001, L-037, L-040, L-455, L-456, L-459, L-791  
優先度 B: L-842, L-844, L-460（並び替えは番号と独立）

- L-455: 移動・削除で既存番号を繰り下げない。
- L-456: マイグレーションで item id / createdAt を振り直さない。
- L-037 / L-040: 深いリンク切替は詳細 load 完了まで busy／poll 抑止。
- L-459: アクティブ PATCH は既存 settings 経路を使い、入れ子を丸ごと置換せず未知キーを保持する。
- L-791: `item_numbers.project_id` 参照より前に DDL・データ移行を完了する。
- L-844: 同一 busy で作成・layout も拒否（既存 ProjectSession 再利用）。

## 既知の制約

- マイグレーション後、旧グローバル番号のブックマーク（`?project=` 無しの大きな番号）はアクティブ内に無ければ 404。
- 番号の欠番は埋めない。
- AI refined 作成もプロジェクト内採番に従う。
- 移動元の旧番号へのリンクは、移動後そのプロジェクト内に同番が無ければ 404（リダイレクト表は作らない）。
- 既存履歴イベントに `projectId` が無い場合の番号リンクはアクティブ前提で誤解決しうる（backfill しない）。
