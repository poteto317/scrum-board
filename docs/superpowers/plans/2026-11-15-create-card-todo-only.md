# アイテム追加時ステータス TODO 固定 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** ボード／バックログのアイテム追加ダイアログからステータス選択を外し、新規カードを常に Todo 列へ作成する。

**Architecture:** UI のみ変更。`cardForm` から `columnId` を外し、`addCard` で列名 `Todo` を解決して既存 `POST /api/cards` に渡す。API・DB は触らない。

**Tech Stack:** Angular 21, Vitest, 既存 `KanbanApi.createCard`

**参照設計書:** `docs/superpowers/specs/2026-11-15-create-card-todo-only-design.md`

## Global Constraints

- `/feature` 実行中は `git commit` しない（後続 `commit-ja`）
- Todo 列が無いときだけ作成拒否（カード 0 件の Todo は許可）
- API `columnId` 契約は変更しない

**知見:** L-203, L-060, L-057

---

### Task 1: ボード — ダイアログからステータスを外し Todo 固定で作成

**Files:**
- Modify: `frontend/src/app/board.html`
- Modify: `frontend/src/app/board.ts`
- Modify: `frontend/src/app/board.spec.ts`（および `cardForm`/`columnId` を触る既存 spec）

- [x] **Step 1: 失敗するテストを先に書く**

`board.spec.ts`（または小さな専用 describe）に:

1. モーダル表示後、`#card-status` が DOM に無い
2. Doing 列 id で `openCard` しても、`addCard` が Todo 列 id で `createCard` を呼ぶ
3. `columns` から Todo を除いた状態で `addCard` → `createCard` が呼ばれず `formError` に「Todo 列が見つかりません」系の文言
4. Todo 列は存在するが cards が 0 件でも `createCard` が Todo id で呼ばれる（正常系）

既存の `cardForm.setValue({ ..., columnId })` は title/description のみに直す。`Board create requests` 等で `addCard` するテストは、`data` に `name: 'Todo'` の列を必ずシードする。

- [x] **Step 2: テストを実行し、失敗を確認**

```bash
cd frontend && VITEST_MAX_WORKERS=1 npx ng test --watch=false --include='**/board.spec.ts'
```

- [x] **Step 3: 実装**

`board.html`: ステータス label/select を削除。

`board.ts`:
- `cardForm` から `columnId` を削除
- `openCard`: `reset({ title: '', description: '' })`（引数 `columnId` は未使用でよい。呼び出し側の `openCard(column.id)` は残す）
- `addCard`: Todo 名の列を探し、無ければ `formError.set('Todo 列が見つかりません。')` して return。あれば `createCard({ title, description, columnId: todoId })`

- [x] **Step 4: テストを通す**

同上コマンド。関連 spec の `columnId` 付き `setValue` を一括修正。

- [x] **Step 5: コミットはしない**

---

### Task 2: バックログ — 同様に初期ステータスを外す

**Files:**
- Modify: `frontend/src/app/backlog.html`
- Modify: `frontend/src/app/backlog.ts`
- Modify: `frontend/src/app/backlog.spec.ts`（必須）

- [x] **Step 1: 失敗するテスト**

1. `#backlog-card-status` が無い
2. `addCard` が Todo id で `createCard`（既存の `with selected status` / `columnId: 2` 期待は Todo 固定へ置換）
3. Todo 列無しで formError・未リクエスト
4. Todo 列あり・cards 0 件でも作成できる
5. `openCard` の `columns()[0]` フォールバックは削除し、Todo 解決は `addCard` に一本化

- [x] **Step 2: 失敗確認**

```bash
cd frontend && VITEST_MAX_WORKERS=1 npx ng test --watch=false --include='**/backlog*.spec.ts'
```

- [x] **Step 3: 実装**

select 削除、`cardForm` から `columnId` 削除、`addCard` で Todo 解決（ボードと同文言）。

- [x] **Step 4: テスト通過**

- [x] **Step 5: コミットはしない**

---

### Task 3: 文書と全体検証

**Files:**
- Modify: `README.md`
- Modify: `docs/verification.md`
- （`docs/api.md` は API 不変のため変更不要。UI 注記が必要なら verification に書く）

- [x] **Step 1: README / verification を「追加は常に Todo・ダイアログにステータス無し」に更新（L-203）**

- [x] **Step 2: フロント全テスト＋ビルド**

```bash
cd frontend && VITEST_MAX_WORKERS=1 npx ng test --watch=false
cd frontend && npm run build
```

- [x] **Step 3: コミットはしない**

---

## サブエージェントのレビュー済み

- 2026-11-15: 微修正反映（空 Todo 正常系・既存 spec の Todo シード・backlog.spec 必須化）後、実装へ進む
