# プロジェクト機能（アイテム #19）

## 背景

カード要件: プロジェクト機能を作る。プロジェクトごとにバックログ／かんばんの表示を分ける。現状はワークスペース全体で1つのボード・バックログしかなく、複数の仕事の束を同時に見ると混ざる。

## 決めたこと（推奨案を採用）

AskUserQuestion ツールが利用できなかったため、以下の推奨案を採用して設計を確定する。

| 事項 | 採用 |
|------|------|
| 役割 | プロジェクトは **表示・操作の仕切り**。列（ステータス）・番号・認証はワークスペース共通のまま |
| 所属 | 各アイテムは **ちょうど1つの** `projectId` を持つ（マルチ所属なし） |
| 既存データ | マイグレーションでプロジェクト「メイン」を1件作り、全既存アイテムをそこに所属させる（ID／createdAt は上書きしない） |
| アクティブ | いま見ているプロジェクトは `board_settings.active_project_id` に永続（リロード・別端末で共有） |
| 解決規則 | 無効・欠落の `active_project_id` は **名称に依存せず**、存在するプロジェクトを `position` 昇順・同点は `id` 昇順の先頭へ解決して GET 応答に載せる。読取では DB を直さない |
| 取得 | `GET /api/board`・`GET /api/backlog` は **解決後のアクティブ**に属するアイテムだけ返す（サーバ側フィルタ） |
| 並び替え | 列内 order は当該プロジェクト×列ごとの完全集合、バックログ order は当該プロジェクト全 ID の完全集合（他プロジェクトを消さない） |
| 列・設定 | 列・`cardLayout`・モバイル列・リストフィルタは **プロジェクト非依存**（グローバル） |
| UI切替 | ヘッダーの「マイワークスペース」付近にプロジェクト `<select>`。作成・名称変更を同付近から。空プロジェクトの削除（残2件以上）はクラッター防止のため含める |
| 新規カード | 作成時は解決後アクティブに所属（POST で `projectId` 省略可・指定可） |
| 移動 | 詳細画面でプロジェクト変更可（PATCH `projectId`）。マイグレーション後に既存カードを別プロジェクトへ移す手段として **必須**（表示分離だけでは既存が「メイン」に固定される） |
| 深いリンク | `/items/{number}` はプロジェクト非依存で詳細を開ける。**アクティブの自動切替はしない**（本イテレーション対象外。戻ったボードは直前のアクティブのまま） |
| 番号 | `item_number` は従来どおりワークスペース全体で一意（プロジェクト内で振り直さない） |

## 目的と受け入れ条件

1. プロジェクトを作成・名称変更でき、一覧できる。削除できるのは **アイテムが0件**かつ **他に1件以上プロジェクトが残る**ときだけ。最後の1件の削除、およびアイテムが1件でもあるプロジェクトの削除は 409。
2. ボードとバックログは、解決後アクティブに属するアイテムだけを表示する。他プロジェクトのカードは DOM／一覧に出ない。
3. プロジェクト切替でアクティブがサーバに保存され、リロード後も同じプロジェクトが選ばれる。無効・欠落 ID のとき GET の `settings.activeProjectId` は **position → id 昇順の先頭プロジェクト**へフォールバックする（名称「メイン」には依存しない）。読取だけでは DB を直さない。ユーザーが選んで PATCH 成功したときだけ DB を更新・治癒する。
4. 新規カードは解決後アクティブに入る。詳細から別プロジェクトへ移せる（既存カードを「メイン」以外へ移す手段）。
5. 列内 DnD・バックログ DnD・キーボード並べ替えは、表示中プロジェクトのカードだけで完結し、他プロジェクトの `position` / `backlogPosition` を壊さない（L-460）。リストフィルタ適用中の DnD／インデックス操作は **現行のリストフィルタ実装と同じ制約**を維持する（フィルタ後配列を全件として保存しない。L-460 / L-472）。
6. リストフィルタ・件数・ライブ再取得・モバイル1列は、解決後アクティブの部分集合の上で現行どおり動く。ボードとバックログの両方で、プロジェクト切替の busy 中はライブ再取得を適用しない。
7. 既存データはすべてマイグレーションで作った最初のプロジェクト（表示名「メイン」）に残り、番号・履歴・PR・関連は切れない（L-456）。フォールバック規則自体は名称に依存しない。

## データモデル

### `projects`

| 列 | 型 | 備考 |
|----|-----|------|
| id | BIGINT PK AI | 一度振ったら再利用しない（L-455） |
| name | VARCHAR(80) | trim 後 1〜80、空白のみ不可。同名可（識別は id） |
| position | INT | セレクト表示順。新規は末尾 |
| created_at / updated_at | DATETIME(3) | |

### `items.project_id`

- `BIGINT NOT NULL`、`FOREIGN KEY (project_id) REFERENCES projects(id)`（ON DELETE RESTRICT）
- マイグレーション手順（既存 DB）:
  1. `projects` 作成
  2. 表示名「メイン」を1件 INSERT（既存アイテムの id/createdAt は触らない）
  3. `items` に NULL 可の `project_id` 追加 → 全行をその id で UPDATE → NOT NULL + FK
- 新規 `database/init` も同じ形（シードで「メイン」＋既存シードカードがあれば紐付け）

### `board_settings`

- 新キー `active_project_id`（値は十進文字列）。JSON: `activeProjectId`（number）
- 部分 PATCH（既存の `cardLayout` / `mobileBoardColumnId` と同型）。触ったキーだけ書く（L-841）。未知 `setting_key` は保持（L-459）
- GET 応答の `settings` に解決済み `activeProjectId` を含める（無効時は上記フォールバック。DB は読取で書き換えない）

### 解決後アクティブ（用語）

以降「解決後アクティブ」とは、DB の `active_project_id` が存在するプロジェクトを指すときはその id、さもなくば `position` 昇順・同点 `id` 昇順の先頭プロジェクトの id。プロジェクトが0件のときは 0（通常はマイグレーション後は起きない）。**Board/Backlog のフィルタ、Create の省略時所属、Reorder の集合検証はすべてこの解決後 id を使う。**

## API

### プロジェクト

- `GET /api/projects` → `{ projects: Project[] }`（`position`, `id` 昇順）
- `POST /api/projects` `{ name }` → 201 Project（末尾 position）
- `PATCH /api/projects/{id}` `{ name }` → Project
- `DELETE /api/projects/{id}` → 204。次のいずれかで 409: アイテムが1件以上 / 残プロジェクトがこの1件だけ

### ボード設定（activeProjectId）

- 読取: `GET /api/board` の `settings` に含める（専用 GET は無い）
- 書込: 既存 `PATCH /api/board/settings` を拡張。パッチ DTO はポインタ（`*cardLayout`, `*mobileBoardColumnId`, `*activeProjectId`）。**少なくとも1キー必須**。省略キーは変更しない。`activeProjectId` のみの PATCH は layout／モバイル列を変えず、`items` の position 再割当を起こさない
- 存在しない `activeProjectId`・0 以下は 400。未知トップレベルフィールドは 400
- 成功応答: 常に現在の解決済み settings 全既知キー（`cardLayout`, `mobileBoardColumnId`, `activeProjectId`）を返す（変更しなかったキーも落とさない。L-459）
- マージ基点は DB 生値（L-841）。応答だけ解決済みを載せる

### ボード／バックログ／並び替え

- `GET /api/board`: `items` は解決後アクティブに一致するものだけ。`columns`・`settings` は従来どおり（settings に解決済み `activeProjectId` 追加）
- `GET /api/backlog`: 同上フィルタ。順序は当該プロジェクト内の `backlogPosition`, `id`
- `PUT /api/items/order`: 既存どおり **列ごと**に、その列に属する（かつ解決後アクティブの）アイテム ID の完全集合を新しい順で送る。他プロジェクトの ID を含めてはならない。サーバはアクティブ外のカードを更新しない／集合不一致は既存どおり 400（`ErrItemOrderMismatch` 系）
- `PUT /api/backlog/order`: 解決後アクティブの **全アイテム ID** の完全集合。他プロジェクトは対象外
- `POST /api/items`: `projectId` 省略時は解決後アクティブ。指定時は存在する id 必須。不正は 400
- `PATCH /api/items/{id}`: `projectId` 変更可。**移動先**では当該プロジェクト×列の `position` 末尾、および当該プロジェクトの `backlogPosition` 末尾へ付与。**移動元**の `position` / `backlogPosition` の穴は **詰めない**（`DeleteItem` と同様、欠番のまま。並びの表示は ORDER BY position,id で安定）
- 単体 GET（id / by-number）・status / assignee / history / command-templates: プロジェクト非依存（どのプロジェクトからでも開ける）

### Board JSON 拡張（例）

```json
{
  "columns": [],
  "items": [],
  "settings": {
    "cardLayout": "pack",
    "mobileBoardColumnId": 1,
    "activeProjectId": 1
  }
}
```

FE は未知 settings キーを捨てない（L-459）。

## クライアント挙動

- **ヘッダー**: プロジェクト `<select>`（option=name, value=id）。隣に「追加」「名称変更」。削除は確認付きで、アイテム0件かつ残2件以上のときだけ有効
- **CRUD（作成・改名・削除）**: 成功応答を見てから一覧を確定。失敗時は成功扱いせずエラー表示、ローカル一覧をサーバと食い違わせない（L-001）
- **切替（ボード・バックログ共通）**:
  1. 共有の busy（例: `projectSwitching` / 既存 `settingsSaving` を拡張）を **先に** true（L-842）
  2. 楽観的にセレクト表示を更新
  3. `PATCH /api/board/settings` `{ activeProjectId }`
  4. 成功後、表示中ルートの board または backlog を再取得し、**再取得完了まで busy を維持**（PATCH 直後に poll が旧アクティブの GET を適用しない。L-040）
  5. 失敗時はセレクトを戻しエラー、busy 解除
- ライブ poll（ボード・バックログ）: 上記 busy 中は `apply` しない
- ボード／バックログの件数・フィルタ・DnD は API が返した部分集合だけで動く（クライアントで他プロジェクトを隠す二重管理はしない）
- **詳細のプロジェクト変更**:
  1. `PATCH /api/items/{id}` `{ projectId }` を先に行う
  2. 成功後、解決後アクティブ ≠ 移動先なら `PATCH /api/board/settings` `{ activeProjectId: 移動先 }`
  3. 1 成功・2 失敗: アイテムは移動済み。エラーを出し、セレクト／再試行でアクティブを合わせられるようにする（中途半端を成功扱いにしない。L-001）。自動リトライの無限ループはしない
- `/items/n` 直開き: アイテムを取得して詳細を表示するだけ。所属プロジェクトへアクティブを自動切替しない

## 実装プランの分割（目安）

1. Backend: projects テーブル／migrate／CRUD／items.project_id／Board・Backlog・Reorder・Create のスコープ
2. Backend: activeProjectId settings（部分 PATCH・解決・シード）
3. FE: models／api／ヘッダー CRUD・切替 busy（board+backlog）／再取得
4. FE: 詳細のプロジェクト変更（二段 PATCH の部分失敗扱い）
5. 全体検証（go test / ng test / 必要なら smoke）

## 対象外

- プロジェクトごとの列・権限・メンバー・別 DB
- 1カードの複数プロジェクト所属
- プロジェクト横断の「すべて表示」ビュー（将来可）
- プロジェクト単位の cardLayout / モバイル列 / リストフィルタ
- アーカイブやソフトデリート
- 深いリンク／詳細オープン時のアクティブ自動切替

## 知見（実装時）

- L-001: 設定・プロジェクト CRUD・二段 PATCH の成否を見てから確定
- L-037 / L-040 / L-842: 切替の busy を楽観更新より先に。PATCH 成功後の再取得完了まで busy 維持。ボードとバックログの両方
- L-455 / L-456: プロジェクト ID・既存アイテム ID / createdAt をマイグレーションで振り直さない
- L-459: settings 未知キー保持。部分 PATCH で他キーを落とさない
- L-460 / L-472: 並び替えはプロジェクト部分集合をサーバ契約にし、リストフィルタ後配列を全件扱いしない（現行フィルタ DnD 制約を踏襲）
- L-841: activeProjectId の PATCH マージ基点は DB 生値

## 直せない／残す制約

- 列と番号はワークスペース共通（プロジェクトでステータス定義を分けない）
- 同名プロジェクトを許可（識別は id）
- 「すべて表示」と深いリンク時の自動切替は本イテレーションに含めない
- マイグレーションで作る最初のプロジェクトの表示名は「メイン」だが、実行時フォールバックは名称検索しない
- 詳細移動の二段目（settings）失敗時はアイテムだけ先に移る（手動でアクティブを合わせる）
