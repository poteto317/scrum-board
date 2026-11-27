# AIチャット返答時の自動スクロール（#162） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 返答追加時に会話 list を stick-to-bottom で最下部へスクロールし、compose を list 外で下部固定する。上スクロール中は飛ばない。

**Architecture:** 純関数ヘルパー（near-bottom / scrollToBottom）＋ `ProjectAiChat` が list ref・stick フラグ・scroll イベント・messages 変化後の `afterNextRender` を配線。CSS で dock/page の list overflow と compose `flex-shrink: 0`。loading 中は list が無いのでスクロール登録しない（L-824）。

**Tech Stack:** Angular signals / afterNextRender / Vitest

## Global Constraints

- 設計書: `docs/superpowers/specs/2026-11-27-card162-ai-chat-autoscroll-design.md`
- 知見: L-824, L-157, L-408, L-001, L-058, L-605, L-792
- 閾値 48px。送信開始で stick on。その後上スクロールしたら stick off が勝つ
- `/feature` 中はコミットしない

---

## File map

| ファイル | 責務 |
| --- | --- |
| `frontend/src/app/ai-chat-scroll.ts`（新規） | `isNearBottom`, `scrollElementToBottom` |
| `frontend/src/app/ai-chat-scroll.spec.ts`（新規） | 純関数テスト |
| `frontend/src/app/project-ai-chat.ts` | stick・scroll 配線 |
| `frontend/src/app/project-ai-chat.html` | list ref + scroll |
| `frontend/src/app/project-ai-chat.css` | overflow / flex-shrink |
| `frontend/src/app/project-ai-chat.spec.ts` | stick on/off と scroll 呼び出し |

---

### Task 1: 純関数ヘルパー

**Files:**
- Create: `frontend/src/app/ai-chat-scroll.ts`
- Create: `frontend/src/app/ai-chat-scroll.spec.ts`

- [ ] **Step 1: 失敗するテストを書く**

  `isNearBottom`（`distance = scrollHeight - scrollTop - clientHeight`）:

  - distance `0` → true
  - distance `48`（閾値ちょうど）→ true
  - distance `49` → false
  - 明示 threshold `10` で境界内外

  `scrollElementToBottom`: 実行後 `scrollTop === scrollHeight`

- [ ] **Step 2: 実装して通す**

  ```ts
  export const AI_CHAT_STICK_THRESHOLD_PX = 48;
  export function isNearBottom(el: { scrollTop: number; scrollHeight: number; clientHeight: number }, threshold = AI_CHAT_STICK_THRESHOLD_PX): boolean
  export function scrollElementToBottom(el: { scrollTop: number; scrollHeight: number }): void
  ```

- [ ] **Step 3: `npx ng test --watch=false --include=src/app/ai-chat-scroll.spec.ts`**

---

### Task 2: CSS で compose を下部固定

**Files:**
- Modify: `frontend/src/app/project-ai-chat.css`

- [ ] **Step 1:** dock/page の `.ai-chat-list` に `overflow: auto` を明示
- [ ] **Step 2:** `.ai-chat-compose { flex-shrink: 0; }` を追加（既存 compose 規則の近く）

---

### Task 3: コンポーネント配線とテスト

**Files:**
- Modify: `frontend/src/app/project-ai-chat.html`
- Modify: `frontend/src/app/project-ai-chat.ts`
- Modify: `frontend/src/app/project-ai-chat.spec.ts`

- [ ] **Step 1: 失敗するテスト（list モック／スパイ）**
  - stick on で messages 追加 → `scrollElementToBottom` 相当が呼ばれる
  - 上スクロール（near-bottom 外）後の messages 追加 → 呼ばれない
  - `send` 開始 → stick on
  - `send` → 上スクロール → 返答 messages 追加 → 呼ばれない（AC2 勝ち）
  - 会話切替／`startNew`／load 成功 → stick on ＋ scroll がスケジュールされる
  - `loading` 中・`loadError` 中は schedule しても list 無しで no-op（scroll しない）

- [ ] **Step 2: HTML** — `<ul class="ai-chat-list" #messageList (scroll)="onMessageListScroll($event)">`

- [ ] **Step 3: TS**
  - `messageList = viewChild<ElementRef<HTMLElement>>('messageList')`
  - `private stickToBottom = true`
  - `onMessageListScroll`: `stickToBottom = isNearBottom(el)`
  - `private scheduleScrollToBottomIfStuck()`: `loading()` または `loadError()` が真なら **登録しない**。stick でなければ登録しない。それ以外は `afterNextRender` を登録し、**コールバック内**で list ref が無ければ no-op、あれば `scrollElementToBottom`（成功直後の未 CD で viewChild が空でも、描画後コールバックで拾う＝L-824）
  - **追従トリガー**: `effect`（または同等）で `messages().length` と末尾 `id` を監視し、変化時に schedule。**sending はトリガーにしない**
  - `send()` 先頭: `stickToBottom = true` のうえ schedule
  - `showConversation` / `startNew` / 初回 load 成功: いずれも **`stickToBottom = true`** のうえ schedule（前会話の stick off を持ち越さない）

- [ ] **Step 4: テスト通す**

  ```bash
  cd frontend && npx ng test --watch=false --include=src/app/project-ai-chat.spec.ts
  cd frontend && npx ng test --watch=false --include=src/app/ai-chat-scroll.spec.ts
  ```

- [ ] **Step 5: コミットしない**

---

## 完了条件

- 設計の受け入れ 1〜5
- 上記 vitest が緑
