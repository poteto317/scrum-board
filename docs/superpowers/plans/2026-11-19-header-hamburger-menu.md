# ヘッダーハンバーガーメニュー Implementation Plan

> **本フローではコミットしない**（`/feature`）。
> **For agentic workers:** 設計書 `docs/superpowers/specs/2026-11-19-header-hamburger-menu-design.md` に従う。TDD。コミットしない。

**Goal:** ヘッダー右端にページ種別対応のハンバーガーメニューを置き、たまに使う操作を移し、表示 ON/OFF をサーバ prefs で永続する。

**Architecture:** list-filter と同型のワークスペースシングルトン `GET`/`PUT /api/header-menu`。FE は純関数カタログ＋`HeaderMenuSession`＋`HeaderMenu` UI。アイテム操作は `ItemMenuActions` で詳細／ソリューションが登録。プロジェクト操作はヘッダーからメニューへ移す。

**Spec:** `docs/superpowers/specs/2026-11-19-header-hamburger-menu-design.md`

**Tech Stack:** Go / MySQL、Angular signals / Vitest、既存 `appModal`

## Global Constraints

- 並び替え・リンクコピー・ユーザー／プロジェクト別 prefs は非対象
- solution ルートの `pageKind` は `itemDetail`
- L-669 / L-040 / L-037 / L-044 / L-015 / L-879 / L-880
- `/feature` のためコミットしない

## ファイル対応

| ファイル | 責務 |
|---------|------|
| `backend/internal/kanban/header_menu*.go` | 型・正規化・repo・migrate・handler |
| `backend/internal/kanban/model.go` / `handler_test.go` | Repository メソッド・memoryRepo |
| `backend/cmd/server/main.go` / `handler.go` | Initialize 連鎖・ルート登録 |
| `docs/api.md` | API 節 |
| `frontend/src/app/header-menu.ts` | カタログ・pageKind・visible 純関数 |
| `frontend/src/app/header-menu-session.ts` | hydrate / debounce PUT |
| `frontend/src/app/header-menu.component.*` | ボタン・popover・設定 |
| `frontend/src/app/item-menu-actions.ts` | 詳細／ソリューション登録 |
| `frontend/src/app/api.ts` | client |
| `frontend/src/app/app.html` / `app.ts` / `app.css` | DOM・配線・ヘッダー撤去 |
| `frontend/src/app/item-detail.*` / `item-solution.*` | アクション登録 |

---

### Task 1: BE header-menu API

**Files:** `header_menu.go`, `header_menu_migrate.go`, `header_menu_handler*.go`, `model.go`, `handler.go`, `handler_test.go`（memoryRepo）, `cmd/server/main.go`, `docs/api.md`

- [x] **Step 1: 失敗するテスト**
  - PUT 400: 未知トップキー、必須キー欠落、値型不正、`hiddenIds` 非配列／非 string、未知 ID、他 pageKind ID
  - PUT 200: 重複 ID は除去して受理
  - GET: 行無し／壊れた JSON → 空×3・DB 非書換。余分キー無視、欠落キー補完、キー単位型不正→そのキー空、未知要素除去
  - PUT→GET roundtrip

- [x] **Step 2: 実装** — カタログ定数、normalize、`workspace_header_menu(id, payload JSON)`、`GetHeaderMenu`/`PutHeaderMenu` on Repository + memoryRepo、`InitializeHeaderMenu`（`main.go` の Initialize 連鎖）、`GET`/`PUT /api/header-menu`。`docs/api.md` 追記。

- [x] **Step 3: `go test ./internal/kanban/ -count=1 -run HeaderMenu` PASS**

- [x] **Step 4: コミットしない**

---

### Task 2: FE 純関数＋ Session＋ Api

**Files:** `header-menu.ts`, `header-menu.spec.ts`, `header-menu-session.ts`, `header-menu-session.spec.ts`, `api.ts`, `api.spec.ts`

- [x] **Step 1: 失敗するテスト**
  - pageKind: board / backlog / item / solution→itemDetail / 未知→null
  - visible = カタログ − hidden（他種別 ID は出ない）
  - session: hydrate 前 PUT なし、GET 失敗→`loadError`・再試行まで PUT なし（空成功と区別）
  - load 開始で in-flight PUT 無効、GET 成功時 dirty マージ＋必要なら 1 回 save、遅延 PUT が新 draft を潰さない
  - ローカル編集後の遅延 GET を捨てる（loadGeneration）
  - PUT body は常に 3 キー（1 種別だけ変更しても全体）
  - PUT 失敗→`saveError`・confirmed 復帰／再試行
  - PUT 後 `load()` で hidden 保持
  - `retryLoad()` で GET 失敗から復帰

- [x] **Step 2: 実装** — list-filter-session を手本に generation / debounce / hydrated / loadError / saveError / `retryLoad`。`App.ngOnInit` から `headerMenuSession.load()`（Task 3 と合わせて配線）。

- [x] **Step 3: 該当 vitest PASS**

- [x] **Step 4: コミットしない**

---

### Task 3: HeaderMenu UI

**Files:** `header-menu.component.ts/html/css`, `app.html`, `app.css`, `app.ts`, specs

- [x] **Step 1: 失敗するテスト**
  - ボタンが `.header-end` 外。680px 相当でも表示（header-end 非表示でも残る）
  - open/close: 再クリック、Esc、外側クリック、項目実行後。フォーカス先頭→Esc でトリガーへ
  - a11y: `aria-haspopup/expanded/controls`、一覧 `role=menu`/`menuitem`、設定 `role=group` + checkbox（menuitemcheckbox 不使用）、「戻る」
  - 設定で 3 pageKind 編集。`pageKind=null` 時アクション空・設定は出せる（セレクト初期 board）
  - `loadError` / `saveError` 表示と再試行導線（`retryLoad` / 再保存）

- [x] **Step 2: 実装** — popover 2 ビュー、設定セレクト＋checkbox。`margin-left: auto` をハンバーガー側へ。App から `load()` 呼び出し。

- [x] **Step 3: specs PASS**

- [x] **Step 4: コミットしない**

---

### Task 4: プロジェクト操作をメニューへ

**Files:** `app.html`, `app.ts`, `header-menu.component.*`, specs

- [x] **Step 1: 失敗するテスト**
  - `#project-add` / rename / delete がヘッダーに無い
  - メニューから add/rename/delete。disabled: switching / mutating / !canRename / !canDelete / モーダル open（project_add）
  - L-880: subscribe 起点の busy・二重実行しない（既存 create 経路をメニューから踏襲）

- [x] **Step 2: 実装** — ヘッダー3ボタン削除。メニューから既存メソッド。

- [x] **Step 3: app + header-menu specs PASS**

- [x] **Step 4: コミットしない**

---

### Task 5: ItemMenuActions

**Files:** `item-menu-actions.ts`, `item-detail.*`, `item-solution.*`, specs

- [x] **Step 1: 失敗するテスト**
  - 未登録時 disabled
  - history スクロール／solution 遷移／既に solution にいるとき no-op でメニュー閉じ
  - favorite: 既存 busy／世代ガード共有、メニューラベルが詳細トグルと一致

- [x] **Step 2: 実装** — 登録／解除。solution 頁からも favorite／history（詳細へ遷移＋スクロールフラグ）。

- [x] **Step 3: 関連 specs PASS**

- [x] **Step 4: コミットしない**

---

### 検証まとめ

```sh
cd backend && go test ./internal/kanban/ -count=1 -run 'HeaderMenu|ListFilter'
cd frontend && npx ng test --watch=false --include='**/header-menu*.spec.ts' --include='**/app.spec.ts' --include='**/item-detail.spec.ts' --include='**/item-solution.spec.ts' --include='**/api.spec.ts'
```

## プランレビュー

### 第1周（要件との対応）

対応: BE GET/PUT バリデーション網羅、Session の GET/PUT 失敗 UX・generation・3キー PUT、UI 開閉/a11y/null pageKind、プロジェクト disabled 全規則・L-880、solution no-op・favorite ラベル。

### 第2周（タスク整合と知見）

対応: Repository/memoryRepo/main.go、`load()` 起点、遅延 GET 破棄、`retryLoad` 分担、`saveError` UI。
