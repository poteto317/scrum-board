# お気に入り機能設計（アイテム #60）

## 背景

アイテムを素早く開き直したい。Notion のように、詳細の右上からお気に入りの追加／解除をトグルし、左サイドメニューのお気に入り一覧から辿れるようにする。

カード要件:

- 右上にお気に入りアイコンを用意し、クリックでお気に入りの追加／解除をトグルする
- お気に入りは左のサイドメニューで表示できる（Notion のように）

現状: グローバルトップバーのみで左サイドメニューは無い。お気に入り／star／bookmark の実装も無い。ワークスペースは Basic Auth 共有でユーザー個別アカウントは無い。

## 決めたこと

| 事項 | 採用 |
|------|------|
| 永続化 | アイテム列 **`favorite`（bool）**。未設定相当は `false`（1A） |
| ユーザー単位 | **ワークスペース共有**（アカウントが無いため per-user は作らない）（2A） |
| 並び | アクティブプロジェクト内で **`title.trim()` を `localeCompare(a, b, 'ja', { sensitivity: 'base' })`、同値なら `number` 昇順**。手動並べ替えは初版対象外（3A） |
| シェル | **左サイドバーを新設**。ナビ「ボード」「バックログ」をサイドへ移し、その下に「お気に入り」節。トップバーは brand・プロジェクト切替・workspace を残す。メイン領域はヘッダー直下で `display:flex` の横並び（`aside.app-sidebar` + `div.app-main` 内 `router-outlet`）（4A） |
| トグル位置 | **アイテム詳細の `.detail-heading-actions`（右上）のみ**。ボードカード／ソリューションページの星は初版対象外（5A） |
| 一覧の範囲 | **アクティブプロジェクトの favorited アイテムのみ**（6A） |
| 空表示 | 「お気に入り」見出しは常時表示。0 件なら見出し下に `<p class="sidebar-empty">なし</p>`（リンクリストは出さない）（7A） |
| 保存 UX | クリックで **即時 PATCH**（担当者と同様）。フォーム autosave の `fields` / `sideFields` には載せない（8A） |
| 履歴 | field キー `favorite`。API の `before`/`after` は文字列 **`true` / `false`**。UI 表示名「お気に入り」、値表示は `true`→「オン」、`false`→「オフ」（9A） |
| 専用一覧 API | **作らない**。既存 `GET /api/board` の items をフィルタしてサイドバー用に使う（10A） |
| サービス | **`FavoritesSession`（injectable）を新設**。`ProjectSession` のプロジェクト確定／切替成功後に board を再取得して一覧を組み立てる。トグル成功時は optimistic に一覧を更新（11A） |
| MCP | スコープ外。Item JSON に追従するだけ |

推奨案を採用した事項: 左サイドバー新設、共有 bool、タイトル順、詳細右上のみ、board GET 再利用、FavoritesSession。

## 目的と受け入れ条件

1. アイテム JSON に `favorite: boolean` がある。`Item` を返すすべての GET（`board`・`backlog`・`items/{id}`・`items/by-number/{number}`）に含める。欠落時は常に `false`（null にしない）。
2. `PATCH /api/items/{id}` で `favorite` を部分更新できる。キー省略は変更なし。JSON で非 boolean（文字列・数値・null）は 400。解除は `false` を送る。
3. `POST /api/items` 作成時も任意で `favorite` を受け付ける（省略時 `false`）。作成 UI からの入力は初版対象外。
4. 詳細右上にトグルボタンがある。未登録時は「お気に入りに追加」、登録済みは「お気に入りから外す」（`aria-pressed` と `aria-label`）。リクエスト中はボタン disabled（assignee と同様）。成功時はアイコン状態が応答に追従する。失敗時は成功扱いにせず、既存のインライン／`reportError` 系でエラーを出し、押す前の状態へ戻す（L-001）。
5. アプリ左サイドバーに「ボード」「バックログ」リンクと「お気に入り」一覧がある。お気に入り行クリックで `/items/{number}?project={activeProjectId}` へ遷移する。表示タイトルは `title.trim()` が空なら常に `（無題）`、否则は trim 後のタイトル。
6. お気に入り一覧はアクティブプロジェクトの `favorite===true` のみ。並びは決めたこと 3A。プロジェクト切替後は新しいプロジェクトの一覧になる（切替中は既存の `switching` ガードに従う。切替と board 再取得の競合は L-040）。
7. トグル成功時、board 再取得を待たず一覧を **optimistic に追加／削除**し、同じターンでサイドバーに反映する。失敗時は一覧も戻す。
8. `favorite` 変更時に履歴 `updated`（field: `favorite`、before/after は `true`/`false` 文字列）が付く。未変更なら増やさない。UI は 9A の表示名／値変換に従う。
9. 初期スキーマと既存 DB の両方で列が追加され、既存行は `false`。
10. 詳細の title／description／既存プロパティ／ソリューションの挙動は変えない。ボードカード上にお気に入り表示は出さない（表示しないだけで、保存時に favorite を落とさない。L-015）。
11. トグル PATCH 中（busy）は、詳細の live refresh／古い GET 応答で星状態と item.favorite を上書きしない（L-037 / L-040）。世代または busy フラグでガードする。

## 用語

- **お気に入り**: アイテムの `favorite===true` 状態。
- **お気に入りトグル**: 詳細右上の追加／解除ボタン。
- **お気に入り一覧**: 左サイドバーの favorited アイテムリンク一覧。
- **FavoritesSession**: サイドバー一覧の取得・optimistic 更新・並びを担うサービス。

## 永続化

- DB: `items.favorite TINYINT(1) NOT NULL DEFAULT 0`。起動時マイグレーション `InitializeFavorite` で不足時に `ADD COLUMN`（`solution` / `close_reason` と同型）。
- `database/init/001_schema.sql` にも同列を追加する。
- API フィールド名は camelCase `favorite`。
- モデル: `Item` / `ItemInput` / `ItemPatch` に Favorite を追加。`cardFields`・INSERT・UPDATE・scan を追随。
- 履歴: `historyValues` と `appendHistory` のフィールド列に `favorite` を追加。baseline 生成ループにも同列を含める（`dueAt` / `solution` と同様）。
- 別テーブル・並べ替えテーブルは作らない。

## API

- 読み取り: 既存 item / board / backlog レスポンスに `favorite` を載せる。
- 書き込み: `ItemPatch.Favorite *bool`。省略＝触らない。デコードは厳密な JSON boolean のみ。
- `PATCH .../status` や assignee 専用 API は favorite を触らない。
- 専用 `/api/favorites` は作らない（10A）。

## クライアント

### シェル（App）

- トップバー: brand・プロジェクト切替・workspace（メインナビは置かない）。
- ヘッダー直下: `display:flex` 横並びで `aside.app-sidebar` + `.app-main`（`router-outlet`）。
- サイドナビ: ボード・バックログ。
- お気に入り節: 見出し「お気に入り」+ リンク一覧、または 7A の空表示。
- `FavoritesSession`: 初回とプロジェクト切替成功後に `GET /api/board` → `favorite===true` を 3A でソートして signal 保持。トグル成功時は optimistic 更新。poll は初版ではしない（L-860）。

### 詳細トグル

- `.detail-heading-actions` 先頭付近に星ボタン（コピー／コマンドの左）。
- クリック → `api.updateItem(id, { favorite: next })` のみ（他キーを送らない・undefined マージしない。L-454）。応答で item を更新し `FavoritesSession.applyToggle(item)` へ通知。
- **form / ItemAutosave の fields・sideFields に `favorite` を入れない**（L-453 / L-790）。
- リクエスト中 disabled（busy）。busy 中は live refresh 適用で `favorite` を戻さない（AC11）。失敗時は assignee と同様にエラー表示＋状態ロールバック＋一覧ロールバック。

### ルーティング

- 新規ルートは不要。サイドバーのリンクは既存 `routerLink` / item 詳細 URL。

## 非目標（初版）

- per-user お気に入り
- 手動並べ替え・フォルダ
- ボードカード上の星
- ソリューションページの星
- お気に入り専用ページ／検索
- サイドバーの定期 poll
- MCP ツール追加

## 知見（手順 4）

| ID | この機能での注意 |
|----|------------------|
| L-001 | トグル失敗を成功表示にしない。成否を見て UI／一覧を戻す |
| L-002 | 欠落 `favorite` を常に `false` に正規化。null を送らない |
| L-015 | ボードに星を出さないことと、PATCH で favorite を落とすことを混同しない |
| L-037 / L-040 | 詳細の live refresh がトグル中／直後のローカル状態を古い GET で上書きしない |
| L-453 / L-790 | favorite を form autosave と同居させない |
| L-454 | PATCH で `favorite` 省略時に undefined マージしない |
| L-860 | FavoritesSession の `GET /api/board` は items 一覧用のみ。activeProjectId／セッションを書き換える sync を呼ばない |
| L-861 | 即時 PATCH の in-flight 中も状態を一貫させる（disabled＋ロールバック） |

## テスト方針

- Backend: migrate、全 Item GET に `favorite`、PATCH true/false/省略/非bool、履歴・baseline、POST 省略時 false。
- Frontend: トグル成功／失敗ロールバック、busy 中の live refresh で星が戻らないこと、サイドバー optimistic 追加・削除・タイトル順・空「なし」、プロジェクト切替後の絞り込み、ナビ移設後のボード／バックログ遷移。
- 回帰: 詳細 autosave・assignee・solution リンク。

履歴・POST 任意 `favorite`・optimistic 一覧はカード本文の直接要件ではないが、既存フィールド追加（solution 等）の慣習に合わせる。

実装プランは Task 分割する: (1) BE 永続化＋API＋履歴 (2) シェル＋ナビ移設＋FavoritesSession (3) 詳細トグル連携 (4) 全体検証。同一 feature ブランチでよい。

## サブエージェントのレビュー済み

- 第 1 周（記述の確かさ）: レイアウト矛盾・GET 列挙・空タイトル・履歴形式・optimistic・FavoritesSession 固定などを反映済み。
- 第 2 周（範囲と知見）: L-860 と poll の混同を解消、live refresh ガードを AC11 に追加、PATCH キーのみを明記。
