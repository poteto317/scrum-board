# AI チャット全体入口（#56）Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [x]`) syntax. Commit は `/feature` 中はしない。

**Goal:** ボード／バックログ／詳細でページ右下から AI チャットを開閉できるようにする。詳細の常時インラインは撤去。

**Architecture:** ルート限定の `AiChatFab` が右下ボタン＋パネルを持ち、パネル内に既存 `ItemAiChat` を載せる。対象は `AiChatContext` 経由。board／backlog 配列から候補。詳細は route item を自動セット。

**Tech Stack:** Angular signals、Router、既存 `ItemAiChat`／`ai-credits-state`、Vitest

**Design:** `docs/superpowers/specs/2026-11-22-ai-chat-global-entry-design.md`

**知見:** L-001, L-037, L-397, L-408, L-474, L-762, L-978, L-980

**Commits:** `/feature` 中はコミットしない。BE／OpenAPI 変更なし。

---

## File map

| ファイル | 責務 |
| --- | --- |
| `frontend/src/app/ai-chat-target.ts` (+spec) | 型・ルート判定・resolve・候補表示用ヘルパ |
| `frontend/src/app/ai-chat-context.ts` (+spec) | pageKind／candidates／routeTarget／apply callbacks |
| `frontend/src/app/ai-chat-fab.ts` (+html/css/spec) | 右下入口・パネル・選択・開閉／Esc／フォーカス |
| `frontend/src/app/app.ts` / `app.html` | 対象ルートのときだけ Fab を出す |
| `frontend/src/app/board.ts` / `backlog.ts` / `item-detail.ts` | Context へ候補／詳細対象を供給 |
| `frontend/src/app/item-detail.html` | 常時 `app-item-ai-chat` 削除 |

**供給:** `AiChatContext`（`providedIn: 'root'`）。各ページが set／destroy で clear。

---

### Task 1: 純関数と型

- [x] **Step 1:** `ai-chat-target.ts`:

```ts
export type AiChatTarget = { number: number; projectId: number; itemId: number };
export type AiChatTargetOption = AiChatTarget & { title: string; canEdit: boolean };

export function isAiChatRoute(url: string): boolean { /* / /backlog /items/:n（solution 除外） */ }

/** 選択可能なもの（送信対象）。編集可のみ */
export function selectableCandidates(opts: AiChatTargetOption[]): AiChatTargetOption[] {
  return opts.filter((o) => o.canEdit);
}

export function resolveTarget(...): AiChatTarget | null { /* detail→routeTarget; board/backlog→selected if still selectable; else null */ }

export function sameTarget(a: AiChatTarget | null, b: AiChatTarget | null): boolean { /* number+projectId+itemId */ }
```

- [x] **Step 2:** spec: ルート、selectable、resolve、sameTarget。

---

### Task 2: AiChatContext

- [x] **Step 1:** signals: `pageKind`、`candidates`（**全件。canEdit false 含む**）、`routeTarget`、`onDescriptionApplied: ((item: Item) => void) | null`、`onCommentApplied: (() => void) | null`。**loggedIn は Context に置かず Fab が `AuthSession` を直読**。
- [x] **Step 2:** `setBoard`／`setBacklog`／`setDetail(target, { onDescriptionApplied, onCommentApplied })`／`clear`。プロジェクト切替検知は Fab 側。
- [x] **Step 3:** テスト: set/clear、candidates に canEdit false が残る、callback 登録。

---

### Task 3: AiChatFab UI

- [x] **Step 1:** 表示条件（すべて必須）: `isAiChatRoute`＋`AuthSession` 認証済＋（detail で routeTarget）または（board/backlog で selectable≥1）。**composeBlocked で入口 disabled にしない**
- [x] **Step 2:** CSS: `position: fixed; right/bottom; z-index: 12`
- [x] **Step 3:** パネル開閉。Esc: `!isComposing && keyCode!==229 && !repeat` かつ **open 後 300ms 経過**で閉じる（L-408）。閉じた直後 300ms は入口の keydown repeat を無視。外側クリックでは閉じない。送信側の repeat は既存 `item-ai-chat` に依存（Task 5 で回帰）。
- [x] **Step 4:** board/backlog: `<select>` に全 candidates。`canEdit===false` は option disabled。**`@if (open() && target())` のときだけ `ItemAiChat` マウント**（閉じてる間は credits 取得しない）。detail も同様に open 時のみ。
- [x] **Step 5:** 対象切替は selected 更新 → ItemAiChat inputs 変化で既存 ngOnChanges／L-037。candidates 更新のたび `resolveTarget` で selected を再検証（live refresh で消えたら null）。
- [x] **Step 6:** 閉じる順序: (1) パネル内 activeElement.blur() (2) open=false（unmount） (3) afterNextRender で入口 focus（destroyed／dialog[open] ならスキップ）。開く focus も同ガード。
- [x] **Step 7:** ルート遷移: 対象外→閉＋selected null。詳細→routeTarget 上書き。board/backlog→維持（一覧外 null）。`activeId` 変化→閉＋selected null。
- [x] **Step 8:** `(descriptionApplied)`→`onDescriptionApplied`、`(commentApplied)`→`onCommentApplied`。無ければ no-op。
- [x] **Step 9:** テスト: 開閉、Esc/IME/repeat/300ms、閉じてる間 ItemAiChat 非マウント、フォーカス戻り、destroyed/dialog 時 focus スキップ、未選択、対象外・未ログイン・編集可0・閲覧専用詳細で入口なし、候補更新で selected クリア、プロジェクト切替で閉じる、blocked でも入口可。

---

### Task 4: ページ配線と詳細インライン撤去

- [x] **Step 1:** `app.html`: `@if (showChrome() && showAiChatFab())` で Fab。`showAiChatFab` は url が ai-chat ルートのとき true（二重ガード）。
- [x] **Step 2:** board／backlog: 一覧更新で `setBoard`/`setBacklog`。canEdit は既存 **`canEditItem(item, user)`** に固定（server `canEdit` 優先）。destroy で clear。
- [x] **Step 3:** item-detail: `canEdit()` かつ item ありで `setDetail(target, { onDescriptionApplied: (i) => autosave.applyDescriptionSave(i), onCommentApplied: () => commentsPanel()?.reload() })`。それ以外／destroy で clear。
- [x] **Step 4:** `item-detail.html` から常時 `app-item-ai-chat` 削除。
- [x] **Step 5:** テスト: 詳細に常時 AI ブロック無し。

---

### Task 5: 検証

- [x] **Step 1:** `npx ng test --watch=false` include: ai-chat-target, ai-chat-context, ai-chat-fab, item-ai-chat, ai-credits-state（＋ board live refresh の既存 spec があればそれ）
- [x] **Step 2:** AC6: `git grep` / 該当ソースで board の live refresh `enabled` 条件に `aiChatOpen` 等が**追加されていない**ことを確認（パネル open 単独で poll を止めない）。DnD ガードも同様。
- [x] **Step 3:** `git diff --stat` で BE／OpenAPI 非変更

---

## レビュー記録

- 第1周（要件対応）: 11件 → 反映
- 第2周（タスク整合・知見）: 8件 → 反映（open 時のみ ItemAiChat、AuthSession 直読、二系統 apply、blur 順序、L-408 repeat、candidates 再検証、L-762 負例テスト、canEditItem）
- 結果: 妨げ解消。プラン確定
