# リロード後アクティブプロジェクト不整合 Implementation Plan

> **本フローではコミットしない**（`/feature`）。

**Goal:** フルリロード後もヘッダーセレクトとボード／バックログが永続 `activeProjectId` で一致する。

**Architecture:** `ProjectSession.load` で activeId を projects より先に確定し、`bootstrapped` 後にだけ select をマウント。`clearIfMissing` は既に正の activeId がある欠落で消さない。

**Spec:** `docs/superpowers/specs/2026-11-19-reload-active-project-design.md`

**Tech Stack:** Angular signals / Vitest

## Global Constraints

- API / DB 変更なし、GET 統合なし
- L-040 / #71 / switchTo 維持
- `/feature` のためコミットしない

## ファイル対応

| ファイル | 責務 |
|---------|------|
| `project-session.ts` | load 順、bootstrapped、sync 契約 |
| `project-session.spec.ts` | 上記のテスト |
| `app.html` | select の `@if` マウント |
| `app.spec.ts` | bootstrap 前後の表示 |

---

### Task 1: ProjectSession bootstrap と sync

**Files:** `project-session.ts`, `project-session.spec.ts`

- [x] **Step 1: 失敗するテスト**

```ts
it('sets activeId before projects on load and marks bootstrapped', () => {
  session.load();
  // flush board first half via forkJoin - both flush
  flushLoad(2);
  expect(session.activeId()).toBe(2);
  expect(session.bootstrapped()).toBe(true);
});

it('does not clear a positive activeId when clearIfMissing sees a missing id', () => {
  session.activeId.set(2);
  session.syncActiveFromBoard(undefined, true);
  expect(session.activeId()).toBe(2);
  session.syncActiveFromBoard(0, true);
  expect(session.activeId()).toBe(2);
});
```

- [x] **Step 2: 実装** — `bootstrapped` signal、load で sync→projects→bootstrapped、sync の「正の id がある欠落は no-op」

- [x] **Step 3: `npm test -- --watch=false --include=src/app/project-session.spec.ts` PASS**

- [x] **Step 4: コミットしない**

---

### Task 2: ヘッダー select の遅延マウント

**Files:** `app.html`, `app.spec.ts`

- [x] **Step 1: 失敗するテスト** — load 完了前は `#project-select` が無い or disabled プレースホルダで先頭名が出ない。完了後 value が永続 id。

- [x] **Step 2: `@if (bootstrapped() && projects().length > 0 && activeId() != null)` で select マウント**

- [x] **Step 3: app + project-session specs PASS**

- [x] **Step 4: コミットしない**
