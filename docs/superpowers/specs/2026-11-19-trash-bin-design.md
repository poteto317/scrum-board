# ゴミ箱機能（アイテム #70）

## 背景

カード要件:

- 削除をしても、30日以内なら復元できるようにする。
- 30日経ったら、自動で削除されるようにする。

現状:

- `DELETE /api/items/{id}` は hard delete（`DELETE FROM items`）。子は FK CASCADE。
- `deleted_at` / soft delete / 定期 purge / ゴミ箱 UI は無い。
- Close 列は理由付きの列移動であり、削除とは別。
- Cloud Scheduler はリポジトリに未導入（`deploy-gcp.sh` は Cloud Run のみ）。

## 決めたこと

| 事項 | 採用 |
|------|------|
| 削除の持ち方 | **1A** `deleted_at` soft delete（Close 列とは別。ボード／バックログから除外） |
| ゴミ箱 UI | **2A** `/trash` 一覧＋復元。ヘッダーメニューから入る |
| 復元先 | **3A** 削除前の `columnId`（列が無ければ Todo） |
| 30日後の自動削除 | **4A** purge API ＋ Cloud Scheduler。ゴミ箱一覧 GET 時の機会削除も行う |
| 即時完全削除 | **5A** ゴミ箱から確認ダイアログ付きで hard delete 可 |

ユーザーは推奨を一括採用。

## 目的と受け入れ条件

1. 詳細の「削除」は hard delete ではなく soft delete する。確認文は「ゴミ箱に移す／30日以内は復元可」を示す（「取り消せません」は使わない）。
2. soft delete されたアイテムは、ボード・バックログ・通常の `GET`（by id / by-number）・ライブ再取得・並び替え対象・お気に入り／最近見た等の派生一覧から除外される（`deleted_at IS NULL` のみ）。
3. `/trash` で当該プロジェクトのゴミ箱一覧を見られる。各行に削除日時・残日数目安・復元・完全削除がある。
4. 復元で `deleted_at` をクリアし、削除前の `column_id` に戻す。その列が無い／別プロジェクト等で無効なら Todo 列へ。番号・履歴・コメント等は残る。
5. ゴミ箱からの完全削除は **確認ダイアログ 1 回**のうえ hard delete（現行 CASCADE と同じ）。soft delete 済みのものだけ許可。
6. 経過時間が **`>= 30×24h`**（ちょうど 30 日を含む）の行は hard purge。未満は復元可。経路: (a) `POST /api/trash/purge`（全プロジェクト・Scheduler 向け）~~(b) `GET /api/trash` 冒頭の機会削除（当該 `projectId` のみ）~~（#130 で廃止: 一覧は読み取りだけで、期限切れは隠すだけ。[設計書](2026-11-25-trash-list-read-only-design.md)）。サーバ時刻基準。
7. ヘッダーメニューに「ゴミ箱」を追加（board / backlog / itemDetail で表示可）。選択で `/trash` へ遷移。
8. プロジェクト切替時はゴミ箱もアクティブプロジェクトの一覧に切り替わる（既存の project スコープ規則に従う）。
9. Close 列の挙動は変えない。
10. API／DB: `items.deleted_at` 追加。既存 hard delete 経路は「完全削除」と purge に限定する。

## データ

- `items.deleted_at DATETIME(6) NULL`（NULL = 生存、非 NULL = ゴミ箱）。起動時 migrate（既存 `Initialize*` と同型）＋ `database/init/001_schema.sql` も同期。
- 索引: `(project_id, deleted_at)` 程度で一覧／purge を支える（既存 migrate 流儀に合わせる）。
- soft delete 中も `column_id`・`position`・`backlog_position`・番号は保持（復元のため）。
- 保持期間: **削除時刻から 30×24h 未満は復元可**。`now - deleted_at >= 30×24h` で purge 対象（境界ちょうどは purge）。サーバ時計。UI は「残りおよそ N 日」を表示してよい。

## API

| 操作 | 方法 | 挙動 |
|------|------|------|
| ゴミ箱へ | 既存 `DELETE /api/items/{id}` | soft delete（`deleted_at = now`）。既に削除済みなら 404。 |
| 一覧 | `GET /api/trash?projectId=` | 同プロジェクトの `deleted_at IS NOT NULL` のうち、保持期間内のものを返す（新しい順）。読み取りのみ（#130）。 |
| 復元 | `POST /api/items/{id}/restore`（project スコープ可） | soft delete 済みのみ。`deleted_at` クリア。列が無効なら Todo。 |
| 完全削除 | `DELETE /api/trash/{id}`（project スコープ可） | soft delete 済みのみ hard delete。生存中・他プロジェクト・未存在は **404**。 |
| 一括 purge | `POST /api/trash/purge` | 全プロジェクトで `now - deleted_at >= 30×24h` を hard delete。認証は既存 Basic と同じ。レスポンスに削除件数。 |

通常の item **読取・書込**（GET / PUT / PATCH status・assignee・comments・command-templates 等）は soft delete 済みを **404** とする。board / backlog / reorder / live refresh は `deleted_at IS NULL` のみ。deep link で削除済み番号を開いたら 404（ゴミ箱から操作）。

**復元の応答:** soft 済みのみ 200。未存在・他プロジェクト・**まだ生存中**（ゴミ箱に無い）は **404**（「空の成功」にしない）。

**除外が必須の読取経路（実装で漏れなく）:**

- `repository.Board` / `GetItem` / `GetItemByNumber`
- `backlog.listBacklogCards` / `lockProjectCards`（および reorder が触る lock）
- お気に入り・最近見たなど items を列挙する派生（該当関数があれば同条件）
- memoryRepo の同等メソッド

## UI

- **詳細削除ダイアログ:** 文言をゴミ箱向けに変更。成功後は現状どおりボード等へ戻る。
- **`/trash`:** 一覧（番号・タイトル・削除日時・残日数・復元・完全削除）。空状態は **GET 成功かつ 0 件**のときだけ（GET 失敗はエラー表示。空と失敗を混同しない）。完全削除は **確認ダイアログ 1 回**。
- **ヘッダー:** catalog に `open_trash`（表示名「ゴミ箱」、`pageKinds: board / backlog / itemDetail`）。FE / BE catalog・`onActionClick` の三箇所を同期。`PageKind` に **`trash` は追加しない**（ゴミ箱ページはハンバーガー設定の対象外。既存 header prefs / session の読込完了前に prefs を全項目 PUT しない）。
- **a11y:** ボタンに明確な `aria-label`。破壊操作は dialog。

## 自動削除（Scheduler）

- `scripts/deploy-gcp.sh`（または隣接スクリプト）に Cloud Scheduler ジョブ追加: 日次で `POST {PUBLIC_ORIGIN}/api/trash/purge` に Basic 認証。
- **機会削除は `GET /api/trash`（ゴミ箱ページを開いたとき）のみ。** FE の追加ポーリングはしない。
- 本番完了条件に Scheduler 設定を含める。ローカルは機会削除＋手動 `POST /api/trash/purge` で検証。

## 実装方針（1 プラン内のタスク分割）

単一の実装プランに収めるが、タスクは次の順で依存を切る（並列可能なものはプラン側で明示）:

1. **BE データ＋soft delete 核:** migrate `deleted_at`、読取／書込の 404／除外、`DeleteItem` soft 化、テスト。
2. **BE ゴミ箱 API:** list / restore / hard delete / purge（機会＋一括）、境界テスト。
3. **FE ゴミ箱＋導線:** `/trash`、api、詳細ダイアログ文言、ヘッダー `open_trash`、世代ガード付き操作、テスト。
4. **運用:** deploy に Scheduler ジョブ（または手順ドキュメント＋スクリプト）。認証情報は既存 Basic を流用。

## 非対象

- 保持日数の設定 UI・プロジェクトごとの日数変更
- ゴミ箱の一括復元／一括完全削除（個別操作のみ）
- 削除済みアイテムの詳細編集画面
- Close 列の廃止や統合
- 番号の即時再利用ポリシー変更（hard purge 後の既存 CASCADE に従う）
- ゴミ箱一覧のバックグラウンドポーリング

## 知見（手順 4）

- **L-002:** ゴミ箱 GET 失敗 ≠ 空成功。restore / 完全削除で生存・未存在を 404。空配列は成功時のみ。
- **L-015:** soft delete は `deleted_at` 以外を書き換えない（列・本文・番号は保持）。復元で列が無効なときだけ Todo へ付け替え。
- **L-037 / L-040:** ゴミ箱 `load`・プロジェクト切替に加え、**復元／完全削除**の in-flight 成功が切替後・世代後の一覧を汚さない（generation または同等ガード＋テスト）。
- **L-669:** header menu prefs など永続設定を、読込完了前や読込失敗後に全項目 PUT で上書きしない（本カードでは既存 session を維持し、catalog に項目追加するだけ）。
- **除外列挙:** 上記「除外が必須の読取経路」を実装・テストのチェックリストにする。

## テスト方針

- BE: soft delete 後 board/backlog に出ない／書込が 404／restore で列復帰／列消失時 Todo／purge がちょうど 30d で対象／完全削除 CASCADE／生存 id の trash 操作は 404。
- FE: ダイアログ文言、trash 一覧・エラーと空の区別、復元・完全削除、ヘッダーから `/trash`、プロジェクト切替で一覧が入れ替わる、切替中の遅延 restore が旧一覧を戻さない。
- 機会 purge（project 限定）と `POST /api/trash/purge`（全 PJ）の件数をテストで固定。

## サブエージェントによる設計書レビュー

### 第1周（記述の確かさ）

対応: 機会 purge は project 限定／POST purge は全 PJ、完全削除パスと 404 固定、30d 境界は `>=`、確認 dialog 1 回、`PageKind` に trash を足さない、favorites を受入 2 へ。

### 第2周（範囲と知見）

対応: soft 済みへの書込も 404、機会削除は trash GET のみ、実装を 4 ブロックに分割、L-002/037/040/669 を本義で明記、除外経路を関数単位で列挙。
