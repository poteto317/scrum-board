# 一覧フィルタリング Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.  
> **Spec:** `docs/superpowers/specs/2026-11-17-list-filtering-design.md`  
> **コミットしない**（`/feature`）。知見: L-001, L-002, L-037, L-040（L-056 該当なし）

**Goal:** ボード／バックログでテキスト＋ステータス複数選択フィルタを共有し、サーバーに保存して端末間で同じ表示にする。

**Architecture:** DB にワークスペース共通 1 行の prefs。`GET/PUT /api/list-filter`。FE は共有マッチ関数＋デバウンス付き保存。一覧データは従来どおり取得しクライアントで絞る。

**Tech Stack:** Go / MySQL / Angular / vitest

## Global Constraints

- フィルタは FE 適用。board/backlog API のクエリ絞り込みはしない。
- 未知 columnId は PUT・適用時とも無視して正規化（空なら全列）。
- GET 失敗 ≠ 空フィルタ成功。
- PUT 成功時は **応答ボディの正規化済み JSON** で confirmed と draft を更新（楽観更新しない）。入力中の draft は UI／マッチに即反映し、PUT 失敗時は draft を直前の confirmed に戻す。
- `/feature` 中はコミットしない。

## ファイルマップ

| 領域 | パス |
|------|------|
| DB | Create: `backend/internal/kanban/list_filter_migrate.go`（`InitializeListFilter`）。Modify: `backend/cmd/server/main.go` と `mysql_test.go` の Initialize 列に登録 |
| API | Create: list_filter repository/handler 周辺。Modify: `handler.go` に GET/PUT 登録 |
| FE 純関数 | Create: `frontend/src/app/list-filter.ts` (+ spec) |
| FE API | Modify: `api.ts` (+ spec) |
| FE 状態 | Create: `list-filter-session.ts`（`providedIn: 'root'`・load/save 世代・デバウンス）(+ spec) |
| ボード | Modify: `board.ts` / `board.html` / `board.spec.ts` |
| バックログ | Modify: `backlog.ts` / `backlog.html` / `backlog.spec.ts` |

---

### Task 1: Go — テーブル＋ GET/PUT /api/list-filter

**Produces:** `ListFilter{Query string, StatusIDs []int}`, Get/Put、空時デフォルト、未知 ID 正規化（Put 時は存在する列のみ残す）

- [ ] `InitializeListFilter`: `CREATE TABLE IF NOT EXISTS workspace_list_filter`（単一行 id=1 固定、query TEXT、status_ids JSON）。`main.go` / `mysql_test.go` に配線
- [ ] GET: 行無し → `{"query":"","statusIds":[]}`。壊れた JSON／非配列 statusIds → 空フィルタを返す（行を空で上書きしない）
- [ ] PUT: `query`/`statusIds` 未指定・null → 400。query trim ≤200。statusIds は配列・有限の正 int のみ。重複除去。未知 columnId は列一覧と照合して除去。未知トップレベルキー 400
- [ ] handler テスト: GET 空、PUT 往復、未知キー 400、null フィールド 400、未知 statusId 正規化、重複除去、query 過長 400、壊れた DB JSON の GET→空＋DB 非書込

**Done when:** `go test ./internal/kanban/ -run ListFilter` 緑。

---

### Task 2: FE — マッチ純関数＋ API クライアント

**Produces:**

```ts
export type ListFilter = { query: string; statusIds: number[] };
export function normalizeStatusIds(ids: number[], knownColumnIds: number[]): number[];
export function itemMatchesFilter(item: { title: string; description: string; columnId: number }, filter: ListFilter): boolean;
// query trim+lower includes in title or description; empty query → text ok
// empty statusIds → status ok; else columnId in statusIds
```

- [ ] vitest: タイトルヒット／説明ヒット／AND／空／大小無視／statusIds 正規化
- [ ] `Api.listFilter()` / `Api.putListFilter(f)` 

**Done when:** list-filter.spec + api.spec 関連緑。

---

### Task 3: FE — ListFilterSession（取得・デバウンス保存・世代）

**Produces:** `@Injectable({ providedIn: 'root' })`（アプリ寿命。board↔backlog 遷移では destroy しない）:

- `filter`（draft＝UI／マッチ用）signal、`confirmed` 内部、`loadError` / `saveError`
- `load()` / `retryLoad()` 世代付き GET。失敗時は空フィルタ成功扱いにせず `loadError`（AC8）
- `setQuery` / `toggleStatus` / `clear` → draft を即更新し 300ms デバウンス PUT。成功時は **応答 JSON** で confirmed と draft を更新（L-001）。失敗時は draft を直前 confirmed に戻し `saveError`
- GET/PUT とも世代ガード（L-037 / L-040）
- ルート破棄時のみタイマー解除・世代++（通常の画面遷移では呼ばない）

- [ ] ユニット: 古い GET が新 state を上書きしない、進行中 PUT 完了が新しい draft を巻き戻さない、PUT 失敗で draft→confirmed 復帰、`retryLoad` で loadError 解除

**Done when:** session spec 緑。

---

### Task 4: ボード／バックログ UI 組み込み

**Consumes:** Task 2–3  
**Produces:** 両画面に検索＋列チェック＋クリア。各画面の init（または同等）で `session.load()`。チェック表示・マッチ前の両方で `normalizeStatusIds(..., 現行列IDs)`（未知列 ID を UI に出さない）。件数はフィルタ後。

- [ ] board toolbar / backlog heading 付近。クリアで空 PUT。`loadError`／`saveError` 表示と `retryLoad` 導線（AC8）
- [ ] live refresh 後も同じ draft filter で再フィルタ（prefs は再保存しない）
- [ ] board.spec / backlog.spec: フィルタ表示・クリア・非表示カードが操作対象に出ないこと。既存の DnD／作成／詳細遷移が壊れないこと（AC9）を最低 1 本ずつ確認

**Done when:** `cd frontend && npm test -- --watch=false` と `cd backend && go test ./...` 緑。コミットしない。
