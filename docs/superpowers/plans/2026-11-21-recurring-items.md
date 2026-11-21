# 繰り返しアイテムの自動起票 Implementation Plan

> **本フローではコミットしない**（`/feature`）。

**Goal:** プロジェクト単位の繰り返しルールを管理し、Cloud Scheduler 起点の `POST /api/recurring/run` でアイテムを自動起票する。

**Architecture:** `recurring_rules` テーブル＋CRUD API＋`/recurring` UI。run は purge と同型でセッション免除。評価は robfig/cron/v3（5 フィールド）＋行 `FOR UPDATE`＋成功時のみ `last_fired_at` 更新。

**Spec:** `docs/superpowers/specs/2026-11-21-recurring-items-design.md`

**Tech Stack:** Go/MySQL、`github.com/robfig/cron/v3`、Angular/Vitest、Cloud Scheduler

## Global Constraints

- cron は **5 フィールドのみ**（秒なし）。timezone は IANA。未知／**空文字**は **400**（省略時のみ既定 `Asia/Tokyo`）
- 初回発火起点: `last_fired_at` NULL なら **`created_at`**。成功時のみ `last_fired_at = now`（UTC）。1 ティック最大 1 起票（キャッチアップ複数なし）
- run 応答: `{ "created", "skipped", "failed" }`（定義は設計書「起票評価」）
- 自動起票の `created_by_user_id` は **null**。`dueAt` なし。**ルールをシードしない**（カード例は UI ヘルプ／docs 説明のみ）
- POST body に `projectId` を受け付ける場合、アクティブと不一致は **400**。受け付けない場合はサーバがアクティブ PJ を付与し、クライアント指定は無視／拒否をテストで固定
- GET 一覧は **id 昇順**。任意 `?projectId=` 先読みは **初版対象外**（アクティブ PJ のみ）
- セッション免除に `POST /api/recurring/run` を追加（purge と同型）。CRUD はセッション必須
- カタログ `open_recurring` / ラベル「繰り返し」 / `pageKinds: ['board','backlog','itemDetail']`。FE/BE/`docs/api.md` 同期
- UI 文言は日本語。CSS は既存トークン（`--paper` 等）。L-926
- L-001 / L-002 / L-044 / L-408 / L-456 / L-464 / L-515 / L-653 / L-879 / L-901 / L-925 / L-926
- `/feature` のためコミットしない

## ファイル対応

| ファイル | 責務 |
|---------|------|
| `backend/internal/kanban/recurring_migrate.go` (+ test) | `recurring_rules` DDL |
| `database/init/001_schema.sql` | 初期 schema 同期 |
| `backend/cmd/server/main.go` / `mysql_test.go` | migrate 連鎖 |
| `backend/go.mod` / `go.sum` | `robfig/cron/v3` |
| `backend/internal/kanban/recurring.go` (新規) | 型・cron 評価・Store メソッド |
| `backend/internal/kanban/recurring_run.go` (新規可) | run 評価ループ（TX＋FOR UPDATE） |
| `backend/internal/kanban/recurring_handler.go` (新規) | CRUD + run HTTP |
| `backend/internal/kanban/handler.go` | ルート配線 |
| `backend/internal/kanban/auth_middleware.go` | sessionExempt |
| `backend/internal/kanban/model.go` / memoryRepo | Store iface・メモリ実装 |
| `frontend/src/app/api.ts` | クライアント |
| `frontend/src/app/recurring*` (新規) | ページ・session・spec・css |
| `frontend/src/app/app.routes.ts` | `/recurring` + authGuard |
| `frontend/src/app/header-menu*` / BE `header_menu.go` / `header-menu.component.ts` | `open_recurring` |
| `frontend/src/app/app.spec.ts`（または既存ホスト配線 spec） | L-925 配線テスト |
| `docs/api.md` | エンドポイント・カタログ |
| `scripts/ensure-recurring-run-scheduler.sh` | 15 分ジョブ |
| `scripts/deploy-gcp.sh` | 案内コメント（任意） |

---

### Task 1: BE — schema・cron 評価・run

**Files:** migrate, schema, main, mysql_test, go.mod, recurring.go / recurring_run.go, model Store, memoryRepo, auth_middleware, handler route for run, tests

**Interfaces:**
- Produces: `(MySQLRepository) InitializeRecurringRules(ctx context.Context) error`（`InitializeSprints` と同型）
- Produces: `RecurringRule` JSON camelCase（id, projectId, name, title, description, cron, timezone, columnId, enabled, lastFiredAt, createdAt, updatedAt）
- Produces: `nextFireAfter(cronSpec, timezone string, after time.Time) (time.Time, error)` — IANA loc で評価
- Produces: `RunRecurring(ctx) (created, skipped, failed int, err error)` — 全 PJ 有効ルール
- Produces: `POST /api/recurring/run` → 200 `{created,skipped,failed}`（セッション不要）
- **同一 TX（L-464）**: 既存 `CreateItem` は内部 `BeginTx` するため **run からは呼ばない**。`createItemInTx(ctx, tx, ItemInput) (Item, error)` を `CreateItem` から抽出し、run は `FOR UPDATE` → `createItemInTx` → `last_fired_at` 更新 → 同一 `tx.Commit`

- [x] **Step 1: 失敗するテスト**
  - migrate で表作成。`001_schema.sql` と同期コメント。既存 `items` の id／createdAt が migrate 前後で不変（L-456）
  - cron パース: 有効 5 フィールド OK、6 フィールド／空／ごみ → エラー（L-044）
  - timezone: `Asia/Tokyo` OK、未知 → エラー。**空文字 → エラー**（省略デフォルトとは別）
  - 発火判定: `last_fired_at` NULL → 起点 `created_at`。次回 ≤ now なら fire。次回 > now なら skip
  - **tz 差**: 同じ cron・同じ UTC now で `Asia/Tokyo` と `UTC` の発火有無が分かれるケース
  - 複数間隔経過（例: 週次で 3 週間分相当）でも **1 ティック 1 起票**（キャッチアップ複数なし）
  - 並行 run: 同一ルールで二重起票しない（integration。L-464）
  - `POST /api/recurring/run` 匿名（セッション無し）200。列欠落・起票失敗・**実行時不正 cron/tz** は `failed++` かつ `last_fired_at` 非更新、他ルール続行。未到来は `skipped++`。失敗後も `enabled` 維持
  - 成功起票: title/description コピー、`columnId` 指定、**`ProjectID` = ルールの projectId**（アクティブと異なる PJ のルールでもその PJ に属する）、`created_by_user_id` NULL、`dueAt` 無し
  - 起票成功後に `last_fired_at` 更新が失敗する経路を模擬できるなら、再 run で二重起票しない（同一 TX なら自然に満たす）

- [x] **Step 2: 実装**
  - `(MySQLRepository) InitializeRecurringRules(ctx)` + schema DDL（設計書の列。索引 `(project_id, id)`。FK `project_id` CASCADE）。シード INSERT は書かない
  - `go get github.com/robfig/cron/v3`。`nextFireAfter`: `time.LoadLocation(tz)` + `cron.ParseStandard` + loc 上の `Next`
  - `CreateItem` を `createItemInTx` 抽出（公開 API の挙動は不変）
  - run: 有効ルール列挙 → 各ルール TX + `SELECT … FOR UPDATE` → 評価 → `createItemInTx`（`ProjectID: &rule.ProjectID`, `CreatedByUserID: nil`）→ `last_fired_at` → commit
  - `sessionExempt` に `POST /api/recurring/run`
  - main / mysql_test に migrate 連鎖
  - `docs/api.md` に **`POST /api/recurring/run`**（セッション免除・カウンタ定義）を追記

- [x] **Step 3: `go test ./internal/kanban/ -count=1` 該当 PASS**

- [x] **Step 4: コミットしない**

---

### Task 2: BE — recurring-rules CRUD

**Files:** recurring_handler.go, handler routes, Store CRUD, memoryRepo, docs/api.md（BE 節）, tests

**Interfaces:**
- Consumes: Task 1 の `RecurringRule` / `nextFireAfter` 検証
- Produces（Store。memoryRepo も同名）:
  - `ListRecurringRules(ctx, projectID int64) ([]RecurringRule, error)` — id 昇順
  - `CreateRecurringRule(ctx, projectID int64, in RecurringRuleInput) (RecurringRule, error)`
  - `UpdateRecurringRule(ctx, projectID, id int64, p RecurringRulePatch) (RecurringRule, error)`
  - `DeleteRecurringRule(ctx, projectID, id int64) error`
- Produces（HTTP）:
  - `GET /api/recurring-rules` → アクティブプロジェクトの一覧（id 昇順）
  - `POST /api/recurring-rules` body: name, title, description?, cron, timezone?, columnId, enabled?
  - `PATCH /api/recurring-rules/{id}` 部分更新（省略≠null。L-002）
  - `DELETE /api/recurring-rules/{id}`

- [x] **Step 1: 失敗するテスト**
  - POST 必須欠落・空 name/title・不正 cron・**空／未知 timezone**・未知 columnId → 400
  - POST body に `projectId` を含める実装ならアクティブ不一致 → 400。含めない実装ならサーバがアクティブを付与し、余分な `projectId` は無視または 400 のどちらかをテストで固定
  - POST 成功 → 201/200 と行。timezone **キー省略**時 `Asia/Tokyo`（空文字とは別）。enabled 省略時 true
  - GET はアクティブ PJ のみ・**id 昇順**。他 PJ ルールは出ない
  - PATCH: 省略フィールド不変（L-002）。明示 `enabled:false` で無効化。`description` 省略は不変、明示 `""` は空文字に更新、明示 `null` は 400（TEXT NOT NULL）。不正値 400。他 PJ id → 404
  - DELETE: 他 PJ / 欠落 → 404。成功後 GET に出ない
  - 未ログイン CRUD → 401（run は免除のまま。L-901）

- [x] **Step 2: 実装** 上記 API。アクティブ PJ は既存 board settings 解決と同型。`docs/api.md` に **CRUD 節**追加（run は Task 1）

- [x] **Step 3: `go test` PASS** / **Step 4: コミットしない**

---

### Task 3: FE — API・`/recurring`・メニュー

**Files:** api.ts, recurring.ts/html/css, recurring-session.ts(+spec), app.routes.ts, header-menu.ts/spec, header-menu.component.ts, header_menu.go, app.spec.ts（配線）, docs/api.md カタログ行

**Interfaces:**
- Consumes: Task 2 API
- Produces: `/recurring` ページ、`open_recurring` → `/recurring`

- [x] **Step 1: 失敗するテスト**
  - api クライアント: list/create/patch/delete のパスと body
  - 一覧: 空成功と GET 失敗を区別。プロジェクト切替で入替（世代ガード。L-037/040 相当）
  - **有効／無効**切替（一覧トグルまたは編集）が PATCH `enabled` を呼び、成功後 UI 反映。失敗時は成功扱いしない（L-001）
  - 追加／編集モーダル: busy 中 disabled（L-879）。保存・削除・enabled 切替ハンドラ先頭の同期再入場ガード（L-653）
  - 削除 confirm: `event.repeat` 無視、`click.detail > 1` 無視（L-408）
  - catalog: `open_recurring` ラベル「繰り返し」、board/backlog/itemDetail（L-515）
  - App ホスト: メニュー実行で `/recurring` へ遷移する配線テスト（L-925）
  - `resolvePageKind('/recurring') === null`
  - UI またはヘルプにカード例の説明（ライブラリ更新・リファクタ・API Doc 等）が残る（シードデータは無い）

- [x] **Step 2: 実装**
  - Users/Trash を手本にページ・route（authGuard）・session
  - FE catalog + BE allowlist + `onActionClick` case + disabled 扱い（`open_users` と同型）
  - cron ヘルプ例（例: `0 9 * * 1`）＋カード例の短い説明。列は既存 columns API／ボード状態から select
  - enabled 切替 UI
  - CSS: `--paper` 等。独自トークン禁止

- [x] **Step 3: `npx ng test --include=**/recurring*.spec.ts --include=**/header-menu*.spec.ts --include=**/app.spec.ts --watch=false`（必要に応じ調整）PASS**

- [x] **Step 4: コミットしない**

---

### Task 4: 運用 — Scheduler スクリプト

**Files:** `scripts/ensure-recurring-run-scheduler.sh`、`scripts/deploy-gcp.sh` 案内（任意）

- [x] **Step 1: スクリプト**
  - purge スクリプトを手本。頻度 **15 分**（`*/15 * * * *`）、`POST {ORIGIN}/api/recurring/run` + Basic
  - 冪等（既存ジョブ更新）。先頭コメントに使い方と「実効最短＝Scheduler 粒度」

- [x] **Step 2: 通し検証（ローカル）**
  1. セッション付きでルール POST（近い cron、既知 columnId）
  2. セッション無しで `POST /api/recurring/run` → `created >= 1`（または時刻を合わせて再実行）
  3. ボード／items に title 一致・`created_by` null・dueAt 無しを確認
  4. GCP ジョブ作成は任意

- [x] **Step 3: コミットしない**

---

## プランレビュー

### 第1周（要件との対応）

対応: 空 timezone 400、enabled UI、projectId 不一致方針、シード禁止＋カード例説明、GET id 昇順、実行時不正 cron/tz の failed、1ティック1起票、run の docs を Task1、通し検証、PATCH description の L-002、L-456 既存 items 非変更、`?projectId=` 対象外、失敗後 enabled 維持。

### 第2周（タスク整合と知見）

対応: run は `createItemInTx` 同一 TX（CreateItem 直呼び禁止）、起票 `ProjectID`=ルール PJ、`InitializeRecurringRules(ctx)` レシーバ、`nextFireAfter` の tz 評価、Store CRUD 署名固定。
