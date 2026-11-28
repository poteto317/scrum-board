# ラベル（タグ）機能（#169）設計

## 背景

カード #169「ラベル（タグ）機能: 種類や領域で分類し横断的に絞り込む」:

> アイテムにラベル（タグ）を付けて、種類や領域で分類できるようにし、ラベルで横断的に絞り込めるようにする。
>
> - ラベルの作成・名前変更・色設定・削除ができる
> - アイテムに複数のラベルを付けたり外したりできる
> - ボードと検索で、ラベルを条件にして絞り込める
> - 既存のアイテムにもあとからラベルを付けられる

現状のスクラムかんばんにはステータス（列）・プロジェクト・担当者・お気に入り・期限はあるが、アイテムの種類（例: バグ・改善）や領域（例: フロントエンド・認証）を複数軸で表すラベル（タグ）は存在しない。

## 決めたこと

ユーザー確認済み（2026-11-27、4設問とも推奨案を採用）。

| 項目 | 決定 |
|--|--|
| スコープ | **ワークスペース共通**（全プロジェクトで同一のラベル定義を共有。`board_columns`・`workspace_list_filter` と同単位）。別プロジェクトへのアイテム移動でもラベルは外れず、AI 横断検索でも同一ラベルで絞り込める |
| ラベル CRUD の権限 | **ログイン済み（有効なセッション／Basic 認証）ユーザー全員**が一覧取得・作成・名前変更・色変更・削除を行える（`projects`・`board_columns` と同じ。`requireAdmin` は掛けない） |
| アイテムへの付け外し権限 | 対象アイテムが未削除・未アーカイブかつ呼び出しユーザーが **`CanEdit`** を満たすこと（`requireActiveEdit`、L-901） |
| 複数ラベル選択時の絞り込み | **AND 条件**（選択したすべてのラベルが付いているアイテムに絞り込む。0 件選択時はラベル絞り込みなし） |
| 「ボードと検索」の対象範囲 | 1. **ボード・バックログ共通の一覧フィルタバー**（`app-list-filter-bar` + `GET/PUT /api/list-filter` 永続化）<br>2. **AI チャットの検索ツール `search_items`**（単一プロジェクト検索および `crossProjectSearch: true` のプロジェクト横断検索の両方） |
| ラベル管理 UI の導線 | 一覧フィルタバー（ボード・バックログ）およびアイテム詳細画面のラベル欄から「ラベル管理」モーダルを開いて作成・名前変更・色設定・削除できる |
| アイテムへの付与導線 | **既存アイテム**: アイテム詳細画面のプロパティ欄で複数ラベルを付け外しできる（即時 `PATCH /api/items/{id}` 保存）<br>**新規アイテム**: ボード・バックログの「アイテムを追加」モーダルでも作成時にラベルを選択できる（`POST /api/items` の任意 `labelIds`） |

## データモデルと正規化

### 1. ラベル名・同一視キー・色の正規化規則（L-845・L-858）

上限・定数:

- `MaxWorkspaceLabels = 200`（ワークスペース全体に作成できるラベル総数の上限。AI システムプロンプトおよび一覧応答の肥大化を防ぐ）
- `MaxLabelNameRunes = 40`（Unicode スカラー数。FE `LABEL_NAME_MAX = 40` と一致）
- `MaxItemLabelInputLen = 64`（`POST /api/items`・`PATCH /api/items/{id}` の `labelIds` 生配列の最大要素数、重複除去前）
- `MaxItemLabels = 20`（1 アイテムに付与できる重複除去後のラベル数上限。FE `MAX_ITEM_LABELS = 20` と一致）
- `MaxListFilterLabelIDs = 64`（`PUT /api/list-filter` の `labelIds` 生配列の最大要素数。`maxListFilterStatusIDs` と同値）
- `MaxSearchLabelNames = 20`（AI `search_items` の `labels` 配列要素数の上限）

**表示名 `NormalizeLabelName(raw string) (string, bool)`（バックエンド）:**

1. UTF-8 として不正な文字列は拒否する（`!utf8.ValidString(raw)`）。
2. Unicode 制御文字（`unicode.IsControl(r)`）、書式制御文字（`unicode.In(r, unicode.Cf)`：ZWSP・ZWJ・BOM・双方向制御文字を含む）、異体字セレクタ（`U+FE00..U+FE0F`, `U+E0100..U+E01EF`）を 1 文字でも含む場合は拒否する。
3. 連続する空白類（`unicode.IsSpace`）を半角スペース 1 文字にまとめ、前後の空白を除去する（`strings.Join(strings.Fields(raw), " ")`）。
4. 結果が空文字、または `utf8.RuneCountInString(value) > MaxLabelNameRunes`（40）の場合は拒否する。
5. `LabelNameKey(value) == ""` となる入力は拒否する。

**重複判定・検索照合キー `LabelNameKey(raw string) string`（バックエンド専用、L-845）:**

ラベル名の重複判定（`POST /api/labels`, `PATCH /api/labels/{id}`）と AI `search_items` のラベル名照合はすべてバックエンドで行う。フロントエンドは整数 `label.id` のみで選択・絞り込み・更新を行うため、JS 側に別実装の正規化キーを持たない（Go と JS のケース変換・空白定義差による層間不一致を構造的に排除する）。

満たすべき不変条件（`backend/internal/kanban/label_test.go` のプロパティテストで検証）:
- 冪等性: 任意の文字列 `x` に対し `LabelNameKey(LabelNameKey(x)) == LabelNameKey(x)`
- 正準・互換等価: NFC / NFD / 全角英数・半角カナが NFKC 正規形と同一キーになる
- 大文字小文字非依存: Unicode Case Folding（`golang.org/x/text/cases` の `cases.Fold()`）により、`İ`/`i`、`Σ`/`σ`/`ς`、`ß`/`SS`、NFKC 分解後に大文字が現れる文字を含め同一キーになる
- 空白正規化: 前後空白および連続空白の違いでキーが変わらない（NFKC が空白を生む `U+FFE3` 等を含む）
- 入力正規化との往復一致: `NormalizeLabelName(x)` が `(n, true)` を返す任意の `x` に対し、`LabelNameKey(n) == LabelNameKey(x)` かつ `LabelNameKey(n) != ""`
- 経路一致: MySQL の `labels.name_key` 列、`memoryRepo` の重複検査、AI `search_items` のラベル名照合がすべて単一の `LabelNameKey` 関数を通る

変換手順（順序固定）:
1. 空白以外の制御文字（`!unicode.IsSpace(r) && unicode.IsControl(r)`）、書式制御文字（`unicode.In(r, unicode.Cf)`）、異体字セレクタ（`U+FE00..U+FE0F`, `U+E0100..U+E01EF`）を除去する（検索クエリで未検証文字列が渡された場合も合成を阻害しないため正規化より前に置く）。
2. `norm.NFKC.String` を適用する。
3. `cases.Fold().String`（Unicode Case Folding）を適用する。
4. 再度 `norm.NFKC.String` を適用し、さらに `cases.Fold().String` → `norm.NFKC.String` を通す（`U+0390` / `U+1FB3` 等の再合成・再展開でも完全に不動点へ収束させる）。
5. `strings.Join(strings.Fields(s), " ")` で前後の `unicode.IsSpace` を除去し、連続空白を ASCII 半角スペース 1 文字にまとめる。

**色 `NormalizeLabelColor(raw string) (string, bool)`:**

1. 前後の空白を `strings.TrimSpace` で除去する。
2. `#` + 6 桁の ASCII 16 進数字（`^#[0-9a-fA-F]{6}$`）のみ受理し、小文字 `#rrggbb` に正規化して返す（3 桁短縮 `#abc`・色名 `red`・`rgb(...)` は拒否し 400 とする）。

フロントエンドのプリセットパレット（9 色、すべて `#rrggbb` 小文字）:
`#ef4444`（赤）, `#f97316`（橙）, `#eab308`（黄）, `#22c55e`（緑）, `#14b8a6`（青緑）, `#3b82f6`（青）, `#6366f1`（藍）, `#a855f7`（紫）, `#64748b`（灰）。加えて `<input type="color">` で任意の `#rrggbb` を選択可能とする。新規作成フォームの初期色は `#3b82f6` とする。

### 2. DB スキーマとマイグレーション（L-862・L-959・L-1213）

`database/init/001_schema.sql` と `backend/internal/kanban/label_migrate.go`（定数 `labelsDDL`, `itemLabelsDDL`）の両方に同一の定義を置き、DDL 一致テストで固定する（L-1213）。

`name_key` の列長は、40 スカラーの NFKC 最大展開倍率（18 倍: `40 * 18 = 720` 文字、`utf8mb4` で最大 `2880 <= 3072` バイト）を収容できるよう `VARCHAR(720)` とする（MySQL 1406 桁あふれ防止）。

```sql
CREATE TABLE IF NOT EXISTS labels (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(40) NOT NULL,
 name_key VARCHAR(720) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
 color CHAR(7) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_labels_name_key (name_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS item_labels (
 item_id BIGINT NOT NULL,
 label_id BIGINT NOT NULL,
 PRIMARY KEY (item_id, label_id),
 INDEX idx_item_labels_label_item (label_id, item_id),
 CONSTRAINT fk_item_labels_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
 CONSTRAINT fk_item_labels_label FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

- **一意性と件数上限の原子保証（L-862・L-959）**:
  - `CreateLabel` はトランザクション内で `SELECT id FROM labels ORDER BY id FOR UPDATE`（または `board_columns` ロック不要の `labels` 全行ロック）を取り、件数が `MaxWorkspaceLabels`（200）以上なら `ErrLabelLimit`（HTTP **409** `{"message": "ラベルは200件までです。"}`）で拒否してから `INSERT` する。
  - `uq_labels_name_key` の一意制約違反（MySQL 1062、`uq_labels_name_key` を含むエラー）は `dbError` で `ErrLabelDuplicate` に変換し HTTP **409** を返す。
- **削除時の連動**:
  - ラベル削除（`DELETE FROM labels WHERE id=?`）時は `fk_item_labels_label` の `ON DELETE CASCADE` により `item_labels` から自動除去される。
  - アイテム物理削除（`HardDeleteItem` / ゴミ箱パージ）時は `fk_item_labels_item` の `ON DELETE CASCADE` により `item_labels` から自動除去される。
  - アイテム論理削除（ゴミ箱移動）およびアーカイブ時は、`prUrls` と同様に `item_labels` を保持し、復元時に元のラベルが維持される。
  - `labels` はワークスペース共通（`project_id` を持たない）ため、`DeleteProject` でラベルマスタは消さない。
- **一覧フィルタ永続化テーブル `workspace_list_filter` の拡張**:
  - `workspace_list_filter` は現状どおり `001_schema.sql` には置かず、`backend/internal/kanban/list_filter_migrate.go` の `workspaceListFilterDDL` と `InitializeListFilter` で一元管理する。
  - `workspaceListFilterDDL` に `board_label_ids JSON NOT NULL`, `backlog_label_ids JSON NOT NULL` の 2 列を追加する。
  - `InitializeListFilter` の `GET_LOCK` 内で以下の順序を冪等に実行する:
    1. `board_query_text` も `query_text` も無ければ 6 列入りの `workspaceListFilterDDL` で `CREATE TABLE IF NOT EXISTS` する。
    2. `query_text` が残っていれば既存の `migrateLegacyListFilter` を実行する。
    3. `board_label_ids` または `backlog_label_ids` 列が欠けていれば、`ALTER TABLE workspace_list_filter ADD COLUMN ... JSON NULL`（既存列エラーは無視）→ `UPDATE workspace_list_filter SET board_label_ids = COALESCE(board_label_ids, CAST('[]' AS JSON)), backlog_label_ids = COALESCE(backlog_label_ids, CAST('[]' AS JSON))` → `ALTER TABLE workspace_list_filter MODIFY board_label_ids JSON NOT NULL` / `MODIFY backlog_label_ids JSON NOT NULL` を実行する。
    4. `ensureListFilterRow` で `id = 1` が未挿入なら `board_label_ids`, `backlog_label_ids` に `CAST('[]' AS JSON)` を指定して 6 列すべてを `INSERT` する。
- **起動順とテスト DB 削除順（L-1213）**:
  - `backend/cmd/server/main.go` では `InitializeRelatedItems` の直後（`InitializeHistory` より前）、`backend/internal/kanban/mysql_test.go` でも `InitializeRelatedItems` の直後（`prepareHistory` より前）で `InitializeLabels` を呼ぶ。
  - `mysql_test.go` の `DROP TABLE IF EXISTS` リストには、`items` より**前**に `"item_labels"`, `"labels"` の順（子→親）で追加する。個別 `boot()` を組むマイグレーション結合テスト（`card_position_pr_links_migration_integration_test.go`）でも `mysqlTestDB` 時点でテーブルが存在する。

## HTTP API 契約

すべての変更を `docs/openapi.yaml` に同期更新し、`python3 scripts/check-openapi-routes.py` を通す（L-974）。

### 1. ラベル CRUD API

認証: セッション Cookie または Basic 認証必須（未認証は **401**）。有効なログインユーザー全員が全メソッドを実行可。

`Label` JSON 形状:
```json
{ "id": 1, "name": "バグ", "color": "#ef4444" }
```

| Method | Path | 成功 | エラー | 挙動 |
|--|--|--|--|--|
| GET | `/api/labels` | 200 `{ "labels": [Label, ...] }` | 401, 500 | `id ASC` 順で全件返す（0 件時は `"labels": []`） |
| POST | `/api/labels` | 201 `Label` | 400, 401, 409, 500 | `{ "name": string, "color": string }` 必須。未知キー・型不正・空文字・40 文字超・制御/不可視文字混入・不正色は 400（L-044）。`name_key` 重複は **409** `{"message": "同じ名前のラベルがすでにあります。"}`、上限 200 件到達時は **409** `{"message": "ラベルは200件までです。"}` |
| PATCH | `/api/labels/{id}` | 200 `Label` | 400, 401, 404, 409, 500 | `{ "name"?: string, "color"?: string }`。不正パス `id`・未知キー・空 `{}`・`null` 値・不正値は 400。未存在 `id` は 404 `{"message": "ラベルが見つかりません。"}`。他ラベルと `name_key` が衝突する場合は 409（自分自身の同キー更新は成功） |
| DELETE | `/api/labels/{id}` | 204（本文なし） | 400, 401, 404, 500 | 不正パス `id` は 400。物理削除（`item_labels` は CASCADE 削除）。未存在 `id` は 404 |

### 2. アイテム API（`Item` 応答・作成・更新）

- **全 `Item` 応答への付与（L-901）**:
  - `Item` 構造体に `Labels []Label`（`json:"labels"`）を追加する。0 件時は必ず空スライス `[]` とし `null` にしない。並び順は `labels.id ASC` とする。
  - `loadCard`（詳細 GET・番号指定 GET・作成・更新・ゴミ箱復元・アーカイブ解除）、`loadBoard`（`GET /api/board`）、`listBacklogCards`（`GET /api/backlog`, `PUT /api/backlog/order`）、`listOrderedCards`（`PUT /api/items/order`, `PATCH /api/board/settings` の `items` 応答）、`ListArchivedItems`（`GET /api/archive`）、`ListLivingItems`、`searchItems` のすべてで `attachLabels` / `attachLabel` を通す。
  - 一覧応答では既存の `filterBoardItems`（`CanView` 検査）を通したアイテムのみ返るため、閲覧不可アイテムに付いたラベルは漏洩しない（L-901）。
- **`labelIds` デコード・検証（`POST /api/items` と `PATCH /api/items/{id}` 共通）**:
  - 両ハンドラともリクエスト構造体で `LabelIDs json.RawMessage`（`json:"labelIds"`）として受け取り、共通関数 `decodeItemLabelIDs(w, raw)` で検証する。
  - `POST /api/items`: 省略時（`len(raw) == 0`）は空スライス `[]int64{}`。指定時は下記規則に従う。
  - `PATCH /api/items/{id}`: 省略時（`len(raw) == 0`）は `nil`（変更なし）。`labelIds` のみの単独 PATCH も有効な変更として受け付ける（空 `{}` 拒否条件に追加）。
  - 指定時の検証規則（違反はすべて **400**）:
    1. `string(raw) == "null"` または JSON 配列でない場合は 400。
    2. 生配列長が `MaxItemLabelInputLen`（64）を超える場合は 400。
    3. 各要素が正の整数（`> 0`、小数・NaN・0 以下・文字列等は不可）でない場合は 400。
    4. 初出順を保って重複除去した結果の要素数が `MaxItemLabels`（20）を超える場合は 400。
    5. DB 保存時に存在しないラベル ID が 1 件でも含まれる場合は `ErrUnknownLabel` → **400** `{"message": "ラベルを確認してください。"}`。
- **`PATCH /api/items/{id}` の認可・状態検査（L-901・L-048）**:
  - 未認証は **401**、未存在または論理削除済みアイテムは `GetItem` で **404**、既存の `requireActiveEdit` どおりログイン済みユーザーが `!CanView` なら **403**（`msgViewForbidden`）、`CanView && !CanEdit` なら **403**（`msgEditForbidden`）、アーカイブ済みアイテムなら **409**（`{"message": "アーカイブを解除してから変更してください。"}`）を返す。
- **トランザクションとロック・履歴（L-959）**:
  - `CreateItem` 内: `len(in.LabelIDs) > 0` のときのみ、同一 TX 内で `SELECT id FROM labels WHERE id IN (...) FOR SHARE` により全 ID の存在を確認し、`INSERT INTO item_labels(item_id, label_id)` を実行する（`len == 0` のときは `IN ()` 構文エラーを避けるためクエリを発行しない）。
  - `UpdateItem` 内:
    1. `p.LabelIDs != nil` の場合も `p.PRURLs != nil` と同じく先に `lockColumnRows` を取り、複数カードの空範囲 `DELETE` + `INSERT` による InnoDB ギャップロックデッドロックを防ぐ。
    2. 対象アイテム行を `FOR UPDATE` でロックする（L-959）。
    3. `p.LabelIDs != nil` のとき、`len(*p.LabelIDs) > 0` なら `SELECT id FROM labels WHERE id IN (...) FOR SHARE` で全 ID の存在を確認し（不足は `ErrUnknownLabel` でロールバック）、`DELETE FROM item_labels WHERE item_id=?` の後、`len(*p.LabelIDs) > 0` なら `INSERT INTO item_labels(item_id, label_id)` を実行し、`items.updated_at` を更新する。
    4. `item_history`（`history.go`）の `historyValues` / `appendHistory` の対象フィールド末尾に `"labels"` を追加する。文字列表現は `labelsHistoryJSON(c.Labels)` とし、`prURLsJSON` と同様にラベル名スライスの JSON 配列文字列（0 件は `"[]"`、複数件は `["A, B","C"]`）とする（カンマを含むラベル名でも衝突しない）。
    5. `history_migration.go` の `baseline`（既存 11 フィールド）および `history_import.go`（外部履歴インポート）は既存互換のため変更しない。

### 3. 一覧フィルタ永続化 API（`GET /api/list-filter`, `PUT /api/list-filter`）

- `ListFilter` 構造体を `{ "query": string, "statusIds": int64[], "labelIds": int64[] }` に拡張する。
- `GET /api/list-filter`:
  - `board_columns` の既知 ID 集合と `labels` の既知 ID 集合を読み込み、保存済みの `statusIds`・`labelIds` から削除済み ID・重複 ID を除去して返す（L-475）。
  - `parseStoredListFilterOK(query, statusJSON, labelJSON)` は `statusJSON` と `labelJSON` の両方が空バイト列（`[]` 扱い）または非 `nil` の `[]int64` JSON 配列であることを要求し、どちらか一方でも破損／`null` JSON の場合は `ok = false` として該当ビュー全体（`Board` または `Backlog`）を既存の `statusIds` 破損時と同じく `defaults.Board` / `defaults.Backlog` にフォールバックする。
- `PUT /api/list-filter`:
  - 各ビュー（`board`, `backlog`）で `labelIds` は省略可（省略時は `[]` として扱うことで既存クライアント／テスト互換を保つ）。指定された場合、`null`・非配列・0 以下または非整数・`MaxListFilterLabelIDs`（64 件）超は **400** とする（L-044）。
  - 保存時に `labels` テーブルに現存する ID のみに正規化して永続化し、正規化後の値を 200 で返す。

### 4. AI チャット（システムプロンプト・`focusItem`・`search_items`・`get_item`）

- **システムプロンプトと開いているアイテム文脈（`ai_chat_context.go` / `ai_project_chat_context.go`）**:
  - `loadProjectChatInput` で `h.repo.ListLabels(ctx)` によりワークスペースのラベル一覧（最大 200 件）を 1 回取得する（失敗時はエラー返却し空ラベル扱いしない＝L-002）。
  - `projectChatSystemPrefix` の対象項目説明に「ラベル」を、非信頼データ宣言に「ラベルの名前」を追加する。
  - `buildProjectChatSystem` に `ラベル（labels に使える名前）:` 節を追加し、`columns` と同じく各ラベル名を `promptLabel(l.Name)` に通したうえで `fencedBlock(strings.Join(labelNames, "\n"))` で囲んで出力する。
  - アイテム詳細 AI チャットとプロジェクト AI チャットの `focusItem` が共有する `writeItemPromptContext`（`ai_chat_context.go`）で、`len(item.Labels) > 0` のときに `ラベル:\n` + `fencedBlock(strings.Join(promptLabelNames, "\n"))` を出力する（`len == 0` のときは既存のコメント 0 件と同様に節を省略し、既存プロンプト回帰を壊さない）。
- **`ai_project_tools.go` のツール説明文とスキーマ**:
  - `search_items` の `searchDesc`（通常時・横断時とも）の出力フィールド説明に `labels` を追加する。
  - `get_item` の `getDesc`（通常時・横断時とも）の説明文にラベルを返す旨を追加する。
  - `search_items` の入力スキーマに任意プロパティ `"labels": { "type": "array", "items": { "type": "string" }, "description": "ラベルの名前（配列。複数指定時はすべて付いているもの＝AND で絞り込む。省略または空配列なら絞り込まない）。" }` を追加する。
- **`search_items` の入力検証・名前解決・優先順・予算切り詰め**:
  - ラベル絞り込みなしは `labels` の省略または空配列 `[]` のみとする。
  - `labels` が配列でない、要素が文字列でない、生要素数が `MaxSearchLabelNames`（20）を超える、または要素に `LabelNameKey(s) == ""`（空文字 `""`・空白のみ `"   "`・不可視文字のみ `"\u200B"`）が含まれる場合は、黙って無視せず `toolErrInvalidInput` を返す（L-044）。
  - 各要素ごとに `k := LabelNameKey(s)` を計算し、ワークスペースの `labels` 一覧に一致しない要素が 1 つでもあれば `plan.UnknownLabel = true` とする。一致した場合は初出順で重複除去して `plan.Search.LabelIDs` に追加する。
  - 未知指定時の応答と優先順:
    1. `plan.UnknownStatus` が真なら、既存どおり `unknownStatusResult(e.columns)` を返す（`UnknownStatus` 優先）。
    2. 次に `plan.UnknownLabel` が真なら、`unknownLabelResult(e.labels)` を返す。`searchItemsOut` のフィールドは `AvailableLabels *[]string`（`json:"availableLabels,omitempty"`）とし、`unknownLabelResult` ではラベル 0 件のときも非 `nil` ポインタ（`&[]string{}`）を設定して `{"total":0,"truncated":false,"items":[],"availableLabels":[]}` を出力する。
    3. `fitSearchItems`（`ai_project_tool_search_items.go`）で `len(out.Items) == 0` でも文字数が `limit` を超える場合、`out.AvailableLabels != nil && len(*out.AvailableLabels) > 0`（または `len(out.AvailableStatuses) > 0`）の間は末尾から 1 件ずつ削って `out.Truncated = true` とし、予算切れエラーに化けさせない。
  - SQL 絞り込み（`projectItemSearchSQL`）: `s.LabelIDs` の各 `lid` について `AND EXISTS (SELECT 1 FROM item_labels il WHERE il.item_id=c.id AND il.label_id=?)` を付与する。単一プロジェクトでも `crossProjectSearch: true` でも `itemSearchViewSQL`（`CanView`）が LIMIT 前に掛かる（L-901）。
- **ツール出力（`search_items` / `get_item`）**:
  - `searchItemOut` と `getItemOut` の両方に `Labels []string`（`json:"labels"`、ラベル名の配列、0 件は `[]`）を含める。`fitGetItemOut` の最小切り詰め段（`clip == 0`）では `PRURLs` と同様に `out.Labels = []string{}` に落とす。

## フロントエンド設計

### 1. ドメイン・正規化・状態管理・キャッシュ／ETag 同期

- **`frontend/src/app/label.ts`**:
  - `Label` 型（`{ id: number; name: string; color: string }`）、`LabelInput`、`LabelPatch`、定数 `LABEL_NAME_MAX = 40`, `MAX_ITEM_LABELS = 20`, `LABEL_COLOR_PRESETS`、正規化関数 `normalizeLabel`、`normalizeLabels`、`isValidLabelColor`、バッジ描画用スタイル計算 `labelBadgeVars(color)` を定義する。
- **`frontend/src/app/models.ts` / `board-data.ts` / `close-reason.ts` / `sprint-detail-helpers.ts` / `item-history.ts` / `history-link-value.ts`**:
  - `Item` に `labels?: Label[]`（既存 `viewAccess?: ...` と同じく生 fixture 互換を保ちつつ、`normalizeItem`・`memberAsCandidateItem`・`ItemDetail` 読込時の `normalizeLabels(card.labels)` で常に配列 `Label[]` へ正規化する、L-1046）、`ItemInput` / `ItemPatch` に `labelIds?: number[]` を追加する。
  - `normalizeItem` で `labels: normalizeLabels(raw.labels)`（欠落時は `[]`）を補完する（L-1046）。
  - `mergeCloseTransitionItem` でも `labels: normalizeLabels(updated.labels ?? local?.labels)` を保持する。
  - `ItemHistory.labels` マップに `labels: 'ラベル'` を追加し、`HistoryLinkValue` で `field === 'labels'` のときは JSON 文字列配列をパースして表示する（0 件は `<pre>（空欄）</pre>`、1 件以上は `<ul class="pr-history">` で各ラベル名を `<pre>{{ name }}</pre>` 表示）。
- **`frontend/src/app/project-board-cache.ts` と `frontend/src/app/labels-session.ts`（`@Injectable({ providedIn: 'root' })`）**:
  - `ProjectBoardCache` のクローン処理（`cloneList` / `cloneSnapshot`）で `labels` 配列と各 `Label` オブジェクトもディープコピーする。さらに `syncUpdatedLabel(label: Label): void` と `pruneDeletedLabel(labelId: number): void` を追加し、保持中の全プロジェクトの `boardSnapshots` と `backlogItems` 内の `item.labels` を即時更新・除去する。
  - `LabelsSession` は `labels = signal<Label[]>([])`, `loaded = signal(false)`, `loading = signal(false)`, `loadError = signal('')` を保持する（L-002：初回完了前は `loaded() === false` で空案内を出さず、再取得時は既存 `labels()` 表示を保ったまま裏で更新する）。
  - **他ユーザー／別タブ変更への追従（L-475）**:
    - `Board.ngOnInit()`・`Backlog.ngOnInit()`・`ItemDetail.ngOnInit()`・`<app-label-manager-dialog>` オープン時に `labelsSession.load()` を呼んで最新カタログを取得する。
    - さらに `Board` / `Backlog` / `ItemDetail` がサーバ（初回 GET・ポーリング等）からアイテムを受け取った際、`labelsSession.syncWithObservedItems(items)` を呼び、アイテム上の `labels` に未知の ID または名前・色の差分があれば（通信中でない限り）裏で `labelsSession.load()` を再実行してフィルタバーの選択肢と `knownLabelIds` を最新化する。
  - **ローカル変更時の画面・ETag・自由配置高さ同期**:
    - `LabelsSession.update` / `remove` 成功時は、`ProjectBoardCache`（および `remove` 時は `ListFilterSession.pruneDeletedLabel(id)`）を更新したうえで購読イベントを流す。
    - マウント中の `Board` は `data` 内の `item.labels` を更新し、**`boardEtags.clear()` で保持 ETag を破棄**（サーバ側 ABA 変更で 304 固着するのを防止）し、`scheduleCardHeightMeasure()` で自由配置モードのカード高さを再計測する。
    - マウント中の `Backlog` は `items` 内の `item.labels` を更新し、**`backlogEtag = ''` で保持 ETag を破棄**する。
    - マウント中の `ItemDetail`（`autosave.applyCatalogLabelUpdate` / `applyCatalogLabelDelete`）と `Archive`（`items`）も同様に表示中アイテムを更新する。
  - `AuthSession.clearSubject()`（ログアウト／ユーザー切替）で `labelsSession.clear()` を呼ぶ。

### 2. 一覧フィルタ（ボード・バックログ共通）

- **`frontend/src/app/list-filter.ts` / `list-filter-session.ts`**:
  - `ListFilter` を `{ query: string; statusIds: number[]; labelIds: number[] }` に拡張し、`emptyListFilter`（`labelIds: []`）、`cloneListFilter`（`labelIds: [...(f?.labelIds ?? [])]`）、`listFiltersEqual`（`labelIds` の長さと各要素一致も比較）をすべて更新する。
  - `appliedListFilter(draft, knownColumnIds, knownLabelIds: number[] | null = null)`:
    - `knownLabelIds === null`（`!labelsSession.loaded()` または `!!labelsSession.loadError()`）のときは、`draft.labelIds` の正整数フィルタ＋重複除去のみを行い、保存済みフィルタを誤って消さない（L-002）。
    - `knownLabelIds !== null`（ラベル一覧読込成功済み）のときは `knownLabelIds` に存在する ID のみに絞る（L-475）。
  - `listFilterActive(filter, knownColumnIds)`: `filter.labelIds.length > 0` のとき `true` を返す（フィルタ有効中はボード／バックログとも DnD 並び替えを一時停止する）。
  - `itemMatchesFilter(item, filter)`: 既存のテキスト検索・ステータス条件に加え、`filter.labelIds.length > 0` のとき `filter.labelIds.every((lid) => item.labels.some((l) => l.id === lid))`（**AND 条件**）で判定する。
  - `ListFilterSession` に `toggleLabel(view, labelId)` と `pruneDeletedLabel(labelId)`（`filters` と `confirmed` の両方から除去し、他の未保存変更が無ければ余分な PUT を送らない）を追加する。

### 3. コンポーネント構成・CSS 予算・モーダル契約（L-453・L-542・L-653・L-790・L-792・L-1067）

`board.css`・`backlog.css`・`item-detail.css` はすべて `angular.json` の `anyComponentStyle` 予算（warning 6 kB / error 8 kB）に近いため、**これら 3 ファイルへの CSS 追記はゼロ**とし、専用 `.css` を持つ standalone 子コンポーネントへ完全に分離する（`styles.css` への無スコープ追加もしない＝L-792）。各子コンポーネント CSS ではグローバルの `label`（`margin: 23px 0 10px`）・`input`（`width: 100%; padding: 12px`）が干渉しないよう、`label` / `input[type="checkbox"]` / `input[type="color"]` の幅・余白・パディングを明示リセットする。

1. **`<app-label-badges>`（`label-badges.ts` / `.css`）**:
   - `labels = input<Label[]>([])` を受け取り、色ドット付きピルを並べる純表示コンポーネント。`board.html`・`backlog.html`・`archive.html` で共用する。
2. **`<app-label-manager-dialog>`（`label-manager-dialog.ts` / `.html` / `.css`）**:
   - モーダル契約（L-1067・L-653）: `<dialog appModal class="modal-backdrop" aria-labelledby="label-manager-title" (cancel)="$event.preventDefault(); close()"><section class="modal" (click)="$event.stopPropagation()" (keydown.escape)="close()" tabindex="-1">...</section></dialog>` 構成とし、`saving()` 中は `close()` を no-op にして `Escape` によるネイティブ閉鎖不整合（親の `managingLabels` 残留）を防ぐ。
   - 新規作成フォーム（`textLimit(40, true)`、プリセット 9 色＋`<input type="color">`）と既存行のインライン編集・確認付き削除（`confirmFn` 注入可）を備える。読込中・エラー・0 件を分離し（L-002）、同期フラグ＋`saving` で全ボタンを排他ロックし（L-653）、編集ドラフトはモーダルコンポーネント寿命に閉じる（L-542）。
3. **`<app-list-filter-bar>` の拡張（`list-filter-bar.ts` / `.html` / `.css`）**:
   - ステータスチェック群と並べてラベルフィルタ用チェックピル群と「ラベル管理」ボタンを配置し、`<app-label-manager-dialog>` の開閉状態 `managingLabels` を親（`Board` / `Backlog`）へ伝えてモーダル表示中の自動リフレッシュと DnD 並び替えを抑止する。
4. **`<app-label-picker>` + `ItemLabels` サービス（`label-picker.ts` / `.html` / `.css`, `item-labels.ts`）**:
   - `<app-label-picker>` は選択済み `selectedIds = input<number[]>([])`、`disabled = input(false)`、変更出力 `toggleLabel = output<number>()`、管理起動 `openManager = output<void>()` を持つ共用 standalone コンポーネントとし、**`ItemDetail` プロパティ欄・`Board` 作成モーダル・`Backlog` 作成モーダルの 3 箇所すべてで共用**する（20 件選択済み時は未選択チップを `disabled` にし、解除のみ許可）。
   - **既存アイテム（`ItemDetail` + `ItemLabels`）**:
     - `ItemLabels` は `@Injectable()`（`providedIn` なし）として `ItemDetail` の `providers` に登録する（L-542）。同一コンポーネント内ルート切替（`/items/1` → `/items/2`）の `switchMap` 先頭で `itemLabels.reset()` と `managingLabels.set(false)` を必ず呼ぶ。
     - チェック操作時は楽観更新を行わず `PATCH /api/items/{id}` に `{ labelIds }` を送る（`takeUntil(this.changed$)`、同期フラグ＋`saving()` で連打防止＝L-653）。
     - **L-790 対応**: `ItemAssignee` と同じく、PATCH 開始時の無条件 `sideDirty` 設定は行わず、PATCH 成功時の `autosave.applyLabelsSave(updated)`（および `LabelsSession` 変更同期）の中で **`autosave.saving() === true`（フォーム flush 飛行中）のときだけ** `sideDirty.add('labels')` を立てる。これにより flush 外や PATCH 失敗後に古い `local.labels` が将来のサーバ更新を上書きする不具合を防ぐ。
     - `ItemDetail` の `busy()`（`itemLabels.saving()` と `managingLabels()` を含めてポーリングを停止）・`savingBusy()`・`canLeave()`・`beforeUnload()`・`remove()` に接続する。
   - **新規アイテム作成モーダル（`Board` / `Backlog`）**:
     - `<app-label-picker>` で選択した `selectedCreateLabelIds` signal（`openItem` 時に `[]` リセット、`saving()` 中は無効化）を `POST /api/items` の `labelIds` に渡す。

## 受け入れ条件

1. ラベルの作成・名前変更・色設定（`#rrggbb` プリセットおよびカラーピッカー）・削除ができる。同名（`LabelNameKey` 正規化後に同一）のラベルは 409 で拒否される。
2. 新規作成時および既存アイテムの詳細画面から、アイテムに複数のラベルを付けたり外したりできる（アイテム編集権限 `CanEdit` を強制、最大 20 件）。
3. ボード・バックログ・アーカイブの一覧上およびアイテム詳細上でアイテムのラベル（名前・色）が表示され、ラベルの名前変更・色変更・削除が既存アイテムの表示にも反映される。
4. ボードとバックログの一覧フィルタバーでラベルを条件（複数選択時は AND）にして絞り込め、リロード後も `workspace_list_filter` から復元される。ラベル削除時に選択中フィルタが隠し状態として残らない。
5. AI チャットの `search_items`（単一プロジェクトおよび `crossProjectSearch: true` のプロジェクト横断検索）でラベル名を指定して絞り込め、検索結果・`get_item`・開いているアイテム文脈にラベルが含まれる。

## 範囲外（今回やらない）

- ラベルのドラッグ＆ドロップによる表示順変更（一貫して `id ASC` 順）
- MCP サーバー（`mcp/`）への専用ラベル CRUD ツールの追加（既存 MCP ツールは `Item` JSON に `labels` が増えるのみで互換）
- AI チャットからの「ラベル変更の提案（`propose_*`）」ツール追加

## 関係する知見と対策一覧

- **L-001**: ラベル CRUD・アイテム `labelIds` PATCH の成否を確認してから UI 状態・キャッシュを更新し、失敗時はエラーを表示する
- **L-002**: ラベル一覧の `loading` / `loadError` / `0件` を分離する。AI チャットの `ListLabels` 失敗もエラー返却し空扱いしない。ラベル未読込中に `appliedListFilter` が保存済み `labelIds` を空に潰さない
- **L-044**: API および AI `search_items` の未知キー・`null`・空文字要素・型不正・上限超過・不正カラーコードを黙ってフォールバックせず拒否する
- **L-453 / L-790**: 詳細画面のラベル非楽観 PATCH は `autosave.saving()` 飛行中のみ `sideDirty.add('labels')` で保護し、かつ `ItemDetail.busy()` でポーリングを抑止する
- **L-475**: 削除されたラベル ID を `GetListFilter`・`PutListFilter`・`appliedListFilter`・`pruneDeletedLabel` で除去し、他ユーザー変更も `syncWithObservedItems` → `labelsSession.load()` で追従する
- **L-542**: `ItemLabels` やモーダル編集状態はコンポーネントスコープにし、詳細ルート切替時も `reset()` する。`LabelsSession` は `AuthSession.clearSubject()` でクリアする
- **L-653 / L-1067**: ラベル CRUD・詳細 PATCH・作成送信を同期ロック＋`saving` で排他し、`<dialog appModal>` の `(cancel)` でも `saving()` 中の `Escape` 閉鎖を防ぐ
- **L-792**: `board.css`・`backlog.css`・`item-detail.css` への CSS 追加をゼロにし、専用 CSS を持つ standalone 子コンポーネント（`<app-label-badges>`, `<app-label-picker>`, `<app-label-manager-dialog>`）に分離する
- **L-845**: `LabelNameKey` をバックエンド単一実装に統一し、冪等性・Case Folding・空白正規化の不変条件を `label_test.go` で検証する
- **L-858**: ラベル名上限（40 文字）を FE `textLimit(40, true)` と BE `utf8.RuneCountInString` で揃え、サロゲートペア境界をテストする
- **L-862 / L-959**: ラベル名重複を DB `UNIQUE KEY uq_labels_name_key`（`VARCHAR(720)`）で防ぎ、総数 200 件上限とアイテムへの付与（親 `FOR UPDATE` + `labels FOR SHARE`）を TX 内で検証する
- **L-901 / L-048**: アイテム全取得経路に `labels` を載せつつ `CanView` を通し、`PATCH /api/items/{id}` は既存 `requireActiveEdit`（401 / 403 / 404 / 409）と一致させる
- **L-974**: 追加・変更した全エンドポイントとエラー応答を `docs/openapi.yaml` に反映し `check-openapi-routes.py` を通す
- **L-1046**: `normalizeItem` で `labels: []` を既定補完し、既存テストの fixture を壊さない
- **L-1213**: `001_schema.sql` と `label_migrate.go` の DDL 一致テストを置き、`mysql_test.go` の `DROP TABLE` 一覧に外部キー順（`item_labels` → `labels` → `items`）で追加する
