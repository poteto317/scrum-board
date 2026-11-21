# スプリント機能（ITEM-082）

## 背景

カード要件:

- スプリントの期間を決められる。
- スプリントに含めるアイテムを決められる。
- スプリントゴールを設定できる。
- スプリントの結果（ベロシティ）を記録できる。

現状:

- スプリント实体・API・UI は無い。
- アイテムにストーリーポイント／見積フィールドは無い。
- バックログ仕様（`2026-11-14-product-backlog-design.md`）はスプリント割当を明示的に対象外としていた。
- プロジェクト単位でボード／バックログは既に分離済み（`active_project_id`）。

## 決めたこと（推奨案を採用）

AskUserQuestion をこのセッションでは使わず、以下の推奨案を採用して設計を確定する。

| 事項 | 採用 |
|------|------|
| 所属 | スプリントは **プロジェクトに属する**（`projectId` 必須）。他プロジェクトのアイテムは含めない |
| 期間 | **開始日・終了日**（日付のみ。時刻なし）。`startDate <= endDate`。ローカル暦日を `YYYY-MM-DD` で送受信し、DB は `DATE` |
| ゴール | スプリントの `goal` 文字列（空可）。上限 2000 Unicode スカラー |
| メンバー | 接合表 `sprint_items`。同一プロジェクトの生存アイテムのみ。1 アイテムは **未完了スプリントに最大 1 つ**。完了済みスプリントの履歴メンバーは残す |
| 状態 | `planned` / `active` / `completed`。プロジェクトあたり **active は最大 1** |
| ベロシティ | **手動記録**の非負整数。完了時に Done 列メンバー件数を **提案値**として返す（ストーリーポイントは初版対象外） |
| Done 列 | ワークスペース列のうち **名称が正確に `Done`** の列。`Close` は含めない。該当列が無ければ `suggestedVelocity` は `0` |
| 完了操作 | `POST .../complete` は **`active` のみ** → `completed`。任意で `velocity`。`planned` からの直接完了は不可（先に activate）。状態付き確定操作（L-062） |
| アクティブ化 | `POST .../activate`。`planned`→`active` のみ。別の active がある場合は 409 |
| UI | `/sprints` 一覧＋`/sprints/:id` 詳細。サイドバーに「スプリント」。ボード／バックログのカード面へのバッジは初版対象外 |
| 削除 | planned / active のみ削除可（メンバー紐付けも CASCADE 削除）。completed は削除不可（履歴保持）。ハード削除のみ |
| プロジェクト削除 | 既存どおり生存アイテム 0 件が必要。アイテム 0 件なら残スプリント（completed 含む）をプロジェクト削除と同一 TX で自動削除 |
| ソフト削除 | アイテム soft delete 成功時、当該 `item_id` の **すべての** `sprint_items` 行を削除する（完了済み含む）。hard delete は FK CASCADE |
| プロジェクト移動 | `PATCH` でアイテムの `projectId` が変わったとき、当該 `item_id` の **すべての** `sprint_items` を削除する（完了済み履歴も外す。初版は履歴残しをしない） |
| アクティブ表示 | `board_settings` にスプリント ID は持たない。一覧・詳細は解決後アクティブ **プロジェクト** のスプリントだけ |

## 目的と受け入れ条件

1. 解決後アクティブプロジェクトに対してスプリントを作成でき、名称・ゴール・開始日・終了日を設定・更新できる。
2. スプリント詳細で、同プロジェクトの生存アイテムをメンバーに追加・除外できる。他プロジェクト／ゴミ箱／未存在は拒否（400 または 404）。
3. 未完了スプリント（planned / active）に既に入っているアイテムを、別の未完了スプリントへ追加しようとすると 409。
4. スプリントを `active` にでき、同一プロジェクトに既に active がある場合は 409。`planned` へ戻す PATCH は不可（遷移は activate / complete のみ）。完了は **active からのみ**。
5. active スプリントを完了でき、そのとき（または完了後 PATCH で）ベロシティを非負整数として記録できる。応答の `suggestedVelocity` は、メンバーのうち列名が正確に `Done` の列にいる件数（`Close` 除外。Done 列なしは 0）。
6. `/sprints` で当該プロジェクトのスプリント一覧が見られる。並びは **`start_date` 降順、同日は `id` 降順**。サイドバーから遷移できる。
7. `/sprints/:id` でゴール・期間・メンバー・状態・ベロシティを確認・編集できる（状態に応じた編集可否あり）。
8. 既存のボード／バックログ／詳細の主フローは壊さない（スプリント未使用時と同等）。
9. 起動時マイグレーションで表を作成し、`001_schema.sql` と同期。既存行の id / createdAt は触らない（L-456）。
10. 認証は既存セッションと同じ。メンバー GET は view 可能なアイテムだけ返す。`itemCount` も **同じ CanView 基準**で数え、view 不可メンバーを件数に含めない（L-901）。メンバー PUT は **edit 可能なアイテムだけをリクエストに含められる**。サーバは、呼び出し元から **view 不可のためレスポンスに出していない既存メンバー ID を PUT 時に維持**する（可視集合 ∪ 不可視の既存＝保存集合。L-460）。
11. activate / complete / メンバー PUT / 作成 / 各 PATCH は API 成功を確認してから UI を確定する（L-001）。activate / complete 処理中はボタンを属性ごと無効化し、成功後はスプリントを再 GET する（L-062）。詳細の未保存ゴールがあるときは `canDeactivate` / `canLeave` で離脱確認する。
12. sprint 各ハンドラは body / query / path ID / 日付の検証を **ユーザー確保・DB より先**に行う（L-930）。不正入力では TX を開かない。

## データモデル

### `sprints`

| 列 | 型 | 備考 |
|----|-----|------|
| id | BIGINT PK AI | 再利用しない（L-455） |
| project_id | BIGINT NOT NULL FK → projects(id) RESTRICT | プロジェクト削除はスプリント 0 件が前提 |
| name | VARCHAR(120) NOT NULL | trim 後 1〜120 |
| goal | TEXT NOT NULL | 既定 `''`。上限 2000 Unicode スカラー |
| start_date | DATE NOT NULL | |
| end_date | DATE NOT NULL | `start_date <= end_date` |
| status | VARCHAR(16) NOT NULL | `planned` / `active` / `completed` |
| velocity | INT NULL | 未記録は NULL。**completed のみ**設定可。`>= 0` |
| created_at / updated_at | DATETIME(3) | |

索引: `(project_id, status)`、`(project_id, start_date DESC, id DESC)`。

### `sprint_items`

| 列 | 型 | 備考 |
|----|-----|------|
| sprint_id | BIGINT NOT NULL FK → sprints(id) ON DELETE CASCADE | |
| item_id | BIGINT NOT NULL FK → items(id) ON DELETE CASCADE | |
| position | INT NOT NULL | スプリント内表示順。0 始まり密 |

PK `(sprint_id, item_id)`。索引 `(item_id)`（未完了重複チェック用）。

**不変条件（アプリ＋トランザクションで保証）:**

- メンバー追加時、`items.project_id` はスプリントの `project_id` と一致し、`deleted_at IS NULL`。
- アイテム soft delete 時、および `projectId` 変更時は、当該 `item_id` の `sprint_items` をすべて削除。
- 同一 `item_id` が `status IN ('planned','active')` のスプリントに 2 件以上属さない。
- `itemCount` / GET メンバーは **生存かつ同一プロジェクトかつ CanView** の接合行だけを数える・返す。

## API

クエリのプロジェクトは既存どおり **`projectId`**（L-934）。省略時は解決後アクティブ。

| 操作 | 方法 | 備考 |
|------|------|------|
| 一覧 | `GET /api/sprints?projectId=` | `{ sprints: SprintSummary[] }`。`start_date` 降順、同日は `id` 降順 |
| 作成 | `POST /api/sprints` | body: `name`, `goal?`, `startDate`, `endDate`, `projectId?`。初期 status=`planned`、velocity=`null` |
| 取得 | `GET /api/sprints/{id}` | メンバー付き。`suggestedVelocity` = Done 列メンバー数（上記定義） |
| 更新 | `PATCH /api/sprints/{id}` | `name` / `goal` / `startDate` / `endDate` / `velocity`（ポインタ）。`status` は PATCH しない。メンバー変更は不可（PUT items を使う） |
| 削除 | `DELETE /api/sprints/{id}` | planned/active のみ 204。completed は 409 |
| メンバー置換 | `PUT /api/sprints/{id}/items` | body: `{ itemIds: number[] }`。planned/active のみ。可視メンバーの完全集合＋サーバ保持の不可視既存メンバー。**1 TX**（L-038） |
| アクティブ化 | `POST /api/sprints/{id}/activate` | planned→active。他 active チェック込みで **1 TX**。他 active があれば 409。active/completed は 409 |
| 完了 | `POST /api/sprints/{id}/complete` | **active のみ**→completed。body 任意 `{ velocity?: number }`。status 更新と velocity 設定は **1 TX**。planned は 409。応答に `suggestedVelocity` |
| プロジェクト削除 | 既存 `DELETE /api/projects/{id}` | 生存アイテム 0 かつ **スプリント 0** のときのみ可。スプリントが残ると 409 |

ハンドラ共通: 入力検証 →（通った場合のみ）セッション／権限 → DB（L-930）。

### PATCH フィールド規則

- `name` / `goal` / `startDate` / `endDate`: planned / active / completed いずれも更新可。
- `velocity`: **`status=completed` のときのみ**。省略＝変更なし、`null`＝クリア、非負整数＝設定。planned / active で `velocity` キーが在れば **400**（L-002）。
- completed ではメンバー PUT・activate 不可。

### JSON 形（抜粋）

```json
{
  "id": 1,
  "projectId": 1,
  "name": "Sprint 12",
  "goal": "モバイルの主要バグを潰す",
  "startDate": "2026-11-21",
  "endDate": "2026-12-04",
  "status": "active",
  "velocity": null,
  "suggestedVelocity": 3,
  "items": [{ "id": 10, "number": 82, "title": "...", "columnId": 3 }],
  "createdAt": "...",
  "updatedAt": "..."
}
```

一覧の `SprintSummary` は `items` を省略し、`itemCount`（生存・同一プロジェクト・**呼び出し元が CanView** のメンバー数）を含める。

### 検証

- 日付: `YYYY-MM-DD` のみ。暦として無効・`startDate > endDate` は 400（L-044）。
- `velocity`: complete body / completed の PATCH のみ受理。負数・非整数は 400。
- `name` 空白のみ不可。`goal` は trim しないが Unicode スカラー数上限超過は 400（L-858）。
- 未知フィールドは 400（既存 `DisallowUnknownFields`）。
- ID は正の有限整数のみ（L-046 / L-047）。

## クライアント挙動

### ルーティング

- `/sprints` → 一覧（`authGuard`）
- `/sprints/:id` → 詳細
- サイドバー（board / backlog 隣）に「スプリント」リンク。折りたたみ時はアイコン＋`aria-label`

### 一覧

- 解決後アクティブプロジェクトのスプリントを表示。プロジェクト切替で再取得（既存 project session と同じ）。
- 行: 名称・期間・状態・メンバー数・ベロシティ（完了時）。
- 「新規スプリント」で作成ダイアログ（名称・開始・終了。ゴールは詳細で）。

### 詳細

- ゴール編集（デバウンスまたは blur 保存。失敗時は成功扱いしない。L-001）。
- 期間編集（date input。確定後 PATCH）。
- メンバー: チェックリスト。候補は同プロジェクトの生存かつ edit 可能なアイテム。保存は可視メンバーの完全集合を `PUT`（サーバが不可視を維持）。
- planned: 「開始」（activate）ボタン。完了ボタンは出さない。
- active: 「完了」ボタン。確認ダイアログでベロシティ入力（`suggestedVelocity` を初期表示）。ダイアログが表示されているときだけ確定可能。
- activate / complete / メンバー PUT 中は該当ボタンを `disabled`（属性）。成功後に詳細を再 GET。失敗時はダイアログやローカル状態を成功扱いにしない（L-001 / L-062）。
- ゴール等の dirty があるとき詳細ルートは `canDeactivate`（既存 ItemDetail と同型）。
- completed: メンバー編集・activate 不可。velocity は PATCH で編集可。

### ボード／バックログ

- 初版はスプリント表示・フィルタを足さない（スコープ）。

## マイグレーション

1. `InitializeSprints(ctx)`: `sprints` / `sprint_items` を `CREATE TABLE IF NOT EXISTS`。索引も冪等。
2. 登録先: `backend/cmd/server/main.go`（`InitializeProjects` の後）と `backend/internal/kanban/mysql_test.go` の setup（同順。L-791）。
3. `database/init/001_schema.sql` に同定義を追記。
4. 既存データへの backfill は不要（空で開始）。id/createdAt 上書きなし（L-456）。
5. soft delete / project 移動の既存 Repository 経路に `sprint_items` 掃除を追加。プロジェクト削除の 409 条件にスプリント残存を追加。

## 対象外（初版）

- ストーリーポイント／見積フィールド
- ボード・バックログ上のスプリントバッジ・フィルタ・DnD でスプリントへ投入
- 複数 active スプリント、スプリントの複製、バーンダウン、自動完了
- `planned` から直接 complete
- スプリント番号の採番（名称は自由文字列）
- MCP ツール追加（必要なら別カード）
- `board_settings.active_sprint_id`

## 知見（実装時）

- L-001: 保存成否を見てから UI 確定。
- L-002: velocity の省略と `null` クリアを区別。未完了での velocity キーは 400。
- L-044: 不正日付を黙って通さない。
- L-046 / L-047: ID・velocity の数値検証。
- L-062: activate / complete は状態付き確定操作（サーバが原子的に遷移）。
- L-038: メンバー置換と状態遷移はトランザクションで原子的に。
- L-456 / L-791: migrate 順はプロジェクト初期化の後。
- L-460: メンバー PUT は可視の完全集合。不可視はサーバ維持。
- L-542: 詳細の編集下書きを `providedIn: 'root'` に置かない。
- L-858: goal の Unicode スカラー上限を FE/BE で揃える。
- L-901: メンバー一覧・追加で ACL を漏らさない。
- L-934: クエリは `projectId`。
- L-930: 入力検証を DB より先に。

## 実装プランの分割（1 プラン内 Task）

- Task1a: DB migrate + モデル + sprint Repository/handler CRUD・activate/complete・members + 単体／統合テスト
- Task1b: soft delete / `projectId` 変更時の `sprint_items` 掃除、プロジェクト削除のスプリント 0 条件 + 回帰テスト
- Task2: FE models / Api / ルーティング / サイドバー
- Task3: 一覧・作成 UI
- Task4: 詳細（ゴール・期間・メンバー・activate/complete・velocity・canLeave）
- Task5: 全体検証（go test / ng test / 必要なら smoke）

## 直せない／残す制約

- ベロシティはポイント合計ではなく手動整数＋Done 件数提案（ストーリーポイント無しのため）。
- ボード上でのスプリント可視化は別カードへ送る。
- 完了スプリントのメンバー履歴を project 移動後も DB に残すことは初版対象外（移動時は全接合行削除）。
