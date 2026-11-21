# プロジェクト並び替え・管理ページ（アイテム #77）

## 背景

カード要件:

- プロジェクトのページをハンバーガーメニューに移動する。
- そちらで追加や編集、削除もできるようにして、並び替えもできるようにする。
- プロジェクトの切り替えは、ヘッダーにあるままでOK。

現状:

- プロジェクトの追加・名称変更・削除はヘッダーハンバーガーのカタログ項目 `project_add` / `project_rename` / `project_delete`（board・backlog）から実行する。対象は主に**現在のアクティブプロジェクト**（追加は新規作成＋切替）。
- `/projects` ルートは無い。`/users`・`/trash` と同様の専用ページは未整備。
- `projects` テーブルに `position` があり、`ListProjects` は `ORDER BY position, id`。作成時は `max(position)+1`。**一括並び替え API は無い**（列は `PUT /api/columns/order` がある）。
- ヘッダーの `<select>` は `ProjectSession.projects()`（position 順）を表示し、切替は `switchTo`。

## 決めたこと

| 事項 | 採用 |
|------|------|
| ハンバーガーからの入り口 | **1A** 「プロジェクト」メニュー項目で `/projects` へ遷移。既存の追加／名称変更／削除はメニューから外す |
| 並び替え操作 | **2A** リスト上の DnD（CDK）＋キーボード上下 |
| ページ上の編集 UI | **3A** 行ごとに名称変更・削除。追加はページ内モーダル |
| 並び替えの永続化 | **4A** `PUT /api/projects/order`。ヘッダー select も同じ position 順 |

ユーザー回答: 推奨で一括採用（1A・2A・3A・4A）。

### 検討したが採らなかった案

- **メニューに個別アクションを残す（1B）**: 管理の入り口が二重になり、カードの「ページへ移動」と矛盾しやすい。
- **ページを作らずメニュー拡張のみ（1C）**: 並び替え UI の置き場が無く、要件のページ移動を満たさない。
- **上下ボタンのみ（2B）／数値入力（2C）**: 列・バックログの DnD 慣習と揃えない。
- **localStorage のみ（4C）**: 共有ワークスペースで並びが端末ごとに割れ、カードの永続並び替え意図に合わない。
- **個別 PATCH position（4B）**: 一括 ID 集合検証（列と同型）より競合・欠落に弱い。

## 目的と受け入れ条件

1. ハンバーガー（board / backlog / itemDetail）に **「プロジェクト」**（カタログ ID `open_projects`）があり、押すと `/projects` へ遷移する。`open_users` / `open_trash` と同様、プロジェクト切替中（`switching`）は disabled。
2. カタログから **`project_add` / `project_rename` / `project_delete` を削除**し、**`open_projects` を追加**する。変更は **フロント（`header-menu.ts`）とバックエンド（`header_menu.go` 等の ID 集合）と `docs/api.md` のカタログ記述を同期**する。PUT は BE カタログ外 ID を 400 にするため、FE だけ更新してはいけない。DB / prefs に残った旧 `project_*` は GET 正規化で未知 ID として除去する既存規則に従う。ヘッダー直下の個別プロジェクト CRUD ボタンは無い前提を維持する。
3. `/projects` は認証必須。ページではプロジェクト一覧を **position 昇順（同値は id）** で表示し、次ができる:
   - **追加**: `ProjectsPage` がページ内モーダルと、現行 `App` の `addProject` / `submitProject` / `switchToCreatedProject` 相当（`ProjectSession.create` → 成功後 `switchTo` → `endMutating`。`switchTo` が `EMPTY` のときの `complete` 処理含む）を担う。create 失敗・switch 失敗・switch `EMPTY` のいずれも成功扱いにしない（L-001）。`App` 側の追加モーダルと当該ハンドラ・関連 spec は削除し、同等の検証は `ProjectsPage` 向けに移す。
   - **名称変更**: 行の操作で現行ヘッダーと同じ **`window.prompt('新しいプロジェクト名', current.name)`** → `ProjectSession.rename` → `PATCH /api/projects/{id}`。空・キャンセル・80 文字超は既存どおり（`PROJECT_NAME_REQUIRED`）。行内モーダルやインライン編集は採らない。
   - **削除**: 行ごと。UI は **プロジェクトが 2 件以上**のときのみ有効（既存 `canDelete` 相当）。確認は現行と同じ **`window.confirm`**。開いた直後のキーリピートで確認を飛ばさない（L-408。既存ヘッダー削除と同粒度で可）。サーバがアイテムあり等で 409 のときは一覧から消さずエラー表示（L-001）。アクティブ削除時の active 再解決は既存 `ProjectSession.delete` に合わせる。
   - **並び替え**: DnD およびキーボード上下で全件リストを並べ替え、`PUT /api/projects/order` に **全プロジェクト ID の順列**を送る。ページは楽観的に行順を変え、**`ProjectSession.reorder` は成功時のみ `projects` を応答で更新**する。失敗時（HTTP エラー）は session を再取得せず、ページがドロップ前の順序へ UI を戻しエラーを出す（L-001）。`reorder` が `EMPTY`（`switching` / `mutating` 中・不正 ID 列）のときは **API を呼ばず、成功表示もしない**。すでに楽観更新していた場合はドロップ前へ戻すか、そもそも楽観更新前にガードして no-op とする（確定扱いしない）。**フィルタ済み部分配列だけを送らない**（L-460。初版にフィルタ無し）。キーボード上下は `event.repeat` のとき入れ替えも API も行わない（L-408）。
4. ヘッダーのプロジェクト切替セレクトは残す。並び替え成功後、`ProjectSession.projects` が新しい position 順になり、セレクトの表示順も一致する。
5. `/projects` でもヘッダー・サイドバーは既存どおり。`pageKind` は `null`（`/users`・`/trash` と同様）で、ハンバーガーの pageKind アクションは空、設定セレクト初期値は `board`。

## 非目標

- プロジェクト切替 UI をページ側へ移すこと、またはヘッダー select の廃止。
- プロジェクト単位の ACL・権限モデルの新設（既存の認証・ロール前提を変えない。並び替え API は他プロジェクト CRUD と同じくログイン済みで利用可能）。
- サイドバーへの「プロジェクト」ナビ追加（ハンバーガー経由のみ）。
- 並び替えの Undo、複数選択一括削除、アーカイブ。

## API

### `PUT /api/projects/order`

リクエスト:

```json
{ "projectIds": [3, 1, 2] }
```

- `projectIds` は **現存する全プロジェクト ID の順列**（重複なし・欠落なし・未知なし）。列の `columnIds` と同型の検証。
- 成功: `200` `{ "projects": [ ... ] }`（更新後の position 込み、`ORDER BY position, id`）。
- 集合不一致: 列と同様の mismatch エラー（既存の列ハンドラと揃えた status / message 体系）。
- 空配列・null・非配列・非正整数: 400。
- 認可: 既存の `PATCH/DELETE /api/projects` と同じく認証済みユーザー（副経路の権限漏れを作らない。L-901。現状プロジェクト CRUD に特別 ACL が無いなら同等でよい）。

実装方針（列に倣う）:

1. トランザクション開始。
2. `SELECT ... FROM projects ORDER BY id FOR UPDATE` で全行ロック。
3. ID 集合一致を検証。不一致ならロールバックして mismatch。
4. 配列順で `position = 0..n-1` を UPDATE。
5. 並べ替え後の一覧を返してコミット。

既存 `PATCH /api/projects/{id}`（name のみ）・`POST`・`DELETE`・`GET` は変更しない（position を PATCH で個別更新する経路は追加しない）。

## フロントエンド

### ルーティング

- `path: 'projects'` → `ProjectsPage`（`users` と同様 lazy + `authGuard`）。
- `resolvePageKind`: `/projects` は `null`（アクション空）。

### カタログ（FE + BE + docs 同期）

| ID | ラベル | pageKinds |
|----|--------|-----------|
| `open_projects` | プロジェクト | board, backlog, itemDetail |

- **削除（FE・BE 双方）**: `project_add`, `project_rename`, `project_delete`。`projectMenuActionDisabled` および `HeaderMenu` の当該 `case`、`app` からの `(addProject)` / `(renameProject)` / `(deleteProject)` 出力バインディングと、メニュー専用だった `App` 側ハンドラ配線を削除する。CRUD UI は **`ProjectsPage` に移す**（追加モーダル含む）。`ProjectSession` の create/rename/delete 自体は残しページから呼ぶ。
- `HeaderMenu` の `open_projects` は `router.navigate(['/projects'])`（`open_users` と同型）。
- `docs/api.md` のカタログ ID 一覧を更新する。

### `ProjectSession` / `Api`

- `Api.reorderProjects(projectIds: number[])` → `PUT /api/projects/order`。
- `ProjectSession.reorder(projectIds: number[]): Observable<Project[]>`:
  - `switching` / `mutating` 中、または不正な ID 列のときは既存 `create` と同様 **`EMPTY`**（エラー Observable にしない）。
  - 実行時は `mutating` を立て、成功時に `projects` を応答（または `sortProjects`）で更新して `mutating` をクリアし、完了する。
  - 失敗時は `mutating` をクリアし、`error` をセットして **再 throw**（`projects` は成功時のみ更新。再 load しない）。ページ側が楽観 UI をドロップ前へ戻す（L-001）。
- 追加・改名・削除は `ProjectsPage` から既存 `ProjectSession` メソッドを利用する。

### サイドバー

- `/projects` でもサイドバーは表示（`/users` と同様）。「プロジェクト」をサイドナビに足さない。

## 知見（手順 4）で意識する ID

- **L-001**: 並び替え・削除・追加の成否を UI / session が正しく扱う。失敗後に一覧から消さない／順序を確定扱いしない。
- **L-044**: order の不正 JSON・不正 ID は 400。フロントも不正入力を黙って空扱いにしない。
- **L-408**: 削除確認・キーボード並び替えでキーリピートを無視。
- **L-460**: 全件 ID を送る。表示フィルタで部分配列だけ persist しない（初版にフィルタを付けない）。
- **L-476**: reorder は `ProjectSession` / `Api` 経由。コンポーネントから HTTP 直叩きを増やさない。
- **L-515**: 「プロジェクト」メニューラベルの可視テキストをテストで固定。
- **L-901**: `PUT /api/projects/order` を認証付きルートとして他 project API と同列に登録。

## テスト方針（要約）

- Backend: reorder 成功・集合不一致・空/重複・並行（列の integration に倣う簡易で可）、handler 400/200。
- Frontend:
  - カタログに `open_projects`（可視ラベル「プロジェクト」。L-515）があり旧 `project_*` が無いこと。`/projects` 遷移。
  - reorder API 呼び出しと HTTP 失敗時の楽観 UI ロールバック。`EMPTY` / busy 時に成功扱いにしない。
  - キーボード上下で `event.repeat` 時に reorder しない（コンポーネントテスト可）。
  - 削除ガード（1 件のみ時）。
  - 追加: 旧 `app.spec` の create→switchTo→`endMutating` / switch 失敗 / switch `EMPTY` 相当を `ProjectsPage`（または移管先）へ移して維持。

## 決めたこと（再掲・自動承認用）

設計レビュー通過後は本仕様を承認済みとし、実装プランへ進む。推奨案未回答分はすべて採用済み。
