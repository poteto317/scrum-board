# DB 列名・制約名を item に揃える

## 背景

表名は `items` / `item_*` へ移行済みだが、補助表の物理列・制約に `card_id` / `related_card_id` / `task_number` と `card` を含むインデックス／FK 名が残っている。公開 API・JSON・URL は既に item 系。

## 決めたこと

| 事項 | 採用 |
|------|------|
| 移行方式 | 起動時冪等マイグレーション（表リネームと同型。`GET_LOCK` + `information_schema` 判定） |
| 列 | `card_id`→`item_id`、`related_card_id`→`related_item_id`、`task_number`→`item_number` |
| インデックス／UNIQUE／FK／CHECK | 対象表で名前に `card` または `task_number` を含むものを `item` 系へ改名。列定義由来の暗黙 UNIQUE 名（例: `task_number`）も含む |
| 冪等単位 | **列・制約ごと**（表単位の「全部スキップ」はしない。片列だけ終わった途中状態でも残りを続行） |
| インデックス改名 | 既存データ付きは **`RENAME INDEX` 優先**（DROP+ADD は使わない） |
| DDL 以後 | numbering / history / pr_links / related / command_templates の CREATE は新名のみ |
| アプリ SQL | 全参照を新列名へ更新。重複キー検出は `uq_item_related_`（移行中の旧名 `uq_item_related_card` / 歴史的 `uq_card_related_` も移行完了まで残してよい） |
| 本番 | PR マージ後に Cloud Run へデプロイし、API スモークで確認 |
| 対象外 | `item_number_sequence.next_number`、Go 識別子・ファイル名、CSS（`.task-card` 等）、公開 JSON/API キー、過去 specs/plans の歴史記述 |
| 知見 | L-456（id/時刻を書き換えない）、L-791（列参照初期化より前に列 DDL）、L-001（移行失敗は起動失敗）、L-038（途中状態は列単位冪等で回復） |

## 目的と受け入れ条件

1. 本番・開発とも対象テーブルに旧列名（`card_id` / `related_card_id` / `task_number`）が残らない。
2. 対象テーブルの制約・インデックス名に `card` または `task_number` が部分文字列として残らない（暗黙名 `task_number` 含む）。
3. 既存機能（ボード、詳細、関連、PR、履歴、採番、コマンドテンプレ）が回帰なく動く。行の id・公開番号・作成時刻は変わらない。
4. マイグレーションは冪等（新名のみの DB で実質 no-op。途中状態からも完了できる）。
5. `/api/board` と `/api/items/by-number/{n}` が 200 を返し、公開番号表示が維持される。

## 対象テーブルとリネーム

以下は**網羅リスト**（実装はこの表＋ information_schema で同表内に残る `card` / `task_number` 名を掃いて改名）。

| テーブル | 列 | 制約・インデックス |
|----------|----|---------------------|
| `item_numbers` | `card_id`→`item_id`、`task_number`→`item_number` | `fk_card_number`→`fk_item_number`；暗黙 UNIQUE 名 `task_number`→`item_number`（または `uq_item_number`）；CHECK を `item_number > 0` 向けに |
| `item_history` | `card_id`→`item_id` | `fk_history_card`→`fk_history_item`；`history_import` / `history_order` は名前に card が無ければ列 CHANGE のみ（列参照は新名） |
| `item_pr_links`（＋`__new` があれば） | `card_id`→`item_id` | `uq_card_pr_url`→`uq_item_pr_url`；`fk_item_pr_links_card`→`fk_item_pr_links_item`；`fk_item_pr_links_card_new`→`fk_item_pr_links_item_new` |
| `item_related_items` | `card_id`→`item_id`、`related_card_id`→`related_item_id` | `uq_item_related_card`→`uq_item_related_item`；`uq_item_related_url` は列参照のみ；`fk_item_related_owner` / `fk_item_related_peer` は列参照更新（名前に card が無ければそのまま） |
| `item_command_templates` | `card_id`→`item_id` | `fk_item_command_templates_card`→`fk_item_command_templates_item` |

`items` 本体に `card_*` 列はない（`items_column_position` / `items_backlog_position` 済み）。

## 起動順序

`RenameCardTablesToItems` の直後、各 `Initialize*`（positions / backlog / pr_links / related / numbers / …）の**前**に `RenameCardColumnsToItems` を実行する（L-791）。

理由: 後続 CREATE IF NOT EXISTS が旧列定義のまま走ると、既に存在する表は触れず旧列のまま残り、新規環境だけ新列になる分裂を防ぐ。CREATE 定義自体も新列名に書き換える。

## マイグレーション手順（各表）

1. 表が無ければスキップ。
2. **列ごと**: `information_schema` で旧列があれば FK 依存を外したうえで `CHANGE COLUMN`（型・NULL 性維持。データ値・行 id は触らない = L-456）。旧列が無ければその列はスキップ。
3. **制約・インデックスごと**: 旧名が残っていれば `RENAME INDEX`（または FK の DROP）。
4. **期待する新 FK / UNIQUE / INDEX が無ければ ADD**（旧名も新名も無い途中クラッシュ後の回復。新名が既にあればスキップ）。「旧名が無い＝完了」だけでは制約欠落を成功扱いしない（L-038）。
5. `task_number`→`item_number` 時は CHECK（`item_number > 0`）も追随。暗黙 UNIQUE 名 `task_number` も改名。
6. 表全体を「旧列が一つも無いから全部スキップ」とはしない。片列・片制約だけ残っていても残りを続行する。

失敗時はエラーを呼び出し元へ返し起動失敗とする（L-001。現行マイグレーションと同じ）。

## アプリ・テスト

- SQL 文字列・DDL 定数を新列名へ一括更新。
- `dbError` の関連重複検出は `uq_item_related_` を正とし、移行過渡の旧名も照合してよい。
- 統合テストの INSERT/SELECT を新列名へ。旧スキーマを意図的に組むテストは「旧→新」経路の検証用に限り、マイグレーション後は新名を前提にする。
- 旧列あり DB → 起動後に新列・新制約のみ、および新列のみ DB で no-op、の両方をテストする。

## ドキュメント

- 本 spec を正とする。
- `2026-11-16-items-url-rename-design.md` の「列名当面維持／対象外」を「列リネーム済み（本 spec）」に更新。
- 過去の関連 specs/plans の歴史記述は原則触らない。

## 本番反映

1. 実装 PR をマージする。
2. 既存の GCP デプロイ手順で Cloud Run を更新する（起動時に列リネームが走る）。
3. スモーク: `GET /api/board`（`items` 配列）、`GET /api/items/by-number/26` が 200。

## 対象外（明示）

- `item_number_sequence.next_number`
- Go の変数・型・ファイル名の機械的リネーム
- CSS クラス名
- 公開 API / JSON フィールド名（変更済み）
- 過去ドキュメントの歴史的記述の一括書き換え
