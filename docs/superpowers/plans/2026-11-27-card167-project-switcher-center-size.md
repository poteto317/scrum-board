# プロジェクト変更の位置・サイズ（#167）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ボード／バックログのプロジェクト切替を `.page-topbar` の水平中央に置き、トリガー／listbox を設計書のサイズ表どおり大きくする。

**Architecture:** レイアウトはグローバル `.page-topbar` を `1fr auto 1fr` の CSS grid にし、`app-project-switcher` を中央トラック（`grid-column: 2`）へ置く。サイズと listbox の中央開きは部品の `project-switcher.css` のみ。TS／HTML の振る舞い・API は変えない。

**Tech Stack:** Angular standalone components、グローバル `styles.css`、Vitest/TestBed。

**Spec:** `docs/superpowers/specs/2026-11-27-card167-project-switcher-center-size-design.md`

## Global Constraints

- DOM の topbar 子はパンくず + `app-project-switcher` の 2 つのみ（空の第三要素なし）。
- 右寄せ残骸を残さない: `margin-left: auto` on switcher、`justify-content: flex-end`、listbox `right: 0`、`.project-error { text-align: right }`。
- 中央寄せを内側ラッパーの `margin-left: auto` に載せない（L-1096）。
- feature ステップではコミットしない（コミットは後続 `commit-ja`）。

## File map

| File | Responsibility |
|--|--|
| `frontend/src/styles.css` | `.page-topbar` grid + 中央列配置。右寄せ rule 削除 |
| `frontend/src/app/project-switcher.css` | サイズ表・中央 listbox・`justify-content: center`・error center |
| `frontend/src/app/board.spec.ts` | L-060: topbar 第 2 子 + grid 契約 |
| `frontend/src/app/backlog.spec.ts` | 同上 |
| `frontend/src/app/project-switcher.spec.ts` | listbox 中央開き・主要サイズ回帰 |
| `frontend/src/app/board.html` / `frontend/src/app/backlog.html` | 変更不要（順序は既にパンくず→switcher） |

---

### Task 1: 失敗する配置・スタイル契約テストを書く

**Files:**
- Modify: `frontend/src/app/board.spec.ts`
- Modify: `frontend/src/app/backlog.spec.ts`
- Modify: `frontend/src/app/project-switcher.spec.ts`

- [ ] **Step 1:** 既存の「`.page-topbar app-project-switcher` がある」テストを拡張（または隣に追加）:
  - topbar の `children` がちょうど 2、`children[1]` が `APP-PROJECT-SWITCHER`
  - `getComputedStyle(topbar).display === 'grid'`
  - `getComputedStyle(topbar).gridTemplateColumns` が 3 トラック（`1fr auto 1fr` 相当。jsdom が `fr` を展開する場合は `split` 長さ 3、または style シート文字列に `1fr auto 1fr` があることを `document.styleSheets` / ソース契約で固定）
  - 右寄せ削除は **styles.css のソース契約**: `.page-topbar > app-project-switcher` ブロックに `margin-left:\\s*auto` が無いこと（`getComputedStyle(...).marginLeft !== 'auto'` は使わない。computed は px になり検知できない）
- [ ] **Step 2:** `project-switcher.spec.ts` に listbox（`#project-select-list`）を開いた状態で:
  - `getComputedStyle(panel).left` が中央寄せ系（`'50%'` など。現状 `right: 0` 依存なら失敗する）
  - **`transform` が `translateX(-50%)` を含む**こと（computed、またはコンポーネント CSS のソース契約）。`left: 50%` だけでは不十分
  - パネルの `right` が auto（右寄せ `right: 0` が消えている）
  - トリガーの `maxWidth` が `360px`、`fontSize` が `16px`（コンポーネント CSS が jsdom で効かない場合は CSS ファイル文字列のソース契約にフォールバック）
- [ ] **Step 3:** `cd frontend && npx vitest run src/app/board.spec.ts src/app/backlog.spec.ts src/app/project-switcher.spec.ts -t "project-switcher|page-topbar|ProjectSwitcher"` 相当で **RED** を確認（セレクタは実装時に既存 describe 名へ合わせる）。

---

### Task 2: `.page-topbar` を中央寄せ grid にする

**Files:**
- Modify: `frontend/src/styles.css`

- [ ] **Step 1:** `.page-topbar` を次の意図に更新:
  ```css
  .page-topbar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 8px 16px;
  }
  .page-topbar > .breadcrumb {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .page-topbar > app-project-switcher {
    grid-column: 2;
    justify-self: center;
  }
  ```
  **必須:** パンくずの ellipsis（`min-width: 0` だけでは不十分。仕様「狭い幅」どおり）。
- [ ] **Step 2:** 旧 `.page-topbar > app-project-switcher { margin-left: auto }` を削除。
- [ ] **Step 3:** `rg -n "margin-left:\\s*auto" frontend/src/styles.css` でヒットしたら、その近傍が `.page-topbar` / `app-project-switcher` 向けでないことを確認（セレクタ自体の `page-topbar > app-project-switcher` は正しい新 rule なので残骸判定に使わない）。
- [ ] **Step 4:** Task 1 の board/backlog 配置テストが GREEN になるまで調整（jsdom の grid 表現に合わせてアサーションを現実的にする。設計の意図は崩さない）。

---

### Task 3: `project-switcher.css` のサイズと中央 listbox

**Files:**
- Modify: `frontend/src/app/project-switcher.css`

- [ ] **Step 1:** 設計書サイズ表どおり更新:
  - `.project-switcher { justify-content: center; }`（`flex-end` 削除）
  - trigger: `max-width: 360px; padding: 8px 16px; font-size: 16px; border-radius: 8px;`
  - list: `left: 50%; right: auto; transform: translateX(-50%); max-width: min(560px, 90vw); max-height: min(360px, 55vh);`
  - option: `padding: 12px 16px; font-size: 16px;`
  - `.project-error { text-align: center; }`
- [ ] **Step 2:** `rg "flex-end|right: 0|text-align: right|max-width: 180px|280px" frontend/src/app/project-switcher.css` で旧値・右寄せが残っていないこと。
- [ ] **Step 3:** Task 1 の project-switcher スタイルテストを GREEN にする。

---

### Task 4: 全体検証（コミットしない）

- [ ] **Step 1:** `cd frontend && npx vitest run src/app/board.spec.ts src/app/backlog.spec.ts src/app/project-switcher.spec.ts`
- [ ] **Step 2:** 必要なら `npm run test:css-contract`（dialog 契約。壊していなければパス）。
- [ ] **Step 3:** `git status` / `git diff` で触ったファイルが上記のみであること。**コミットしない。**

## 知見チェックリスト

- [ ] L-060: board/backlog で第 2 子配線を固定
- [ ] L-1096: 内側 margin で中央寄せしていない
- [ ] 右寄せ CSS を styles + component から除去
