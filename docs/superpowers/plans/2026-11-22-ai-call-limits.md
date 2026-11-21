# AI 呼び出し制限（#58）Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. Commit は `/feature` 中はしない。

**Goal:** 利用者別レート制限を実装しつつ既定はオフ。chat の長さ／往復／maxTokens を env で上書き可能にし、Anthropic コンソール運用手順を docs に書く。

**Architecture:** プロセス内スライディング窓（許可のみ記録）を handler に注入。credit チェック後・セマフォ前に判定。env は TrimSpace＋不正は上書き未適用。

**Tech Stack:** Go、既存 kanban handler／wiring、Vitest なし（BE 中心）、OpenAPI

**Design:** `docs/superpowers/specs/2026-11-22-ai-call-limits-design.md`

**知見:** L-001, L-044, L-752

**Commits:** `/feature` 中はコミットしない。

---

## File map

| ファイル | 責務 |
| --- | --- |
| `backend/internal/kanban/ai_rate_limit.go` (+test) | スライディング窓・Try／Release・no-op |
| `backend/internal/kanban/ai_limits_env.go` (+test) | env パース（rate／message／turns／chat maxTokens） |
| `backend/internal/kanban/ai_chat.go` / `ai_chat_context.go` | MessageMax／HistoryTurns の引数化 |
| `backend/internal/kanban/handler.go` / `ai_chat_handler.go` / `refined_handler.go` | rejectIfAIRateLimited、slot 成功後 Record、limit 注入 |
| `backend/internal/aichat/chatter.go` | `New` に maxTokens 引数（既定 4096） |
| `backend/cmd/server/wiring.go` | env → limits → handler／chatter |
| `docs/openapi.yaml` | 429 `ai_rate_limit` |
| `docs/ai-ops-limits.md` | env 一覧・既定オフ注意・Anthropic コンソール手順 |

---

### Task 1: レート制限コア（核）

- [x] **Step 1:** `AIRateLimiter` インターフェースと実装: `Enabled() bool`、`Try`（原子予約）、`Release`（busy／列失敗時）。無効時は Try 常に true・Release no-op。
- [x] **Step 2:** 窓 60s、閾値 N。予約時刻のみ保持。テスト: 無効、N=2 で 3 回目拒否、Release で再許可、並列 Try ≤ N、時間経過で再許可。
- [x] **Step 3:** `reserveAIRateLimit` → 超過時 429 `ai_rate_limit`＋固定文。credit 後・**acquireSlot 前**に Try。ai-chat／refined 両方。busy／列失敗時は Release（窓に残さない）。
- [x] **Step 4:** handler テスト: (a) 有効時 ai-chat／refined が 429/`ai_rate_limit`/固定文 (b) 無効時はレート非拒否 (c) slot 満杯で `ai_busy` かつ Release (d) クレジット回帰は既存維持。

### Task 2: env パースと wiring（核＋付帯の入口）

- [x] **Step 1:** `ParseAILimits(getenv)`。対応: `AI_RATE_LIMIT_PER_MINUTE`→RatePerMinute（0/未設定=off、正の整数のみ有効）、`AI_CHAT_MESSAGE_MAX`→MessageMax（既定4000、≥1 のみ）、`AI_CHAT_HISTORY_TURNS`→HistoryTurns（既定20、≥1。0 は未適用）、`AI_CHAT_MAX_OUTPUT_TOKENS`→ChatMaxOutputTokens（既定4096、≥1）。TrimSpace。空・空白のみ＝未設定。不正は当該既定＋slog 警告。
- [x] **Step 2:** wiring: `aichat.New(key, model, maxTokens, opts...)`（または同等の明示引数）と `NewHandler(..., WithAILimits(...), WithAIRateLimiter(...))` で注入。
- [x] **Step 3:** 単体テスト（4 env それぞれ）: 未設定、`"   "`、`" 20 "`、`0`、負、非整数。rate の `0`＝off、他の `0`＝未適用。

### Task 3: 長さ・往復・chat maxTokens（付帯）

- [x] **Step 1:** `NormalizeAIChatMessage(raw, maxLen int)`／`selectAIChatHistoryForModel(list, maxTurns int)` に上限引数。handler の「1〜N文字」文言を MessageMax と同期。chatter は New 時の maxTokens。format は触らない。
- [x] **Step 2:** テストで上書きと不正時既定維持を固定。

### Task 4: OpenAPI と運用 docs

- [x] **Step 1:** OpenAPI に `ai_rate_limit` とメッセージ。
- [x] **Step 2:** `docs/ai-ops-limits.md`: env 表、既定オフ、Compose export 注意、Anthropic コンソールで月額上限・自動チャージ OFF の確認手順。

### Task 5: 検証

- [x] **Step 1:** `go test` 対象パッケージ。
- [x] **Step 2:** `scripts/check-openapi-routes.py` 等があれば実行。
- [x] **Step 3:** FE 変更が無いか `git diff --stat` で確認。L-001: FE 無変更＋既存 429 は server `message` 表示・draft 保持を壊さない（本カードで FE を触らないことで担保）。

---

## レビュー記録

- 第1周（要件対応）: Record＝slot 成功後のみ、両 POST＋固定文＋busy 非 Record テスト、env 0/負の意味、4 env パース試験を反映
- 第2周（タスク整合・知見）: File map、Record シグネチャ、env 名、New 注入、空白のみケース、Normalize 引数化、L-001 を Task5 に反映
