# AI チャット不可状態 UI（#52）Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [x]`) syntax. Commit は `/feature` 中はしない。

**Goal:** キー未設定・残量ゼロで AI チャット入口を無効化し設定へ案内する。低残量は非ブロッキング警告。POST を呼ばないことで課金を防ぐ（BE 拒否は既存）。

**Architecture:** `Api.getAICredits()` を追加。`ItemAiChat` が履歴と並行して credits を取得し、世代付きで状態を適用。純関数 `isComposeBlocked`／`isLowRemaining`／`blockedReason` を computed `composeBlocked`／`lowRemaining`／`blockReason` から呼ぶ。`GET /api/ai/usage` は呼ばない。

**Tech Stack:** Angular（signals）、Vitest、既存 `item-ai-chat`／`api` パターン

**Design:** `docs/superpowers/specs/2026-11-21-ai-unavailable-states-design.md`

**知見:** L-001, L-037, L-976, L-977（状態行列テスト）

**Commits:** `/feature` 中はコミットしない。

---

### Task 1: API クライアントと純関数

- [x] **Step 1:** `frontend/src/app/api.ts` に `AICredits` 型（OpenAPI 準拠: `limitTokens`/`usedTokens`/`remainingTokens`/`unlimited`/`approximate`/`period`/`configured`）と `getAICredits()` → `GET /api/ai/credits` を追加。`getAIUsage` は変更しない
- [x] **Step 2:** `frontend/src/app/ai-credits-state.ts`（新規）に純関数:
  - `isComposeBlocked(c: AICredits | null): boolean` — null は false；`!configured` または (`configured` && `!unlimited` && `remainingTokens === 0`)
  - `isLowRemaining(c: AICredits | null): boolean` — blocked なら false；上限あり・`limitTokens != null`・remaining>0・remaining < limit*0.1
  - `blockedReason(c: AICredits): 'unconfigured' | 'exhausted' | null` — 未設定優先
- [x] **Step 3:** `ai-credits-state.spec.ts` 境界:
  - unlimited → blocked false・low false
  - `limitTokens: null` → low false
  - ちょうど 10% → low false；未満 → low true
  - remaining 0 + configured → blocked exhausted
  - unconfigured（残量ゼロでも）→ reason unconfigured
  - null credits → blocked false・low false

---

### Task 2: ItemAiChat UI

- [x] **Step 1:** 定数 `AI_UNCONFIGURED_MESSAGE`（settings.html と同一: `AI は未設定です。サーバーに ANTHROPIC_API_KEY を設定するとチャットと整形が使えます。`）／`AI_EXHAUSTED_MESSAGE`／`AI_LOW_REMAINING_MESSAGE` を共有または `item-ai-chat.ts` に置く。送信エラー文言はサーバ `message` をそのまま表示し FE で置換しない
- [x] **Step 2:** credits 購読は `getAICredits` のみ（`getAIUsage` 非呼出）。`reload` と同一 generation。`number`／`projectId`／`itemId` いずれの変更でも generation を進め古い credits を破棄（L-037）。signals: `credits`／`creditsLoading`。computed: `composeBlocked`←`isComposeBlocked(credits())`、`lowRemaining`←`isLowRemaining(credits())`、`blockReason`←credits があるとき `blockedReason`。読込中 compose disabled。失敗時 `credits=null`（直前成功も捨てる）・blocked なし
- [x] **Step 3:** `item-ai-chat.html`: `blockReason` で unconfigured/exhausted の `role="alert"` + `routerLink="/settings"`「設定を開く」；`lowRemaining()` のときのみ `role="status"`（blocked 時は status 出さない）；textarea/submit のみ `[disabled]="sending() || applying() || creditsLoading() || composeBlocked()"`；**履歴リストとクリアボタンは blocked でも有効**（クリアは既存どおり clearing/sending/空で制御）。`send()` 冒頭: `if (this.sending() || this.applying() || this.creditsLoading() || this.composeBlocked()) return;`（POST しない）
- [x] **Step 4:** `RouterLink` を imports に追加
- [x] **Step 5:** `item-ai-chat.spec.ts` 必須ケース:
  - unconfigured → compose disabled・POST 非呼出・alert 文言・`role=alert`・クリア可・**status バナー無し**
  - exhausted → 同上（configured true）・クリア可・**status 無し**（残量が少なくても）
  - low remaining（非 blocked）→ `role=status`・POST 可
  - credits loading → POST 非呼出
  - credits error（直前 blocked 成功のあと失敗）→ credits null・unblock・POST 可
  - 世代: `number`／`projectId`／`itemId` 各変更で古い credits を捨てる（L-037）
  - `getAIUsage` が呼ばれない
  - 送信 503 および 429 で draft 保持・サーバ message をそのまま表示（L-001・非上書き）

---

### Task 3: 検証

- [x] **Step 1:** `cd frontend && npx vitest run src/app/ai-credits-state.spec.ts src/app/item-ai-chat.spec.ts`
- [x] **Step 2:** `/settings` と BE を変更していないことを `git diff` で確認（#54）。settings 文言定数を共有する場合でも残量 UI は追加しない

---

## レビュー記録

- 第1周（要件対応）: 履歴・クリア可、usage 非呼出、世代3トリガ、limitTokens null、サーバ文言非上書き、role 検証、失敗時破棄、429 回帰をプラン必須化
- 第2周（タスク整合・知見）: is* 純関数と computed 名の分離、send ガードを creditsLoading/composeBlocked に固定、blocked 時 status 非表示テスト
- 結果: 妨げ解消。プラン確定
