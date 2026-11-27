# カード164: 会話履歴から削除（実装プラン）

**Goal:** ヘッダの「この会話を削除」を消し、履歴行の「削除」だけにする。行削除に L-408（`detail > 1` 無視）を足す。API は変えない。

**設計:** `docs/superpowers/specs/2026-11-27-card164-history-delete-design.md`

**知見:** L-001, L-408

## Task 1: ヘッダ削除 UI を除去し行削除に L-408 を付ける

**Files:**
- Modify: `frontend/src/app/project-ai-chat.html`
- Modify: `frontend/src/app/project-ai-chat.ts`

**Steps:**
1. HTML から `.ai-chat-delete-shown` ボタンブロックを削除する。
2. 履歴行の削除を `(click)="deleteConversation(conversation.id, $event)"` にする。
3. `deleteConversation(id, event?: MouseEvent)` で `event?.detail > 1` なら return。
4. `deleteShownConversation` と `canDeleteShown` を削除する（spec の参照除去は Task 2）。

## Task 2: テストを履歴行削除へ寄せる

**Files:**
- Modify: `frontend/src/app/project-ai-chat.spec.ts`

**Steps:**
1. `.ai-chat-delete-shown` / `canDeleteShown` / `deleteShownConversation` / `actionsDisabled` 内のヘッダ削除参照をすべて除去または行削除へ置換する（設計の影響範囲どおり全参照）。
2. **AC2:** デフォルト layout（fab/dock 相当の非 pinned・履歴閉）および `layout: 'page'` 非 wide で `.ai-chat-delete-shown === null` を固定する。
3. **AC1 / 表示中の削除成功:** pinned（`layout: 'page', wide: true`）で、表示中会話の行「削除」→ confirm OK → API 呼び出し・一覧から消え・表示が空/切替になることを、現行ヘッダ成功テストの移行先として固定する。
4. 同じ履歴表示で confirm キャンセル・API 失敗時に一覧と表示中会話が維持されること（L-001）。
5. `detail: 2` の click で confirm が呼ばれないこと（L-408）。
6. `npx ng test --watch=false --include=src/app/project-ai-chat.spec.ts` を通す。

## 検証

- FE: 上記 ng test
- BE: 変更なし（任意で既存 delete テストは触らない）
