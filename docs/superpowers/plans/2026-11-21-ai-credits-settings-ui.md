# AI クレジット設定 UI（#54）Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [x]`) syntax. Commit は `/feature` 中はしない。

**Goal:** `/settings` に AIクレジット残量・上限を表示し、admin が上限を設定／解除できるようにする。チャット枯渇文言を設定能力に合わせて更新。

**Architecture:** 既存「AI 利用状況」は維持し、並列で `getAICredits` する「AIクレジット」セクションを追加。ゲート判定は #52 の `isLowRemaining`／`blockedReason` を再利用。編集は `AuthSession.isAdmin()` のときのみ。`putAICredits` を Api に追加。

**Tech Stack:** Angular（signals）、テンプレートバインディング（`[checked]`／`(input)`／signal。FormsModule／ngModel は使わない）、Vitest、既存 settings／api／ai-credits-state

**Design:** `docs/superpowers/specs/2026-11-21-ai-credits-settings-ui-design.md`

**知見:** L-001, L-044, L-909, L-976, L-978, L-980, L-981（L-037 は適用外）

**Commits:** `/feature` 中はコミットしない。BE／OpenAPI は変更しない。

---

## File map

| ファイル | 責務 |
| --- | --- |
| `frontend/src/app/api.ts` | `putAICredits({ limitTokens })` 追加 |
| `frontend/src/app/ai-unavailable-copy.ts` | `AI_EXHAUSTED_MESSAGE` 更新 |
| `frontend/src/app/ai-credits-display.ts` | 残量／上限／期間の表示整形（API 非依存） |
| `frontend/src/app/ai-credits-limit-parse.ts` | 上限入力の非負整数パース |
| `frontend/src/app/ai-credits-settings-copy.ts` | 設定ページ固定文言 |
| `frontend/src/app/settings.ts` | credits 読込・編集・保存ロジック |
| `frontend/src/app/settings.html` | AIクレジット section UI |
| `frontend/src/app/settings.css` | 低残量強調・編集フォーム・375px |
| `frontend/src/app/settings.spec.ts` | AC カバレッジ |
| `frontend/src/app/item-ai-chat.spec.ts` | exhausted 文言アサート更新（必要なら） |

---

### Task 1: Api.putAICredits + 枯渇文言更新

- [x] **Step 1:** `api.ts` に追加:

```ts
putAICredits(body: { limitTokens: number | null }) {
  return this.http.put<AICredits>('/api/ai/credits', body);
}
```

（`limitTokens` キー必須。`null` 明示で解除・L-909）

- [x] **Step 2:** `ai-unavailable-copy.ts` の `AI_EXHAUSTED_MESSAGE` を次に変更:

```ts
export const AI_EXHAUSTED_MESSAGE =
  'AI の利用上限に達しています。設定で上限を確認・変更できます。';
```

- [x] **Step 3:** `ai-unavailable-copy` または settings/item の spec で固定アサート:

```ts
expect(AI_EXHAUSTED_MESSAGE).toBe(
  'AI の利用上限に達しています。設定で上限を確認・変更できます。',
);
```

`item-ai-chat.spec.ts` に文字列直書きがあれば新文言に合わせる。`npx vitest run src/app/item-ai-chat.spec.ts` で回帰。

---

### Task 2: Settings クレジット読込・表示（member 含む）

- [x] **Step 1:** `settings.ts` 変更概要:
  - `inject(AuthSession)`。`users.ts` と同じ形: `get isAdmin() { return this.auth.isAdmin(); }`。HTML は `@if (isAdmin)`（呼び出し括弧なし）
  - signals: `creditsLoading`／`creditsError`／`credits`（`AICredits | null`）
  - usage と credits を**独立**に読込（`forkJoin` しない）。`reloadUsage()`／`reloadCredits()`。`reload()` は両方呼ぶ
  - メソッド: `lowRemaining()` → `isLowRemaining(this.credits())`、`creditBlockReason()` → `blockedReason(this.credits())`
  - 表示ヘルパ: `displayRemaining(c)` → unlimited なら `'上限なし'`、else remaining が null なら `'—'`、else `String(remaining)`。`displayLimit(c)` → unlimited なら `'上限なし'`、else `String(limitTokens)`
  - 期間: `c.period === 'cumulative' ? '累計' : c.period`

- [x] **Step 2:** `settings.html` に「AIクレジット」section（利用状況の下）:
  - `aria-labelledby="ai-credits-heading"`
  - loading: `role="status"`「読み込み中…」
  - error: `role="alert"` + 再読み込み → `reloadCredits()`
  - 成功時:
    - `creditBlockReason()==='unconfigured'` → alert（既存 usage と同趣旨・`<code>ANTHROPIC_API_KEY</code>`）。枯渇は出さない
    - `creditBlockReason()==='exhausted'` → alert: admin なら `AI の利用上限に達しています。下の上限を変更できます。`／member なら `…管理者に上限の変更を依頼してください。`
    - `lowRemaining()` → `role="status"` + `AI_LOW_REMAINING_MESSAGE`（クラスで視覚強調。色だけに頼らない＝文言必須）
    - `dl.usage-grid`（または `credits-grid`）: 残り／使用済み／上限／期間。概算注記 `<p>`: `トークン数は概算です。Anthropic の請求と一致しない場合があります。`

- [x] **Step 3:** `settings.css`: 低残量 status に border/太字等（色以外の手がかり）。`@media (max-width: 375px)` で grid を1列（`grid-template-columns: 1fr`）

- [x] **Step 4:** `settings.spec.ts` ヘルパで毎回:

```ts
providers: [
  provideRouter([]),
  { provide: Api, useValue: apiStub },
  { provide: AuthSession, useValue: { isAdmin: () => false, user: () => ({ role: 'member' }) } },
]
```

（admin ケースは `isAdmin: () => true`）既存 usage だけのテストも AuthSession を必ず provide。

  - 並列: `getAIUsage` と `getAICredits` が両方呼ばれる
  - 表示: remaining/used/limit が応答値と一致
  - 期間「累計」と概算注記全文が出る
  - unlimited: 残り・上限が「上限なし」
  - credits 読込中: 「読み込み中…」（Subject 未完了で検証可）
  - credits 失敗: `role="alert"`＋再読み込みボタン。再クリックで `getAICredits` 再呼出
  - low remaining: status 文言が出る
  - exhausted + member: `管理者に上限の変更を依頼してください`・編集 UI 無し
  - exhausted + admin stub: `下の上限を変更できます`（Task 3 の admin セットアップでも可）
  - unconfigured: ANTHROPIC_API_KEY・枯渇文言無し
  - credits 失敗でも usage 成功表示可（独立）
  - usage 失敗でも credits 成功表示可

---

### Task 3: admin 編集・保存

- [x] **Step 1:** admin 時のみ編集 UI（`@if (isAdmin)`）:
  - checkbox「上限なし」→ `draftUnlimited` signal。`[checked]="draftUnlimited()"` `(change)` で set。オンで入力 `[attr.disabled]="draftUnlimited() || saving() ? true : null"`（L-978: `true`/`null`、boolean `disabled` プロパティは使わない）
  - text/number input → `draftLimit`（string）。`(input)` で set。credits 読込成功時に draft 同期: unlimited → checkbox on・入力 `''`；else off・`String(limitTokens)`
  - 保存ボタン: `[attr.disabled]="saving() ? true : null"`＋文言「保存中…」／「保存」。ラベルは `type="button"` `(click)="saveCredits()"`
  - クライアント検証: 上限あり時、空／非整数（`!Number.isInteger`）／負数 → ローカル alert（PUT しない）。`上限は 0 以上の整数で入力してください。`

- [x] **Step 2:** `saveCredits()`:
  - 冒頭: `if (!this.isAdmin || this.saving()) return;`
  - body: `this.draftUnlimited()` なら `{ limitTokens: null }`、else `{ limitTokens: Number.parseInt(this.draftLimit(), 10) }`（キー省略禁止・L-909）
  - `saving.set(true)` → PUT。成功: `credits.set(res)`、draft 再同期、`saveError` クリア、`saving.set(false)`。失敗: `saveError.set(errorMessage(err))`、**draft と `credits` は触らない**、`saving.set(false)`（L-001: 成功時だけ UI 確定）

- [x] **Step 3:** テスト（`isAdmin: () => true`）:
  - 編集 UI が見える。unlimited オン時 input が `hasAttribute('disabled')`
  - 上限なし保存: `putAICredits` 引数が `{ limitTokens: null }`（`toEqual`）。加えて Api 実装の単体または `HttpTestingController` で request body JSON に `"limitTokens":null` が載ることを1ケース固定（L-909）
  - 数値保存: `{ limitTokens: 5000 }`。成功後 `credits()`／DOM が PUT 応答値と一致
  - 保存失敗: draft 保持・`credits` 非更新・alert。saving が false に戻る
  - 負数／空／非整数（`1.5`）: PUT 非呼出
  - exhausted + admin: `下の上限を変更できます`
  - member stub: put／編集コントロール無し

---

### Task 4: 検証

- [x] **Step 1:** `cd frontend && npx vitest run src/app/settings.spec.ts src/app/item-ai-chat.spec.ts src/app/ai-credits-state.spec.ts`
- [x] **Step 2:** `git diff --stat` で BE／`docs/openapi.yaml` が変わっていないことを確認
- [x] **Step 3:** 設計 AC1–8 を頭で突き合わせ（375px は CSS メディアクエリで担保。a11y は `dl`/ラベル）

---

## レビュー記録

- 第1周（要件対応）: 6件 → AC7 文言固定・admin 枯渇・非整数・読込中/失敗・PUT 成功反映・期間/概算注記をテスト必須化
- 第2周（タスク整合・知見）: 7件 → FormsModule 不使用に固定、isAdmin getter 形、AuthSession provide、L-978 attr 手順、L-001 saving/credits 非更新、parseInt 修正、L-909 JSON ワイヤ
- 結果: 妨げ解消。プラン確定
