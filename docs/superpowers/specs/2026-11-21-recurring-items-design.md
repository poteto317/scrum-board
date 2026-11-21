# 繰り返しアイテムの自動起票（ITEM-083）

## 背景

カード要件: 繰り返し行うアイテムを自動起票できるようにする。例（1週間ごと）:

- ライブラリのアップデート
- リファクタリング
- API Doc の整備
- その他のドキュメントの整備

現状:

- アイテムは手動作成のみ（ボード／バックログのモーダル → `POST /api/items`）。
- 期限（`dueAt`）はあるが繰り返しは対象外（`2026-11-17-item-due-at-design.md`）。
- 定期ジョブの先例: `POST /api/trash/purge`（セッション免除）＋ Cloud Scheduler（`scripts/ensure-trash-purge-scheduler.sh`）。
- 列はワークスペース共有。バックログ UI の新規作成も Todo 列 ID を使う。

## 決めたこと

| 事項 | 採用 | 根拠 |
|------|------|------|
| 仕組み | **繰り返しルール**を DB に持ち、定期 `POST` がアイテムを新規作成 | 1A。ゴミ箱 purge と同型で運用しやすい |
| 間隔 | **任意の 5 フィールド cron**（分 時 日 月 曜日）＋ IANA タイムゾーン | 2C（ユーザー指定） |
| 起票先 | **ルールごとに列 ID**（ワークスペース列から選択） | 3C。バックログ相当は利用者が Todo 列を選ぶ |
| 所属 | ルールは **プロジェクト単位**（`projectId` 必須） | 4A |
| UI | **`/recurring` 管理ページ**＋ヘッダーメニュー `open_recurring`（users/projects と同型） | 5A。サイドバーにもリンク可 |
| 初期データ | **シードしない**。カード例は説明として UI／docs に残す | 6A |
| 二重起票 | ルール行を `FOR UPDATE` し、`lastFiredAt` 基準で **1 ティック最大 1 回**起票 | 7A / L-464 |
| 初回発火 | `lastFiredAt` が NULL のとき起点は **`createdAt`**。その直後の cron 次回が `now` 以下なら起票 | 未定義解釈を防ぐ |
| 実行トリガー | Cloud Scheduler が **`POST /api/recurring/run`**（既定 **15 分ごと**）。セッション免除は purge と同型。**実効最短間隔は Scheduler 粒度が上限**（例: cron が毎分でも 15 分に 1 回まで）。運用は Scheduler 間隔 ≤ 想定最短 cron | 既存運用に合わせる |
| cron ライブラリ | Go に **`github.com/robfig/cron/v3`** の標準パーサ（秒なし）を追加 | 自前パーサを増やさない |
| 認証（CRUD） | 既存セッション必須。管理者限定にはしない（ログインユーザーなら当該プロジェクトのルールを CRUD） | 他プロジェクト設定ページに合わせる |
| 作成者 | 自動起票アイテムの `created_by_user_id` は **null**（システム起票） | ユーザー不在の Scheduler 経路 |

## 目的と受け入れ条件

1. 解決後アクティブプロジェクトに対して繰り返しルールを作成・一覧・更新・削除できる（`/recurring`）。
2. ルールは少なくとも次を持つ: 名称（管理用）、起票タイトル、起票説明（空可）、5 フィールド cron、タイムゾーン、`columnId`、`enabled`、`projectId`。
3. 書き込み検証で **400** にする条件（L-044）: cron 不正・空、timezone 不正（未知 IANA）・空、名称／title 空、`columnId` が存在しない、`projectId` が存在しない、またはリクエストの `projectId` がアクティブプロジェクトと一致しない（CRUD はアクティブプロジェクト固定）。列はワークスペース共有のため「列のプロジェクト不一致」は無い。
4. `POST /api/recurring/run` は Basic ゲート前提で **セッション不要**（purge と同型）。有効ルールのうち「起点より後の cron 次回 ≤ now」のものを起票する。起点は `lastFiredAt`、未発火（NULL）なら `createdAt`。成功時 200 と `{ "created": number, "skipped": number, "failed": number }`。
5. 同一ルールの並行 run でもアイテムが二重にならない（TX＋行ロック。L-464 / L-653 UI 連打は CRUD 側）。
6. 起票は既存 `CreateItem` と同等の制約（タイトル長・列存在・プロジェクト）。説明はルールの description をコピー。`dueAt` は付けない（初版）。
7. ヘッダーメニューに「繰り返し」（`open_recurring`、`pageKinds: ['board','backlog','itemDetail']`、`open_users` と同型）があり `/recurring` へ遷移する。FE/BE/`docs/api.md` のカタログを同期（L-515）。App ホストに `open_recurring` → `/recurring` の配線テストを追加する（L-925。移管時に消さない）。
8. 失敗した起票は成功扱いしない（L-001）。run 全体は可能なルールを続行し、1 件の失敗で全停止しない。カウンタ定義は「起票評価」節。
9. 起動時マイグレーションで表を作り、`001_schema.sql` と同期。既存アイテムの id / createdAt は触らない（L-456）。
10. Scheduler 用スクリプト `scripts/ensure-recurring-run-scheduler.sh` を purge と同型で追加する（デプロイ後に手動実行）。

## データモデル

### `recurring_rules`

| 列 | 型 | 備考 |
|----|-----|------|
| id | BIGINT PK AI | |
| project_id | BIGINT NOT NULL | FK projects。プロジェクト削除時 CASCADE |
| name | VARCHAR(80) NOT NULL | 管理画面用ラベル。空文字拒否 |
| title | VARCHAR(200) NOT NULL | 起票アイテムの title。空文字拒否 |
| description | TEXT NOT NULL | 起票アイテムの description（空文字可） |
| cron | VARCHAR(64) NOT NULL | 5 フィールド。例 `0 9 * * 1`。空・不正拒否 |
| timezone | VARCHAR(64) NOT NULL | 既定 `Asia/Tokyo`。未知 IANA は 400 |
| column_id | BIGINT NOT NULL | 起票先列。FK は付けず存在検証のみ（列削除に耐える） |
| enabled | TINYINT(1) NOT NULL | 既定 1 |
| last_fired_at | DATETIME(3) NULL | UTC。未発火は NULL |
| created_at / updated_at | DATETIME(3) NOT NULL | |

索引: `(project_id, id)`。

## API

| メソッド | パス | 認証 | 内容 |
|----------|------|------|------|
| GET | `/api/recurring-rules` | セッション | アクティブプロジェクトのルール一覧（`?projectId=` 先読みは projects 一覧と同方針で任意） |
| POST | `/api/recurring-rules` | セッション | 作成 |
| PATCH | `/api/recurring-rules/{id}` | セッション | 部分更新 |
| DELETE | `/api/recurring-rules/{id}` | セッション | 削除 |
| POST | `/api/recurring/run` | セッション免除 | 全プロジェクトの有効ルールを評価して起票 |

JSON は camelCase。一覧は `id` 昇順。

### 起票評価（run）

1. 有効ルールを列挙。
2. 各ルール: TX 開始 → `SELECT … FOR UPDATE` → 起点 `T0 = last_fired_at`（NULL なら `created_at`）→ cron の「`T0` より後の次回」が `now` 以下なら `CreateItem` → 成功時のみ `last_fired_at = now` → commit。失敗時は rollback（`last_fired_at` は進めない）。
3. **カウンタ**
   - `created`: アイテム作成に成功したルール数。
   - `skipped`: まだ次回が来ていない、または `enabled` 以外の理由で評価対象外（ロック取得前に除外したものは数えない。ロック後「次回 > now」は skipped）。
   - `failed`: 列欠落・CreateItem 失敗・不正 cron／timezone の実行時検出など、起票を試みたが成功しなかった数。
4. **永続エラーと再試行**: 初版は自動 `enabled=0` にしない。失敗時は `last_fired_at` を進めないため次回 Scheduler で再試行する（一時障害向け）。「無限リトライ暴発」は **二重起票**（同一期間の多重作成）を指し、行ロック＋成功時のみ `last_fired_at` 更新で防ぐ。列欠落のような永続失敗の繰り返しはログと `failed` で検知し、運用がルール修正または手動 disable する（回数上限・自動 disable は対象外）。

## UI

- `/recurring`: ルール一覧、追加モーダル、編集、有効／無効、削除 confirm。
- cron はテキスト入力＋短いヘルプ（例表示）。タイムゾーンはテキスト（既定 Asia/Tokyo）。列は select。
- ページ busy 中は操作 disabled（L-879 / mutating ガード）。作成・更新・削除ハンドラ先頭に **同期の再入場ガード**（フラグ／ref 相当）を置き、disabled 反映前の連打でも二重リクエストしない（L-653。Angular でも UI state 非同期の隙間を防ぐ）。
- 削除 confirm の開閉: Enter/Space の `event.repeat` を無視し、`click.detail > 1` を無視する（L-408）。
- `resolvePageKind('/recurring') → null`（`/users` `/trash` と同型でメニュー非表示ページ）。カタログ ID `open_recurring`、ラベル「繰り返し」、`pageKinds: ['board','backlog','itemDetail']`。

## 対象外

- 秒付き cron、カレンダー UI での cron 組み立て。
- 起票時の `dueAt`／担当者／ACL／スプリント自動割当。
- キャッチアップで一度に複数回分をまとめて起票。
- メール／通知。
- ルール実行履歴テーブル（初版は `last_fired_at` のみ）。
- ローカル Compose での Scheduler エミュレーション必須化（手動 `curl` で可）。

## 知見（実装時）

- L-001: UI／run とも成功確認後に確定。
- L-002: PATCH の省略と明示 null を混同しない（enabled 等）。
- L-044: 不正 cron／列は 400。
- L-464: at-least-once Scheduler 前提で行ロック＋発火記録を同一 TX。
- L-408: 削除 confirm のキーリピート／ダブルクリック抑止。
- L-515: メニューラベル「繰り返し」。
- L-653: CRUD ハンドラ先頭の同期再入場ガード。
- L-879: モーダル open 中・saving 中の再入場防止。共有ヘッダーは既存の switching/mutating を維持。
- L-901: 認証付き CRUD。run のみ免除を明示。
- L-925: `open_recurring` の App ホスト配線テストを追加し、移管時に消さない。
- L-926: CSS は `--paper` 等の既存トークン。

## 実装プランの分割（予告）

1 つの実装プラン内 Task 例: (1) DB＋ドメイン＋run＋docs (2) CRUD API (3) FE API/session (4) `/recurring` UI＋メニュー (5) Scheduler スクリプト＋通し検証。

## 直せない／残す制約

- 列はワークスペース共通のため、ルールの `columnId` はプロジェクトをまたいで同じ列を指す（現状のボードと同じ）。
- Scheduler の実際の GCP ジョブ作成はデプロイ担当者がスクリプト実行する（アプリ起動だけではジョブは作られない。purge と同じ）。
