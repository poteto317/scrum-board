# カード対応者ラベル

## 目的

かんばんの各カードが「いま誰（どの AI／人）が対応しているか」を、画面上のラベルとして一目で分かるようにする。エージェントは API／スキルから同じラベルを設定できる。

カード #35: 人ならテキストでもよいが、主に Cursor / Claude / Codex / Antigravity の 4 つをラベル登録し、コマンドやスキルで付けられるようにする。

## 受け入れ条件

- カードに対応者を 1 つ持てる（未設定可）
- プリセットラベル: `Cursor` / `Claude` / `Codex` / `Antigravity` を選択できる
- 人向けに、プリセット以外の短い自由テキストも入れられる
- ボードのカード上と詳細のプロパティに表示される（未設定時はボードでは非表示）
- `PATCH` で対応者を更新できる（エージェント向けに公開番号ベースの専用エンドポイントも用意）
- 変更はカード履歴に残る
- `task-start`（および README／API ガイド）からエージェントが設定できる手順がある

## 決めたこと

| 事項 | 採用 | 理由 |
| --- | --- | --- |
| 対応者の数 | カードあたり最大 1（単一） | カード文面は「どれ（誰）」の単数。複数同時は YAGNI |
| プリセット | 固定 4 種（Cursor / Claude / Codex / Antigravity）。管理 UI なし | カード指定の 4 つ。マスタ CRUD は不要 |
| 人間 | プリセット以外の自由テキスト（1〜60 Unicode 文字） | 「人ならテキストでよい」 |
| 正規化 | trim 後、プリセットと ASCII 大小無視で一致すれば正規化名で保存（例: `claude` → `Claude`）。一致しなければ自由テキストとして trim のみ。意図的に自由テキストへ逃がす「エスケープ」は用意しない | エージェントの表記ゆれを吸収。人間名が偶然プリセットと一致する場合もラベル扱い（明示ルール） |
| 未設定 | 空文字。ボードではチップ非表示 | 推奨 6A |
| 表示 | ボード各カード＋詳細プロパティ。バックログは対象外 | 推奨 3A |
| 詳細 UI | プリセットはチップ群（1 つ選択）。その下に自由テキスト入力。クリアボタン。即時 PATCH（ステータス変更と同型） | 「セレクトまたは」の曖昧さを排除 |
| UI 失敗時 | PATCH 失敗でエラーを表示し、表示中の対応者はサーバ成功値（または直前の成功値）へ戻す。入力欄の下書きは残してよい（L-001） | 失敗を成功扱いにしない |
| 作成 | `POST /api/cards` は任意で `assignee` を受け付ける。省略時は `""`。検証は PATCH と同じ | レスポンスに常に `assignee` を含める |
| API | Card JSON に `assignee`。既存 `PATCH /api/cards/{id}` に追加。加えて `PATCH /api/cards/by-number/{number}/assignee`（body `{"assignee":"Cursor"}`） | ステータス API と同型でエージェント向け（L-035） |
| 履歴 | 今後の差分イベントに `assignee` を含める。既存 baseline 行の遡及追加・バックフィルはしない | 推奨 5A。過去イベントは触らない |
| スキル | 本リポジトリ: README／`docs/api.md`／必要なら smoke。dev-flow-kit: `commands/task-start.md`（およびスキル）に `SCRUM_ASSIGNEE` または `--assignee` を追加する別 PR | カード「コマンドやスキル」。キット更新は本機能の完了条件に含める |
| DB | `cards.assignee VARCHAR(60) NOT NULL DEFAULT ''`。起動時マイグレーション＋ `001_schema.sql` 更新 | 既存カードは空のまま（L-456） |

## 方式

### データモデル

- `Card.Assignee string` → JSON `assignee`
- `CardPatch.Assignee *string` — 省略は変更なし、`""` はクリア、非空は検証後に保存
- プリセット定数（FE/BE 共通の意味）:

```text
Cursor | Claude | Codex | Antigravity
```

- 検証:
  - trim 後、空 → 未設定
  - プリセット（ASCII 大小無視）→ 正規化名で保存
  - それ以外 → 1〜60 Unicode 文字。超過・制御文字は 400

### マイグレーション

- `InitializeAssignee`: 列が無ければ `ALTER TABLE cards ADD COLUMN assignee VARCHAR(60) NOT NULL DEFAULT ''`
- 既存行は DEFAULT で空。`id` / `createdAt` は触らない（L-456）
- `main.go` の既存マイグレーション連鎖に追加
- 新規 DB は `001_schema.sql` に列を含める

### HTTP

1. 既存カード GET／board／backlog／create／update の Card JSON に `assignee` を含める
2. `PATCH /api/cards/{id}` が `assignee` を受け付ける（他フィールドと同様部分更新。L-454）
3. 新規 `PATCH /api/cards/by-number/{number}/assignee`  
   - body: `{"assignee":"Cursor"}` または `{"assignee":""}` でクリア  
   - 公開番号で解決（L-035）。応答は Card JSON  
   - 不正 number／不正 JSON／過長 → 400、未存在 → 404

### UI

- **詳細:** プロパティに「対応」行。プリセット 4 つはチップ群（押下で即時 PATCH）。自由テキスト用の入力＋適用／Enter で即時 PATCH。クリアで `assignee=""`。失敗時はエラー文言を出し、チップ選択は直前の成功値に戻す（L-001）
- **ボード:** カード上に小さなラベルチップ。プリセットは `data-assignee` 属性と CSS 変数で種別色（Cursor／Claude／Codex／Antigravity を互いに区別）。自由テキストは中立色。未設定は出さない
- **バックログ:** 今回は追加しない

### エージェント／スキル

- 本リポジトリ: README／`docs/api.md` に curl 例。`scripts/smoke.py` があれば assignee エンドポイントを 1 ケース追加（L-059）
- dev-flow-kit（別 PR）: `commands/task-start.md` と対応スキルに、環境変数 `SCRUM_ASSIGNEE` または引数 `--assignee <値>` を追加。値が無ければ status のみ（現状どおり）

### 履歴

- `historyValues` / `appendHistory` に `assignee` を追加（これ以降の create／update 差分のみ）
- 既存の baseline／過去イベントへの `assignee` バックフィルはしない
- 表示名は FE `labels.assignee` = 「対応」

## 対象外

- 複数アサイン、メンション、アバター画像、OAuth ユーザー連携
- プリセットのユーザー追加・削除 UI
- バックログ一覧へのチップ
- 自動で「今動いているエージェント」を推論する仕組み（明示指定のみ）

## エラーと境界

- 未知 JSON キーは既存どおり拒否
- `assignee: null` は拒否（クリアは `""`）
- 失敗時は既存フィールドを壊さない（L-001 / L-454）
- 並走 PATCH（title と assignee）は既存 UpdateCard の行ロック方針に従う。応答で他フィールドを巻き戻さない（L-781）

## 検証方針

- Go: 正規化（大小）、自由テキスト上限、クリア、同一値再 PATCH 成功、by-number 交差（number≠id）、履歴イベント、マイグレーションで既存行が空のまま、不正 JSON／未知キー／null／過長の 400、未存在 404
- FE: 詳細でプリセット・自由テキスト・クリア、失敗時エラーと表示の巻き戻し、ボードにチップ表示／未設定非表示、履歴ラベル「対応」
- 任意: MySQL 隔離または `scripts/smoke.py` で by-number assignee を 1 往復（L-059）
- 既存 board／detail／history／status テストが通ること

## 知見の反映

- L-035: エージェント API は公開番号ベース
- L-454: patch 省略とクリア（空文字）を区別。null は拒否
- L-456: マイグレーションで id／createdAt を作り直さない
- L-781: 部分更新応答で他フィールドを巻き戻さない
- L-001: API は成否を HTTP で返す。UI は失敗をバナー表示し成功値へ戻す
- L-059: 可能なら実 HTTP／DB の軽い確認をテスト計画に含める

## 設計時の推奨採用

ユーザー回答「推奨で進めて」により 1A〜6A を採用した。
