# サイドメニュー開閉（アイコンレール） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **本フローではコミットしない**（`/feature`）。

**Goal:** サイドバー右上のトグルで展開と細いアイコンレールを切り替え、状態を端末の `localStorage` に残す。

**Architecture:** 小さな storage ヘルパ（または injectable）が `scrumboard:sidebar-collapsed` を読み書きし、`App` の `collapsed` signal を正本にする。テンプレートでレール class・お気に入り `@if`・ナビのレール用 accessible name を切り替え、トグルは `aria-expanded` と Enter/Space `event.repeat` 抑止を持つ。

**Tech Stack:** Angular signals / Vitest、ブラウザ `localStorage`

**Spec:** `docs/superpowers/specs/2026-11-20-sidebar-collapse-design.md`

## Global Constraints

- サーバ API・DB・prefs は触らない
- キー: `scrumboard:sidebar-collapsed`（`"1"`=レール、`"0"`=展開）。**読取**で非 `"1"`・読取例外のときだけ展開。書込失敗は in-memory の新状態を維持（展開へ巻き戻さない）
- レール幅 52px、展開 220px。狭い幅でも自動開閉しない
- お気に入りは `@if (!collapsed())` のみ（`hidden` だけにしない）
- レール時ナビ: 可視テキストなし、`aria-label` 固定、アイコン `aria-hidden`
- L-475 / L-044 / L-476 / L-408 / L-835
- `/feature` のためコミットしない

## ファイル対応

| ファイル | 責務 |
|---------|------|
| `frontend/src/app/sidebar-collapse-storage.ts`（新規） | 読取・書込・キー定数。例外を握り boolean を返す |
| `frontend/src/app/sidebar-collapse-storage.spec.ts`（新規） | 不正値・欠落・例外・書込の単体 |
| `frontend/src/app/app.ts` | `collapsed` signal、初期化 1 回、`toggleSidebar`、repeat 抑止 |
| `frontend/src/app/app.html` | toolbar トグル、レール class、お気に入り `@if`、ナビ a11y |
| `frontend/src/app/app.css` | レール幅・toolbar・アイコンナビ |
| `frontend/src/app/app.spec.ts` | トグル／レール／favorites 非表示／storage |

---

### Task 1: storage ヘルパ

**Files:**
- Create: `frontend/src/app/sidebar-collapse-storage.ts`
- Create: `frontend/src/app/sidebar-collapse-storage.spec.ts`

**Interfaces:**

```ts
export const SIDEBAR_COLLAPSED_KEY = 'scrumboard:sidebar-collapsed';

/** storage 省略時は window.localStorage。読取失敗・非 "1" → false（展開） */
export function readSidebarCollapsed(storage?: Storage): boolean;

/** true→"1" / false→"0"。失敗時 false を返し throw しない */
export function writeSidebarCollapsed(collapsed: boolean, storage?: Storage): boolean;
```

- [x] **Step 1: 失敗するテストを書く**

```ts
// read: missing / "" / "0" / "yes" / getItem throws → false
// read: "1" → true
// write(true) → setItem(KEY,"1") 成功 → true
// write(false) → setItem(KEY,"0")
// write: setItem throws → false（例外は外へ出ない）
```

- [x] **Step 2: 実装して PASS**

- [x] **Step 3: `cd frontend && npm test -- --watch=false --include=src/app/sidebar-collapse-storage.spec.ts` PASS**

- [x] **Step 4: コミットしない**

---

### Task 2: App シェルの開閉 UI

**Files:**
- Modify: `frontend/src/app/app.ts`
- Modify: `frontend/src/app/app.html`
- Modify: `frontend/src/app/app.css`
- Modify: `frontend/src/app/app.spec.ts`

**挙動:**

- `collapsed = signal(readSidebarCollapsed())`（構築時 1 回。`showChrome` 変化で再読取しない）
- `toggleSidebar()`: 反転 → `writeSidebarCollapsed`（成否に関わらず signal は新状態）。トグル後もフォーカスをトグル上に残す（別ボタンへ移さない。L-408）
- `onSidebarToggleKeydown(event)`: `Enter` または `Space` かつ `event.repeat` なら `preventDefault`（状態は変えない）
- `aside.app-sidebar`: `[class.is-collapsed]="collapsed()"`、`id="app-sidebar"`（`aria-controls` 用）
- `.sidebar-toolbar` 内トグル: `type="button"`、`[attr.aria-expanded]="!collapsed()"`、`aria-controls="app-sidebar"`、`aria-label` は展開時「サイドバーを閉じる」／レール時「サイドバーを開く」。アイコンはインライン SVG（展開中＝パネルを閉じる図形、レール中＝パネルを開く図形。`aria-hidden`）
- ナビ: 展開時は現行の可視テキスト「ボード」「バックログ」（アイコンは任意で出してよいが展開時はテキストが主）。レール時は可視テキストなし、各 `<a>` に `aria-label="ボード"` / `aria-label="バックログ"`、アイコンは区別できる 2 種（ボード＝▥ 系、バックログ＝リスト系）で `aria-hidden="true"`
- お気に入り: `@if (!collapsed()) { ...既存... }`
- CSS: `.app-sidebar.is-collapsed { width: 52px; ... }`、ナビ縦アイコン中央

- [x] **Step 1: 失敗する app.spec を追加**

```ts
// 初期: collapsed false、favorites 節あり、sidebar に is-collapsed なし
// トグル click → is-collapsed、favorites 節なし、aria-expanded false、aria-label「サイドバーを開く」
// 再トグル → 展開に戻る、favorites あり、aria-label「サイドバーを閉じる」、document.activeElement がトグルのまま
// storage に "1" を仕込んで setup → 初期レール
// トグル後 KEY が "1"/"0"
// setItem が throw しても click 後 is-collapsed が付き、成功バナー等は出さない
// login 相当で showChrome false → 再表示しても collapsed はトグル結果のまま（再読取で戻らない）
// レール時ナビ a[aria-label="ボード"] / a[aria-label="バックログ"] があり、テキスト trim が空
// keydown Enter repeat → preventDefault（collapsed は変わらない）
// keydown Space repeat → 同様。Enter/Space の non-repeat は preventDefault しない（既定の活性化は残す）
```

既存の「moves board/backlog nav into the sidebar…」は展開前提のまま通す（必要ならトグル後のリンク構造アサーションを分ける）。

- [x] **Step 2: html/css/ts を実装して PASS**

- [x] **Step 3: `cd frontend && npm test -- --watch=false --include=src/app/app.spec.ts --include=src/app/sidebar-collapse-storage.spec.ts` PASS**

- [x] **Step 4: コミットしない**

---

### Task 3: 全体検証

- [x] **Step 1: `cd frontend && npm test -- --watch=false`** — 関連（app / sidebar-collapse-storage / header-menu.component）は PASS。フルスイートの失敗（ACL 期待差・`listUsers` 未モック等）は `git stash` 後の main でも同型で再現し、本変更起因ではない

- [x] **Step 2: 狭い幅でも自動開閉しないことを確認** — `app.ts` に viewport/`matchMedia` 連動なし。`app.css` の `680px` メディアクエリも `is-collapsed` を付けない

- [x] **Step 3: コミットしない**
