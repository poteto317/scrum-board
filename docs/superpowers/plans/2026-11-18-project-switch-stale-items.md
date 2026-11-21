# プロジェクト切替の stale items 表示修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. **本フローではコミットしない**（`/feature`）。

**Goal:** プロジェクト切替直後〜再取得完了前（および再取得失敗後）に、active と違う `projectId` のカードが一覧に出ないようにする。

**Architecture:** Board / Backlog の表示用 computed で `item.projectId === projectSession.activeId()` のカードだけを残す。API・ProjectSession の切替シーケンスは変えない。

**Tech Stack:** Angular signals / Vitest

**Spec:** `docs/superpowers/specs/2026-11-18-project-switch-stale-items-design.md`

## Global Constraints

- API / DB 変更なし
- L-040 generation・切替中 poll 抑制、L-842 busy 順、L-844 操作拒否は維持
- `/feature` のためコミットしない
- 関連知見: L-040, L-842, L-844

## ファイル対応

| ファイル | 責務 |
|---------|------|
| `frontend/src/app/project-items.ts`（新規・必須） | `itemsForActiveProject(items, activeId)` 純粋関数 |
| `frontend/src/app/board.ts` | `grouped` で active 所属のみ |
| `frontend/src/app/backlog.ts` | 一覧表示で active 所属のみ |
| `frontend/src/app/board-project-switch.spec.ts` | 切替直後の旧カード非表示 |
| `frontend/src/app/backlog*.spec.ts` または新規 | backlog 同様 |

---

### Task 1: 純粋フィルタと Board 表示

**Files:**
- Create: `frontend/src/app/project-items.ts`
- Create: `frontend/src/app/project-items.spec.ts`
- Modify: `frontend/src/app/board.ts`（`grouped`）
- Modify: `frontend/src/app/board-project-switch.spec.ts`

**Interfaces:**
- Produces: `itemsForActiveProject(items: Item[], activeId: number | null | undefined): Item[]`
  - `activeId` が正の整数でないとき → `[]`（誤表示防止）
  - それ以外 → `item.projectId === activeId` のものだけ（順序維持）

- [x] **Step 1: 失敗するテスト（project-items + board switch）**

```ts
// project-items.spec.ts
it('keeps only items matching activeId', () => {
  const items = [
    { projectId: 1, id: 1, number: 1 } as Item,
    { projectId: 2, id: 2, number: 2 } as Item,
  ];
  expect(itemsForActiveProject(items, 2).map((i) => i.id)).toEqual([2]);
});

it('returns empty when activeId is missing', () => {
  expect(itemsForActiveProject([{ projectId: 1 } as Item], null)).toEqual([]);
});
```

Board: 既存 `board-project-switch.spec.ts` に、PATCH 成功〜GET 前に `activeId===2` かつ data がまだ project1 のとき、`grouped` に A が出ないテストを追加。

- [x] **Step 2: `itemsForActiveProject` 実装、`board.ts` の `grouped` で適用**

```ts
for (const card of itemsForActiveProject(this.data().items, this.projectSession.activeId())) {
  if (!itemMatchesFilter(card, filter)) continue;
  ...
}
```

- [x] **Step 3: `cd frontend && npm test -- --watch=false --include=src/app/project-items.spec.ts --include=src/app/board-project-switch.spec.ts` PASS**

- [x] **Step 4: コミットしない**

---

### Task 2: Backlog 表示

**Files:**
- Modify: `frontend/src/app/backlog.ts` — `filteredItems`（および件数・空表示の元）が active 絞り後を使う
- Create or modify: `frontend/src/app/backlog-project-switch.spec.ts`

`activeItems = computed(() => itemsForActiveProject(this.items(), this.projectSession.activeId()))` を追加し、`filteredItems` は `activeItems` に `itemMatchesFilter`、件数分母・空表示（`backlog.html`）も `activeItems().length` / `filteredItems()` を使う（旧 N 件を出さない）。`filterActive`（フィルタ設定の有無）は変更不要。

- [x] **Step 1: 失敗するテスト**

```ts
// backlog-project-switch.spec.ts（骨子）
// items に projectId:1 のカード、activeId を 2 に先にセット
// expect(filteredItems().length).toBe(0)
// expect(activeItems().length).toBe(0)  // 件数分母・空判定の元
// GET 失敗相当: items は旧のまま activeId=2 → 依然 0
```

- [x] **Step 2: `activeItems` / `filteredItems` / `backlog.html` の分母・空分岐を合わせて PASS**

- [x] **Step 3: `cd frontend && npm test -- --watch=false --include=src/app/backlog-project-switch.spec.ts --include=src/app/project-items.spec.ts` PASS**

- [x] **Step 4: コミットしない**

---

## Spec coverage

| 要件 | Task |
|------|------|
| 切替直後に旧カード非表示（Board） | 1 |
| GET 失敗後も旧カード非表示（Board / Backlog） | 1, 2 |
| 成功後は新カードのみ | 1, 2 |
| Backlog 一覧・件数・空表示 | 2 |
| API 非変更 | 全体 |
## 実行メモ

- subagent-driven 推奨。コミットステップはスキップ。
