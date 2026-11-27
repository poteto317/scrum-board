# アイテムテンプレート機能（#168）設計

## 背景

カード #168「テンプレート機能: よく使うアイテムの型を用意する」:

> よく使うアイテムの型（バグ報告、調査タスクなど）をテンプレートとして用意し、アイテム作成時に選べるようにする。
>
> - テンプレートごとに、タイトルの雛形と説明の雛形（見出しや記入欄）を持つ
> - アイテム作成時にテンプレートを選ぶと、雛形が入った状態で作成される
> - 初期テンプレートとして「バグ報告」「調査タスク」を用意する
> - テンプレートの追加・編集・削除ができる

既存の「コマンドテンプレート」はコピー用のコマンド文字列（グローバル・管理者 CRUD）であり、本機能とは別物。アイテム本文の雛形は現状ない。

## 決めたこと

ユーザー確認で推奨案を採用（2026-11-27）。

### スコープ

| 項目 | 決定 |
|--|--|
| 単位 | **プロジェクト単位**（`project_id`）。他プロジェクトへは見えない |
| フィールド | `name`（表示名）、`titleTemplate`、`descriptionTemplate`、`position` |
| 適用 | ボード／バックログの「アイテムを追加」ダイアログでセレクト。選択で title / description を雛形で**上書き**。送信前に編集可。「（テンプレートなし）」で空に戻せる |
| CRUD UI | 同じ作成ダイアログ内に「テンプレート管理」を展開（一覧・追加・編集・削除）。専用ルートは作らない |
| 権限 | 一覧・適用: 認証済み。作成・更新・削除: **管理者**（`requireAdmin`、コマンドテンプレに合わせる） |
| 初期 seed | **GET 一覧の応答前**に、その `project_id` の件数が **0** なら「バグ報告」「調査タスク」を挿入。既に 1 件以上あれば追加しない（手動全削除後の再 seed は許容）。並行 GET での二重挿入を防ぐため、件数確認〜挿入は **同一トランザクション**で `SELECT COUNT` → 0 なら INSERT 2 件（コミット後に一覧返却） |
| 削除 | 確認のうえ**物理削除**。作成済みアイテムは独立（テンプレ参照は持たない） |
| create API | 変更しない。クライアントが埋めた title/description を通常 `POST /api/items` へ送る |
| 多重送信 | 作成ダイアログの**アイテム追加とテンプレ CRUD は同一の `saving`（または同等の相互ブロック）**を共有し、片方の通信中はもう一方も開始しない（L-653）。別フラグで独立させると連打穴になる |

### 初期テンプレート本文

表中の `\n` は **実改行 1 文字**を表す（JSON/Go の文字列リテラルでは `"\\n"` ではなく実際の改行、または Go raw string / FE テンプレートリテラルで改行を書く）。

| name | titleTemplate | descriptionTemplate（Markdown 見出し） |
|--|--|--|
| バグ報告 | `[バグ] `（接頭辞の直後に半角スペース 1） | `## 再現手順` + 空行 + `1. ` + 空行 + `## 期待する結果` + 空行×2 + `## 実際の結果` + 空行×2 + `## 環境` + 空行 + `- ` |
| 調査タスク | `[調査] `（接頭辞の直後に半角スペース 1） | `## 調査目的` + 空行×2 + `## 分かっていること` + 空行×2 + `## 調べること` + 空行 + `- [ ] ` + 空行 + `## 結論・次のアクション` + 空行 |

接頭辞直後の空白は意図的（利用者が続きを打つ）。上限はアイテムと同じ（titleTemplate 1〜200、descriptionTemplate 0〜10000、name 1〜60）。

### データモデル

テーブル `item_templates`（起動時 `CREATE TABLE IF NOT EXISTS`）:

- `id` BIGINT PK AI
- `project_id` BIGINT NOT NULL（projects 参照。INDEX）
- `name` VARCHAR(60) NOT NULL
- `title_template` VARCHAR(200) NOT NULL
- `description_template` TEXT NOT NULL（上限 10000 はアプリで検証）
- `position` INT NOT NULL DEFAULT 0
- `created_at` / `updated_at` DATETIME(6)

同一プロジェクト内の `name` 一意は **必須にしない**（UX で案内する程度。衝突時も作成可）。

### API

`?projectId=` 必須（L-934）。省略・不正は 400。存在しない project は 404。未認証は既存 API と同じく **401**。管理者以外の書込は **403**。

| Method | Path | 権限 | 挙動 |
|--|--|--|--|
| GET | `/api/item-templates?projectId=` | 認証 | 一覧（`position` ASC, `id` ASC）。**応答前に seed**（0 件なら初期2件）。seed TX 失敗は **500** 等で返し、空 `templates` を 200 で返さない（L-002） |
| POST | `/api/item-templates?projectId=` | 管理者 | 作成。`position` はサーバが末尾（max+1）を付与（表示順の安定化。DnD UI は #191）。**body の `position` は無視** |
| PATCH | `/api/item-templates/{id}?projectId=` | 管理者 | 部分更新。他プロジェクトの id は 404 |
| DELETE | `/api/item-templates/{id}?projectId=` | 管理者 | 物理削除。他プロジェクトは 404。成功は **204**（本文なし） |

**POST body（必須）:** `{ "name", "titleTemplate", "descriptionTemplate" }`（いずれも string。`descriptionTemplate` は空文字可）。未知キーは 400（L-044）。

**PATCH body:** 上記 3 キーの任意サブセット。未知キーは 400（L-044）。空オブジェクトは 400。`position` / `projectId` / `id` の変更は受け付けない（送ったら 400）。

**一覧・POST・PATCH の JSON 形:**

- GET: `{ "templates": [ Template, ... ] }`
- POST: **201** + 作成した `Template` 単体
- PATCH: **200** + 更新後の `Template` 単体

`Template` = `{ "id", "projectId", "name", "titleTemplate", "descriptionTemplate", "position" }`（camelCase）

OpenAPI（`docs/openapi.yaml`）を同期更新する。

### UI

- 作成フォーム先頭付近に `<select>`「テンプレート」: 「（テンプレートなし）」＋一覧の `name`。
- 選択変更で `title` / `description` を即時セット（既存入力があっても上書き。確認ダイアログは出さない）。
- 「テンプレート管理」トグル（管理者のみ表示）: 一覧・追加フォーム・行ごとの編集／削除（削除は `confirm`）。管理フォームの name / titleTemplate / descriptionTemplate にボード既存と同型の **`textLimit(60/200/10000)`**（または同等 Validators）を付ける（L-858）。
- 一覧 GET 失敗は空扱いにせずエラー表示（L-002）。読込中は「まだありません」を出さない。
- **ボードとバックログ**の作成ダイアログの両方に同等 UI。

### テスト（受け入れに直結）

- seed: 空プロジェクトで GET → 2 件（name/titleTemplate/descriptionTemplate が初期表と一致）。既に 1 件あるプロジェクトでは増えない。並行 EnsureSeeds でも 2 件のまま。seed TX 失敗注入 → 5xx（空 `templates` の 200 にしない）。
- CRUD: 管理者のみ POST/PATCH/DELETE。非管理者は 403。未認証は 401。存在しない `projectId` は 404。
- スコープ: 別 `projectId` の id は 404。一覧は自プロジェクトのみ。
- バリデーション: 空 name、title 201 文字、description 10001 文字、未知キー、PATCH 空 `{}`、PATCH の `position`/`id`/`projectId`、POST の `position`（無視で成功でもよいが反映されない）— 不正は 400（L-044・L-858）。
- 受入4: アイテム作成後にテンプレ削除しても、そのアイテムの title/description は変わらない（API 再 GET で確認）。
- FE: セレクト変更でフォーム値が雛形になる／「なし」で空。管理 UI は admin のみ。一覧失敗で loadError（L-002）。**board と backlog それぞれ**でセレクト配線をテスト固定（L-060）。`saving` 中はテンプレ CRUD とアイテム追加が相互に開始できない（L-653／受入5）。

## 受け入れ条件

1. プロジェクトごとにテンプレートを追加・編集・削除できる（管理者）。
2. ボード／バックログのアイテム作成でテンプレートを選ぶと、タイトルと説明に雛形が入る。
3. テンプレートが 0 件のプロジェクトで一覧 GET すると、「バグ報告」「調査タスク」が用意された状態で返る。
4. テンプレート削除後も、既に作ったアイテムの本文は変わらない。
5. 作成ダイアログでアイテム追加・テンプレ CRUD 中は連打で二重送信しない。

## 範囲外（後続 Todo）

- #190 変数置換（`{{...}}`）
- #191 並び替え DnD
- #192 AI 作成経路への適用
- #193 `POST /api/items` の `templateId`

## 知見（手順 4）

- **L-002** 一覧失敗を空成功にしない（読込中／エラー／空を分離）
- **L-044** 未知・不正入力を黙ってフォールバックしない（projectId・文字数）
- **L-048** 既存コマンドテンプレ／アイテム上限・admin ガードに合わせる
- **L-056** localStorage は使わない（サーバ永続）
- **L-060** 作成ダイアログへのセレクト配線をテストで固定
- **L-653** 作成・CRUD の多重送信防止（saving ガード）
- **L-858** FE/BE の文字数上限を揃える
- **L-901** 副経路も同じ project スコープ／admin を付ける
- **L-934** `projectId` クエリ名を使う

## アプローチ比較（採用: A）

| | A プロジェクト単位 + 作成ダイアログ CRUD | B グローバル（コマンドテンプレ同様） | C 専用設定ページ |
|--|--|--|--|
| プロジェクト差 | チームごとに型を変えられる | 全プロジェクト共有 | A と同じだが導線が遠い |
| 実装量 | 中（project_id + seed） | 少 | 多（ルート追加） |

**採用 A。**
