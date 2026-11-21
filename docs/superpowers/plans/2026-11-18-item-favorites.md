# お気に入り機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.  
> **Spec:** `docs/superpowers/specs/2026-11-18-item-favorites-design.md`  
> **コミットしない**（`/feature`）。知見: L-001, L-002, L-015, L-037, L-040, L-453, L-454, L-790, L-860, L-861

**Goal:** アイテムに `favorite` を永続化し、詳細右上トグルと左サイドバーのお気に入り一覧で追加／解除・遷移できるようにする。

**Architecture:** DB `items.favorite` TINYINT(1) + JSON `favorite`（bool）。`FavoritesSession` が board GET から一覧を組み立て、トグルは `updateItem({ favorite })` のみの即時 PATCH。シェルに左サイドバーを追加しメインナビを移設。form autosave には載せない。

**Tech Stack:** Go / MySQL / Angular / vitest

仕様末尾の「Task 分割」メモとの対応: 仕様(1)=本 Plan Task1、仕様(2)=Task2+3、仕様(3)=Task4、仕様(4)=Task5。

## Global Constraints

- `favorite` は常に boolean。欠落正規化は `false`。PATCH で非 bool／null は 400。省略＝変更なし。
- PATCH ボディは `{ favorite: next }` のみ（他キーを undefined で送らない。L-454）。
- `fields` / `sideFields` に `favorite` を入れない（L-453 / L-790）。
- FavoritesSession の board 取得は session／activeProjectId を書き換えない（L-860）。
- `loadForActiveProject` は世代番号で stale 応答を捨てる。`ProjectSession.switching()` 中は呼ばない／呼んでも適用しない（L-040）。
- トグルは `saving` 中 early return＋ボタン disabled。失敗時は item と一覧の両方を戻す（L-001 / L-861）。
- `/feature` 中はコミットしない。

## 知見チェック

| ID | Plan での扱い |
|----|----------------|
| L-001 | Task4 失敗ロールバック＋エラー表示 |
| L-002 | normalize `=== true` のみ true |
| L-015 | favorite 単独 PATCH で他フィールド不変テスト |
| L-037 / L-040 | busy 中 refresh スキップ；FavoritesSession 世代；切替中 load 抑止 |
| L-453 / L-790 | sideFields 非追加 |
| L-454 | `{ favorite }` のみ PATCH |
| L-860 | board GET で active sync しない |
| L-861 | saving early return＋一覧一貫 |

## ファイルマップ

| 領域 | パス |
|------|------|
| migrate | Create: `backend/internal/kanban/favorite_migrate.go`（+test）／Modify: `database/init/001_schema.sql`／`cmd/server/main.go`／`mysql_test.go` |
| model・repo・handler・history | Modify: `model.go`／`repository.go`／`handler.go`／`history.go`／`history_migration.go`／`history_import.go`（changes 上限 9→10）／関連 test |
| API docs | Modify: `docs/api.md` |
| FE 型・normalize・履歴 | Modify: `models.ts`／`board-data.ts`／item フィクスチャ／`item-history.ts` |
| FavoritesSession | Create: `favorites-session.ts`／`.spec.ts` |
| シェル | Modify: `app.ts`／`app.html`／`app.css`／（必要なら `app.spec.ts`） |
| 詳細トグル | Create: `item-favorite.ts`（+spec）／Modify: `item-detail.ts`／`.html`／`.css`／`.spec.ts` |

---

### Task 1: Backend — favorite 永続化・PATCH・履歴

**Files:** migrate / model / repo / handler / history / import / `docs/api.md` / `main.go` / `mysql_test.go`

**Interfaces:**
- `Item.Favorite bool`（JSON `favorite`。常に bool。未設定相当 `false`）
- `ItemInput` に Favorite／`ItemPatch.Favorite *bool`
- handler create: 省略時 `false`。update: `*bool` のみ受け付け。非 bool・null → 400
- 空 PATCH ガードに `p.Favorite == nil` を「フィールド無し」側へ足す（favorite 単独 PATCH が 400 にならない）
- `cardFields`・INSERT・UPDATE・scan に列追加
- 履歴: `historyValues` に `favorite: strconv.FormatBool(c.Favorite)`。field 列に `"favorite"`。baseline ループも同様
- import: `len(v.Changes) > 9` を **`> 10`**。`case "favorite"` は `true`/`false` のみ許可。`docs/api.md` 更新
- migrate: `InitializeFavorite` — `ADD COLUMN favorite TINYINT(1) NOT NULL DEFAULT 0`

- [x] **Step 1: 失敗するテスト**
  - board / backlog / `items/{id}` / by-number / POST・PATCH 応答に `favorite`（未設定 `false`）
  - POST `favorite` 省略 → 応答・DB とも `false`；POST `favorite: true` → 永続化
  - PATCH true／false／省略／`"true"` 文字列・`null`・数値 → それぞれ 200／200／不変／400…
  - favorite 単独 PATCH が空ガードで 400 にならない
  - 他フィールド不変（L-015）；`PATCH .../status` および assignee 更新後も `favorite` 不変
  - 履歴 field `favorite` before/after `"true"`/`"false"`；同値で件数増えない
  - baseline／created 履歴の changes 件数前提を favorite 追加後に更新（integration）
  - `InitializeFavorite` idempotent；既存行 false
  - import: changes 上限 10・`favorite` 値は `true`/`false` のみ
- [x] **Step 2: RED** — `cd backend && go test ./internal/kanban/ -count=1`
- [x] **Step 3: 実装**
- [x] **Step 4: GREEN**

---

### Task 2: Frontend — 型・normalize・履歴ラベル・FavoritesSession

**Files:** `models.ts`／`board-data.ts`／フィクスチャ／`item-history.ts`／Create `favorites-session.ts`／`.spec.ts`

**挙動:**
- `Item.favorite: boolean`；`ItemPatch` に含められること（`Partial`）
- normalize: `favorite: item.favorite === true`（欠落・非 true は false。L-002）
- `item-history.labels.favorite = 'お気に入り'`；値表示 `true`→`オン`／`false`→`オフ`（既存の値フォーマッタがあればそこに追加）
- `FavoritesSession`:
  - `items` signal: `{ id, number, title, projectId }[]`（表示用。空 title は後段で `（無題）`）
  - `loadForActiveProject()`: `api.getBoard()` → filter favorite → sort（spec 3A）。**active sync を呼ばない**（L-860）
  - `ProjectSession` の切替成功／初回 load 完了後に呼ぶ（配線は Task 3）
  - `applyToggle(item: Pick<Item,'id'|'number'|'title'|'projectId'|'favorite'>)`: optimistic 追加／削除＋再ソート
  - **`revertToggle(snapshot)` を必須公開**（失敗時に Task4 が呼ぶ。スナップショットは `items()` の浅いコピー）
  - `loadGeneration`（単調増加）: 開始時に採番し、応答適用前に一致しなければ捨てる（L-040）
  - 並び: `title.trim()` の `localeCompare(..., 'ja', { sensitivity: 'base' })`、同値は `number` 昇順

- [x] **Step 1: 失敗するテスト**
  - normalize 欠落 → false；`true` → true
  - history ラベル／値表示（オン／オフ）
  - FavoritesSession: filter+sort；applyToggle 追加／削除；revertToggle 復元；空 title のソートキーは trim 空
  - 古い `loadForActiveProject` 応答が新しい一覧を上書きしない（世代）
- [x] **Step 2: RED** — 対象 vitest
- [x] **Step 3: 実装**
- [x] **Step 4: GREEN**

---

### Task 3: Frontend — シェル（サイドバー＋ナビ移設）

**Files:** `app.ts`／`app.html`／`app.css`／必要なら spec

**挙動:**
- トップバーから `app-nav`（ボード／バックログ）を除去
- ヘッダー直下: `display:flex` で `aside.app-sidebar` + `.app-main`（`router-outlet`）
- サイド: ボード／バックログリンク + 「お気に入り」見出し + 一覧 or `<p class="sidebar-empty">なし</p>`
- お気に入り行: `routerLink="/items/"+number)` + `queryParams: { project: activeId }`。表示タイトル `trim` 空なら `（無題）`
- `ngOnInit`: 既存 `projectSession.load()` に加え、active 確定後 `favoritesSession.loadForActiveProject()`。`switchTo` 成功後のみ再 load（`switching()` 中は呼ばない。L-040）
- 表示タイトル・空「なし」は **App テンプレート**で担保（FavoritesSession は raw title を保持）
- モバイル: サイドバー最小幅を確保（横スクロール可でよい。折りたたみは非目標）

- [x] **Step 1: 失敗するテスト**（`app.spec.ts`）
  - サイドにボード／バックログの `routerLink`（`/` と `/backlog`）
  - 0 件で「なし」テキスト
  - 1 件以上でリンク・空 title は `（無題）`
  - 切替成功後に load が呼ばれる／switching 中は呼ばない（spy）
- [x] **Step 2: RED**
- [x] **Step 3: 実装**
- [x] **Step 4: GREEN**

---

### Task 4: Frontend — 詳細トグル

**Files:** Create `item-favorite.ts`／`.spec.ts`；Modify `item-detail.*`

**挙動（ItemAssignee と同型の専用ヘルパー）:**
- `ItemFavorite`: `saving` signal、`toggle()` は `saving()` なら early return。`updateItem(id, { favorite: !current })` のみ
- bind: `{ item, applyFavoriteSave, onError, cancel$ }`（命名は assignee の `applyAssigneeSave` に合わせる）
- 成功前に一覧スナップショット取得 → 成功: `applyFavoriteSave` + `FavoritesSession.applyToggle`（同一同期ターンで `items()` 更新）
- 失敗: reportError + favorite 戻す + `revertToggle(snapshot)`（L-001 / L-861）
- `item-detail.busy()` に `itemFavorite.saving()` を含める
- live refresh: **既存どおり `busy()` なら refresh 適用全体をスキップ**（assignee 保存中と同パターン。AC11／L-037／L-040）
- UI: `.detail-heading-actions` 先頭。`aria-pressed`。`aria-label` は正確に「お気に入りに追加」／「お気に入りから外す」。saving 中 disabled

- [x] **Step 1: 失敗するテスト**
  - トグル成功で favorite 反転＋同一フローで FavoritesSession.items 更新
  - `aria-label` 文言
  - saving 中の再 toggle が第2リクエストを飛ばない
  - 失敗で item＋一覧ロールバック
  - busy 中は refresh で favorite が戻らない
  - form value に favorite キーが無い／sideFields 非含有
- [x] **Step 2: RED**
- [x] **Step 3: 実装**
- [x] **Step 4: GREEN**

---

### Task 5: 全体検証

- [x] **Step 1:** `cd backend && go test ./internal/kanban/ -count=1`
- [x] **Step 2:** `cd frontend && npx vitest run`（autosave／assignee／solution／board 関連を含む全件）
- [x] **Step 3:** 手動観点: 詳細で星 → サイドに出る → クリックで詳細へ → 外すと「なし」。プロジェクト切替で一覧入替。ボードカードに星 UI 無し。トップバーに旧ナビが残っていない

## サブエージェントのレビュー済み

- 第 1 周（要件対応）: POST 省略・切替 L-040・aria-label・revert API・回帰を追記
- 第 2 周（整合と知見）: 世代ガード・L-861 early return・知見表・Task 番号対応を追記
