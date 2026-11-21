# コメント機能設計（アイテム #62）

## 背景

各アイテム（詳細ページ）に、Notion のページコメントに近い「書き込み・閲覧」の場が欲しい。

カード要件:

- 各アイテム（ページ）にコメントできる機能を用意する
- Notion と似たようなイメージ

現状: comment 系のテーブル・API・UI は無い。ワークスペースは Basic Auth 共有でユーザー個別アカウントは無い。詳細ページ下部に変更履歴（`app-item-history`）がある。

## 決めたこと

| 事項 | 採用 |
|------|------|
| 表示場所 | **詳細ページ本文の下**（履歴の**上**）。右サイドパネルは初版対象外（1A） |
| スレッド | **フラットな時系列のみ**。返信の入れ子は初版対象外（2A） |
| 投稿者 | **任意の表示名**（自由テキスト）。trim 後空なら UI は「（無名）」。必須ではない（3A） |
| 編集・削除 | **誰でも編集・削除可**（共有認証で本人識別が弱いため）（4A） |
| ボード表示 | **詳細のみ**。カードに件数バッジは出さない（5A） |
| 永続化 | 専用テーブル **`item_comments`**（items 行への列埋め込みではない） |
| 並び | **古い順（`created_at` ASC, `id` ASC）**。新しい投稿は末尾 |
| 本文 | プレーンテキスト。詳細の説明と同様に画面では Markdown 描画しない。最大 **4000** Unicode 文字（**trim 後**）。制御文字は禁止だが **改行（`\n`/`\r`）は許可**（textarea 複数行） |
| 表示名長さ | assignee と同様 **最大 60** Unicode 文字（**trim 後**）。制御文字禁止。空白のみは `""` |
| 履歴（item_history） | コメントの追加・編集・削除は **item 履歴に載せない**（コメント自身が記録） |
| Live refresh | 詳細の live refresh はコメント一覧を自動では書き換えない（投稿・編集・削除のローカル操作と競合しやすいため）。明示の再読込は初版でボタン不要（ページ再入場／ルート再読込で十分） |
| MCP | スコープ外。HTTP API があれば後から使える |

推奨案を採用した事項: 1A〜5A すべて（ユーザー指示「推奨で」）。

## 目的と受け入れ条件

1. アイテム詳細に「コメント」節がある。**一覧 GET 成功かつ 0 件**なら空状態文言、1 件以上なら時系列リスト。**GET 失敗は空成功にしない**（エラー表示。直前に成功していればその一覧を保持してよい。L-002）。
2. 新規投稿: 表示名（任意）＋本文（必須・trim 後 1〜4000 文字）。**サーバ成功応答の 1 件を一覧末尾へ append**し、入力はクリアする（楽観追加はしない）。失敗時は成功扱いにせずエラー表示、一覧は増やさない（L-001）。
3. 各コメントに編集・削除がある。編集はインラインまたは同等の UI。保存中は当該操作 disabled。失敗時は表示を戻す（L-001）。
4. 削除は確認ダイアログのあと実行。失敗時は一覧から消えない。
5. コメント API は **`/api/items/by-number/{number}/comments…` のみ**（内部 ID ルートは初版対象外。既存 by-number 慣習）。
6. アイテム削除時はコメントも CASCADE で消える。
7. ボードカード・バックログ行・ソリューションページにコメント UI／件数は出さない（L-015: 表示しないこととデータ欠落を混同しない）。
8. 既存の title／description／お気に入り／履歴の挙動は変えない。
9. 初期スキーマと既存 DB の両方でテーブルが用意される（起動時 `CREATE TABLE IF NOT EXISTS`）。
10. ルートの number / project が変わったらコメントを再 GET する。**世代（または同等）で古い GET／POST／PATCH／DELETE 成功応答を捨てる**（切替中に別アイテムの一覧へ混入させない。L-037 / L-040 / L-865）。

## 用語

- **コメント**: あるアイテムに紐づく 1 件の書き込み（本文＋任意の表示名＋作成／更新時刻）。
- **コメント一覧**: 詳細ページ上のフラットな時系列リスト。
- **表示名**: 投稿時に付ける任意ラベル。アカウント ID ではない。

## 永続化

```sql
CREATE TABLE IF NOT EXISTS item_comments (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  item_id BIGINT NOT NULL,
  author VARCHAR(60) NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_comment_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  INDEX comments_item_created (item_id, created_at, id)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

- `database/init/001_schema.sql` に同定義を追加。
- 起動時 `InitializeComments`（`CREATE TABLE IF NOT EXISTS`、idempotent）。favorite 列追加と同系統で `main.go` / `mysql_test.go` から呼ぶ。
- API JSON（camelCase）:
  - `id` (number)
  - `itemId` (number)
  - `author` (string, 常に string。欠落正規化は `""`)
  - `body` (string)
  - `createdAt` / `updatedAt` (RFC3339 UTC)

## API

既存の by-number 慣習に合わせる（公開番号で操作し、内部 ID 解決はサーバ側）。

| 方法 | パス | 説明 |
|------|------|------|
| GET | `/api/items/by-number/{number}/comments` | 一覧（古い順）。任意 query `projectId` |
| POST | `/api/items/by-number/{number}/comments` | 作成。body: `{ "author"?: string, "body": string }` |
| PATCH | `/api/items/by-number/{number}/comments/{id}` | 部分更新。`author` / `body` のいずれか必須。省略＝触らない |
| DELETE | `/api/items/by-number/{number}/comments/{id}` | 削除。204 |

補足:

- `projectId` query は既存 item by-number と同じ解決規則。
- POST / PATCH とも `author`・`body` は受信後に **trim** してから判定・保存する。
- POST: `body` 必須。trim 後空・4000 超・制御文字は 400。`author` 省略／欠落／空白のみは `""`。60 超・制御文字は 400。
- PATCH: `author` / `body` の少なくとも一方がキーとして必須（空オブジェクトは 400）。未知キー・`null`・型不正は 400（L-002 / L-454）。
  - `body` を送る場合: POST と同じ（trim 後 1〜4000・制御文字なし）。空文字・空白のみは 400（クリア不可）。
  - `author` を送る場合: trim 後 60 以下・制御文字なし。空白のみは `""` に正規化（表示名クリア可）。
- DELETE / PATCH でコメントが別アイテムに属する場合は 404（番号と id の食い違いを推測で直さない）。
- 一覧 GET のアイテム無しは 404。
- 内部 ID 版（`/api/items/{id}/comments`）は初版で**作らない**。

## クライアント

### 配置

- `item-detail` のメインカラム内、プロパティ／本文ブロックの後、`app-item-history` の**直前**に `<app-item-comments>`（standalone）を置く。
- 見出し「コメント」。空なら「まだコメントはありません。」

### コンポーネント責務

- `ItemComments`（コンテナ）: ルートの number / project で一覧 GET。投稿フォーム。子へ edit/delete を委譲。`loadGeneration`（単調増加）で stale 応答を捨てる（item-history と同型）。
- 一覧行: 表示名（空→「（無名）」）、相対または絶対時刻（既存 history の `date` パイプに合わせる）、本文（`pre-wrap`）、編集／削除。
- 投稿・保存は **即時 HTTP**（フォーム autosave の `fields` / `sideFields` に載せない。L-453 / L-790）。投稿の一覧反映は **成功応答後の append のみ**（楽観追加しない）。成功適用前にも世代／現行 number+project を照合する。
- `busy` / live refresh: コメント保存中でも title autosave の busy とは独立。詳細の live refresh はコメント DOM を触らない（コメント state はコンポーネント内 signal）。
- ルート切替・destroy で in-flight をキャンセルした場合: **遅延成功を一覧へ適用しない**（busy 解除のみ。楽観していないので revert 対象の一覧行は無い）。

### UX 詳細

- 投稿中: 送信ボタン disabled。成功でフォーム clear + 応答 1 件を末尾 append。
- 編集: 行内で本文・表示名を編集可能。キャンセルで元に戻す。保存失敗時は編集前の表示へ戻す（L-001）。編集中の楽観上書きはしない（保存成功で行を応答で置換）。
- 削除: `window.confirm`（初版）。キャンセルなら一覧不変。成功後に行を除去。失敗時は行を残す。

## テスト方針

- Backend: migrate idempotent、CRUD 成功、バリデーション 400、他アイテムの comment id は 404、item DELETE で CASCADE。
- Frontend: 空表示、投稿成功で末尾追加、失敗で一覧不変、編集失敗ロールバック、削除キャンセルで残る。
- ボードカードにコメント UI／件数が無いこと: **初版で board カード構造テストに 1 ケース追加する**（必須）。

## 知見（実装時）

| ID | 扱い |
|----|------|
| L-001 | 失敗を成功扱いしない。楽観更新は revert |
| L-002 | author/body 欠落・null の正規化と 400 |
| L-015 | ボードに出さない ≠ PATCH で落とす |
| L-037 / L-040 | live refresh がコメント state を踏み潰さない |
| L-453 / L-790 | autosave fields/sideFields に載せない |
| L-454 | PATCH で undefined マージしない |
| L-867 | 楽観一覧はしない（cancel 時 revert 対象なし）。遅延成功破棄は L-037 |
| L-040 | number/projectId 変更で再 GET＋世代ガード |

## 非目標（初版）

- スレッド返信、メンション、リアクション、既読
- リアルタイム同期・SSE
- ボード／バックログ上の件数
- Markdown 描画、添付ファイル
- コメントの item_history 記録
- per-user 権限

## 実装タスク分割メモ

1. Backend: テーブル migrate + CRUD API + テスト + `docs/api.md`
2. Frontend: 型・Api メソッド・`ItemComments` コンポーネント + 詳細への組み込み
3. 検証: kanban go test / frontend ng test
