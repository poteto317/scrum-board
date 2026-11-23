# アイテムのプロジェクト別アーカイブ Implementation Plan

> **このフローではコミットしない**（`/feature`）。

**Goal:** Done になって10×24時間以上経過したアイテムをプロジェクト別のアーカイブへ移し、読取専用で参照・解除できるようにする。

**Architecture:** `items.done_at` で完了状態の経過時間を記録し、`items.archived_at` でアーカイブを表す。日次 Scheduler は保護された API を呼び出し、通常一覧からアーカイブ済みアイテムを除外する。アーカイブ解除は Done へ戻して10日タイマーをリセットする。

**Spec:** `docs/superpowers/specs/2026-11-23-item-archive-design.md`

**Tech Stack:** Go / MySQL、Angular / Vitest、Cloud Scheduler

## 共通制約

- Done は大文字小文字を区別して正確に `Done` と一致する列。既存の完全一致 helper を再利用し、DB 側の比較では binary comparison を使う。Done 列へ入る時に `done_at` を設定し、離れる時にクリアする。内容編集・同じ列内の並べ替えでは維持する。
- 現在 Done の実効時刻は `done_at` と最新 Done 遷移時刻の新しい方。Done 遷移は `kind='updated'` の `changes` に `field=status, after=Done` を含むものだけとする。migration は現在 Done かつ `done_at IS NULL` の行だけを一度埋め、両時刻が無ければその時点の `updated_at` を保存する。日次処理は両時刻が NULL の行を対象外としてログし、`updated_at` を参照しない（L-626）。
- 10×24時間ちょうどを自動アーカイブ対象に含める。全日時はアプリケーションの UTC を使う。
- アーカイブは `deleted_at` や Close 操作と分離する。日次処理は `archived_at` のみを書き、既存の行・添付・コメント・履歴・関連・番号を保持する。Done実効時刻は共通の `effectiveDoneAt(doneAt, latestDoneTransitionAt)`（非NULL値の max、両方NULLなら未確定）で解決する（L-015）。
- `/archive` 一覧は `projectId` と現在の ProjectSession に限定する。すべての一覧・操作で project / tenant 境界を守り、主 API だけでなく関連・派生・操作 API にも ACL を適用する（L-843 / L-901）。
- 失敗した一覧取得は空状態として扱わない（L-002）。日次処理・解除は冪等にする（L-464）。
- アーカイブ詳細は閲覧 ACL の範囲で読取専用。通常一覧・ボード・バックログ・並べ替えから除外する。過去のスプリント割当・実績と関連表示は保持し、bulk template 適用では対象外にする。
- アーカイブ中の PATCH/DELETE、コメント・添付・AI chat・item command template の変更、並べ替え、新しいスプリント割当は拒否する。スプリント全件置換では既存のアーカイブ済み割当を維持する。
- Scheduler route は `sessionExempt` に登録しつつ `requireJobRunnerAuth` を明示的に通す。token または管理者セッションを許可し、クラウド環境の Scheduler は実行・変更しない。
- この feature ではコミットしない。

## タスク

### Task 1: done_at / archived_at のスキーマと Done 時刻

**Files:** `backend/internal/kanban/archive_migrate.go`（新規）、`database/init/001_schema.sql`、`backend/internal/kanban/model.go`、`backend/internal/kanban/repository.go`、`backend/internal/kanban/card_order.go`、`backend/cmd/server/main.go`、status/create/trash restore の関連テスト

- [x] **Done 時刻と migration の focused tests を追加する**（列移動での入退場、status history 優先、`updated_at` fallback、migration 再実行）。
- [x] マイグレーション、schema、モデル・scan・repository の実装を追加する。Archive migration は `InitializeFavorite` の後かつ `InitializeHistory` の前に `prepareHistory` を呼び、履歴 table を保証してから Done 時刻 backfill を行う。後続の `InitializeHistory` が履歴のない item に current-time baseline を挿入するため、baseline 生成前に backfill を完了する。
- [x] `UpdateItem` と `ReorderItems` の全列変更経路で Done 判定と時刻更新を共通化する。列変更なしの更新では `done_at` を維持する。
- [x] 新規作成時と trash restore 時も Done 列・`done_at` を整合させる。
- [x] `go test ./internal/kanban` を実行する。

### Task 2: アーカイブ repository / API / active query 分離

**Files:** `backend/internal/kanban/archive.go`（新規）、`backend/internal/kanban/archive_handler.go`（新規）、`backend/internal/kanban/handler.go`、`backend/internal/kanban/auth_middleware.go`、`backend/internal/kanban/history.go`、`backend/internal/kanban/repository.go`、`backend/internal/kanban/card_order.go`、`backend/internal/kanban/card_position.go`、`backend/internal/kanban/backlog.go`、`backend/cmd/server/main.go`、`database/init/001_schema.sql`、comments/attachments/AI chat/command template/sprint handlers、既存一覧／ACL／related query とテスト

#### アーカイブ状態別の書込経路

| Route / 操作 | archived item の扱い |
|---|---|
| `PATCH /api/items/{id}`、`DELETE /api/items/{id}` | 拒否。本文・status・assignee・project・favorite 等を変更する前に archive guard |
| `PATCH /api/items/by-number/{number}/status`、`PATCH /api/items/by-number/{number}/assignee` | 拒否 |
| `PATCH /api/items/{id}/acl` | 拒否 |
| `POST /api/items/by-number/{number}/comments`、`PATCH /api/items/by-number/{number}/comments/{commentId}`、`DELETE /api/items/by-number/{number}/comments/{commentId}` | 読み取りは許可、全変更を拒否 |
| `POST` / `DELETE /api/items/by-number/{number}/attachments`、`POST` / `DELETE /api/items/by-number/{number}/ai-chat` | 読み取りは許可、全変更を拒否 |
| `PUT /api/items/by-number/{number}/command-templates` | 読み取りは許可、変更を拒否 |
| `PUT /api/items/order`、`PUT /api/backlog/order` | archived item を active ordering 集合から除外。アーカイブ有無にかかわらず通常 item の並べ替えを成功させる |
| `POST /api/command-templates/apply-to-all-items` | archived item を適用対象から除外 |
| `PUT /api/sprints/{id}/items` | archived item の追加・解除を拒否し、全件置換でも既存 membership を維持 |
| sprint `activate` / `complete`、velocity / historical reads | archived Done item を含め、既存の完了実績を維持 |
| Related-item changes | `PATCH /api/items/{id}` の related changes を拒否。専用 route が登録されている場合も archived item の変更を拒否 |
| `POST /api/items`、`POST /api/items/refined`、`POST /api/recurring/run`、recurring-rule CRUD、sprint metadata CRUD | 既存 archived item を変更しないため通常どおり許可。作成経路では Task 1 の Done 時刻規則を適用 |
| `POST /api/items/{id}/restore`、`DELETE /api/trash/{id}`、`POST /api/trash/purge` | archived と deleted は同時に立てないため、trash 専用の既存動作を維持 |

- [x] **アーカイブ処理と書込拒否の focused tests を追加する**（期限前後、古い `done_at` より新しい Done history、時刻不明、再実行、解除、project 不一致、コメント・添付・AI chat・item template の書込拒否）。
- [x] `GET /api/archive?projectId=`、`POST /api/items/{id}/unarchive?projectId=`、`POST /api/archive/auto-archive` を実装する。
- [x] 自動処理は最大100件ずつ別トランザクションで候補をロックし、current Done・未削除・未アーカイブを再確認する。`effectiveDoneAt(done_at, latestDoneTransitionAt)` が期限以前のアイテムを対象にする。両時刻が NULL の行は処理対象外として件数をログし、日次処理では `updated_at` を使わない。`archived_at IS NULL` 条件付き更新を行い、`RowsAffected == 1` の時だけ `archivedAt` 履歴を書く。runtime に `done_at` は補正せず、全対象がなくなるまで batch を繰り返す。
- [x] `archived_at` の変更を `item_history` に `archivedAt` として記録する。通常 detail は read-only guard を適用し、各 write handler と repository write path でも archived 状態を拒否する。
- [x] Board/backlog/column order/backlog order/reindex の active set から archived row を除外する。related / history / sprint historical reads では除外しない。
- [x] `database/init/001_schema.sql` と起動時 migration の双方に `idx_items_project_archived (project_id, archived_at, id)` / `idx_items_done_archived_deleted (done_at, archived_at, deleted_at)` を追加し、migration 再実行を安全にする。
- [x] Sprint assignment は個別追加・解除の両方を拒否し、解除前の操作を要求する。全件置換では既存 archived membership を維持する。`activate` / `complete` / velocity は archived Done item を含み、過去の実績を維持する。bulk template 適用は archived item を対象集合から除外する。
- [x] focused backend tests と `go test ./internal/kanban` を実行する。

### Task 3: プロジェクト別アーカイブ画面と read-only detail

**Files:** `frontend/src/app/archive.ts/html/css/spec.ts`（新規）、`frontend/src/app/api.ts`、`frontend/src/app/models.ts`、`frontend/src/app/app.routes.ts`、`frontend/src/app/header-menu.ts`、`frontend/src/app/header-menu.component.ts`、`frontend/src/app/item-detail.ts/html/spec.ts`、backend menu catalog と route/component catalog tests

- [x] **画面の focused tests を追加する**（一覧・空状態・取得失敗・解除・プロジェクト切替時の古い応答の無視、詳細の読取専用表示）。
- [x] `Api` 型・呼び出し、専用コンポーネント、認証 route を実装する。解除処理は ProjectSession の世代・busy・エラー表示を既存 trash pattern に合わせる。
- [x] ヘッダーの FE/BE catalog と遷移を同時に更新し、既存 menu preferences の読込・保存を変えない。
- [x] focused frontend tests を実行する。

### Task 4: Scheduler 認証・ジョブ設定と API / 運用ドキュメント

**Files:** `backend/internal/kanban/handler.go`、`backend/internal/kanban/auth_middleware.go` と関連 auth tests、`scripts/ensure-archive-scheduler.sh`（新規）、`scripts/deploy-gcp.sh`、`README.md`、`docs/openapi.yaml`、`docs/api.md`、`scripts/check-openapi-routes.py`、`scripts/check-no-gcp-project-fallback.sh`

- [x] **Scheduler/API contract tests and checks**（session-exempt route、token / 管理者セッション、Content-Type / Origin、OpenAPI route/security checker、GCP project fallback checker）を追加・実行する。
- [x] route を `sessionExempt` の method+path switch に登録し `requireJobRunnerAuth` を明示的に適用する。guard の token / 管理者 session 両方と Content-Type / allowed Origin 検証を維持する。
- [x] 日次 03:30 Asia/Tokyo の専用 Scheduler script を追加し、既存 trash purge と順序依存しないようにする。
- [x] OpenAPI/API docs と `check-openapi-routes.py` のハードコード一覧を更新し、`check-no-gcp-project-fallback.sh` の `TARGETS` に `ensure-archive-scheduler.sh` を追加する。`deploy-gcp.sh` と README の案内・機能説明・運用方法も更新する。環境の Scheduler は実行していない。
- [x] `bash -n scripts/ensure-archive-scheduler.sh` と関連の auth tests を実行する。

### Task 5: 統合検証

- [x] `cd backend && go test ./...`
- [x] `cd frontend && npm test -- --watch=false`
- [x] `cd frontend && npm run build`
- [x] `git diff --check` と最終差分を確認し、受け入れ条件・マイグレーション順・project scope / ACL を照合する。
- [x] コミットせずに作業を終える。

> 注: MySQL integration tests は `KANBAN_TEST_DSN` が未設定の場合 skip される。実環境の Cloud Scheduler は作成・実行していない。

## タスク依存

- Task 1 は先行必須。Task 2 は Task 1 に依存する。
- Task 3 は Task 2 API と状態モデルに依存する。
- Task 4 の API/auth 実装は Task 2 に依存し、script/docs は Task 2 の endpoint 契約確定後に進める。
- Task 5 は Task 1〜4 の完了後に実行する。
