# AIチャット送信ボタンUI改善（#161） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AIチャットの送信ボタンを既存 `.primary` ベースの見た目＋アイコン＋hover/active にし、チャットUIと統一する。

**Architecture:** 見た目のみ。`project-ai-chat.html` の submit に `primary ai-chat-send` と装飾 SVG を足し、`project-ai-chat.css` に compose 配下の配置・アイコン・transition・active を置く。送信ロジック・`composeInactive` は触らない。

**Tech Stack:** Angular テンプレート / コンポーネント CSS / Vitest（既存 `project-ai-chat.spec.ts`）

## Global Constraints

- 範囲はフロント見た目のみ（API・送信条件・文言ロジックは変更しない）
- CSS は `.ai-chat-compose` 配下にスコープ（L-792）
- 二重送信防止は既存 `composeInactive` / disabled（L-408）
- フォーカスは既存 `button:focus-visible` を維持（L-157）
- 設計書: `docs/superpowers/specs/2026-11-27-card161-ai-chat-send-button-design.md`
- 知見: L-001, L-058, L-157, L-408, L-522, L-605, L-792
- `/feature` 中はコミットしない

---

## File map

| ファイル | 責務 |
| --- | --- |
| `frontend/src/app/project-ai-chat.html` | submit に class・アイコン・アクション行 |
| `frontend/src/app/project-ai-chat.css` | `.ai-chat-compose-actions` / `.ai-chat-send` / icon / active |
| `frontend/src/app/project-ai-chat.spec.ts` | 送信ボタンの class・disabled 固定 |

---

### Task 1: 送信ボタン見た目の回帰テストを先に書く

**Files:**
- Modify: `frontend/src/app/project-ai-chat.spec.ts`
- Modify: `frontend/src/app/project-ai-chat.html`
- Modify: `frontend/src/app/project-ai-chat.css`

- [x] **Step 1: 失敗するテストを追加する**

  既存の compose / send 周辺テストの近くに、例えば次を追加する（セレクタは実装に合わせる）:

  ```ts
  it('styles the send button as primary with ai-chat-send', () => {
    // arrange: チャット表示可能な fixture（既存の setup を流用）
    const send = fixture.nativeElement.querySelector(
      'form.ai-chat-compose button[type="submit"]',
    ) as HTMLButtonElement | null;
    expect(send).toBeTruthy();
    expect(send!.classList.contains('primary')).toBe(true);
    expect(send!.classList.contains('ai-chat-send')).toBe(true);
    expect(send!.textContent).toContain('送信');
    expect(send!.querySelector('.ai-chat-send-icon')).toBeTruthy();
  });
  ```

  disabled 時も既存どおり属性が付くことを、既存 `composeInactive` 系テストと矛盾しない形で確認する（既存があれば流用し、無ければ1ケース追加）。

- [x] **Step 2: テストを走らせて失敗を確認する**

  ```bash
  cd frontend && npx vitest run src/app/project-ai-chat.spec.ts -t "styles the send button"
  ```

  Expected: FAIL（まだ class / icon が無い）

- [x] **Step 3: マークアップを更新する**

  `project-ai-chat.html` の form 末尾を設計どおりに:

  ```html
  <div class="ai-chat-compose-actions">
    <button
      type="submit"
      class="primary ai-chat-send"
      [attr.disabled]="composeInactive() ? true : null"
    >
      <svg class="ai-chat-send-icon" aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" focusable="false">
        <path fill="currentColor" d="M3.4 20.6 21 12 3.4 3.4 3 10.5 14 12 3 13.5z"/>
      </svg>
      送信
    </button>
  </div>
  ```

  （path は紙飛行機風の単純 SVG でよい。可視テキスト「送信」は残す。）

- [x] **Step 4: CSS を追加する**

  `project-ai-chat.css` の `.ai-chat-compose` 付近に:

  ```css
  .ai-chat-compose-actions {
    display: flex;
    justify-content: flex-end;
  }
  .ai-chat-send {
    flex-shrink: 0;
    gap: 0.4rem;
    /* 既存 button の transition は background/color のみなので transform を含めて上書き */
    transition:
      background 0.15s,
      color 0.15s,
      transform 0.15s;
  }
  .ai-chat-send-icon {
    display: block;
    flex-shrink: 0;
  }
  .ai-chat-send:not(:disabled):active {
    transform: translateY(1px);
  }
  ```

  hover 色は `.primary:hover` に任せる。グローバル `button` / `styles.css` は触らない。

- [x] **Step 5: テストを通す**

  ```bash
  cd frontend && npx vitest run src/app/project-ai-chat.spec.ts -t "styles the send button"
  ```

  Expected: PASS

- [x] **Step 6: 関連スペック全体を通す**

  ```bash
  cd frontend && npx vitest run src/app/project-ai-chat.spec.ts
  ```

  Expected: PASS（既存の disabled / send フローが退行していない）

- [x] **Step 7: コミットしない**（`/feature` 制約。後続 `/commit-ja` で責務分割）

---

## 完了条件

- 設計の受け入れ条件 1〜5 を満たす
- 上記 vitest が緑
- 未コミットの差分が html / css / spec に限られる（他機能のついで変更なし）
