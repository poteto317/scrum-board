# カード165: 履歴一覧をデフォルトにしない — 実装プラン

**Goal:** 専用画面でも履歴一覧を常時出さず、初期はスレッド面。pin / wide 判定を削除する。

**設計:** `docs/superpowers/specs/2026-11-27-card165-history-not-default-design.md`

**知見:** L-1268（page / dock / 狭広の組み合わせで AC とテストを揃える）、L-408（トグルは既存同型・追加ガード不要）

## Task 1: `conversationListView` と定数

**Files:** `frontend/src/app/project-ai-conversations.ts`, `frontend/src/app/project-ai-conversations.spec.ts`

1. `CONVERSATION_LIST_PINNED_QUERY` を削除する。
2. `conversationListView` を `{ historyOpen: boolean }` のみ受け取り、`showList: historyOpen`、`showThread: !historyOpen` を返す（`pinned` キーは持たない）。コメントを設計どおり更新する。
3. 純関数テストを新シグネチャに合わせる（旧 pin / layout 分岐ケースを `historyOpen` true/false の2本に置換）。

## Task 2: `ProjectAiChat` から wide を外す

**Files:** `frontend/src/app/project-ai-chat.ts`, `frontend/src/app/project-ai-chat.spec.ts`

1. `wide` signal・`bindWideMedia`・`CONVERSATION_LIST_PINNED_QUERY` import を削除する。ctor からの呼び出しも消す。
2. `listView` computed は `historyOpen` のみ渡す。
3. setup の `wide` オプションと matchMedia モックを**削除**する（無視残し禁止）。呼び出し側の `{ wide: true/false }` も消す。
4. テスト更新（L-1268 / AC）:
   - **AC1:** page 初期で一覧 null・トグルあり・スレッド（`.ai-chat-list`）あり。既存の `getLatestProjectAIChat` / 初期読込テストは `wide` 引数だけ外し、挙動維持を確認する。
   - **AC2:** page でトグル→一覧、再トグルでスレッド。選択／新規開始で `historyOpen` false・一覧 null（dock 既存と同型を page でも固定）。
   - **AC3:** dock の swap / 選択で閉じる / 新規で閉じるは退行なし。page トグル開閉も断言する。
   - **AC4:** 旧「狭→広で pin」テストを「page 初期＝一覧自動表示なし（トグルあり）」の断言に**置換**する。幅非依存で一覧はトグルまで出ない契約を Task1 純関数＋この置換で固定する。
   - page を使う他テストで一覧操作するものは、先にトグルを開く。

## Task 3: 検証

1. `cd frontend && npx vitest run src/app/project-ai-conversations.spec.ts src/app/project-ai-chat.spec.ts`
2. AC 対応チェック:
   - AC1 → page 初期スレッド＋一覧なし／`getLatestProjectAIChat` 系維持
   - AC2 → page トグル・選択・新規
   - AC3 → dock ＋ page トグル
   - AC4 → 旧 pin テストを「自動一覧なし」へ置換＋純関数

## 完了条件

- [x] pin / wide / `CONVERSATION_LIST_PINNED_QUERY` / setup `wide` がコードから無い
- [x] page 初期で一覧非表示・トグルあり（AC1）
- [x] page でトグル開閉・選択/新規復帰（AC2）
- [x] dock / page トグル退行なし（AC3）
- [x] `getLatestProjectAIChat` 初期読込の既存テストが緑（設計#3）
- [x] 上記 vitest 緑
