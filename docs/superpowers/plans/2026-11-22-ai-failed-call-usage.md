# 失敗 AI 呼び出しの利用量加算 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 打ち切り・拒否など失敗した AI 呼び出しも利用量に加算し、上限で止められるようにする。

**Architecture:** Chatter は Formatter と同様に応答あり失敗で Usage を返す。両ハンドラは `Chat`/`Format` 直後に設計の `bill` ロジックで `recordAIUsageAfterCall`（成功・Usage 付き失敗・見積もり対象）。ローカル invalid_request と `keepRate` 前は非加算。成功末尾の直 `AddAIUsage` は削除。

**Tech Stack:** Go, Anthropic SDK, testing

**Spec:** `docs/superpowers/specs/2026-11-22-ai-failed-call-usage-design.md`

## Global Constraints

- L-975: 単一加算点。成功末尾の直 `AddAIUsage` を削除
- L-575: 加算失敗を HTTP に流さない。注入テスト非目標
- 同時実行超過・インスタンスローカルレートは現状維持（設計の見直し記録）
- `/feature` 中はコミットしない
- OpenAPI 不変
- `ai_credits_handler_test.go` は変更しない（429 は ai-chat / refined ハンドラテストで固定）

## ファイル対応

| ファイル | 責務 |
| --- | --- |
| `backend/internal/kanban/ai_usage_estimate.go` | estimate / shouldEstimate / estimateInput 構築 |
| `backend/internal/kanban/ai_usage_estimate_test.go` | 純関数テスト |
| `backend/internal/kanban/ai_usage_record.go` | recordAIUsageAfterCall |
| `backend/internal/aichat/chatter.go` | 失敗時 Usage 返却 |
| `backend/internal/aichat/chatter_test.go` | stop reason テスト |
| `backend/internal/kanban/ai_chat_handler.go` | 加算配線 |
| `backend/internal/kanban/refined_handler.go` | 加算配線 |
| `backend/internal/kanban/ai_chat_handler_test.go` | truncated / 見積もり / 未到達 / 429 |
| `backend/internal/kanban/refined_handler_test.go` | truncated / 見積もり / 429 |

---

## Task 1: 見積もり・判定の純関数

**Files:** Create `ai_usage_estimate.go`, `ai_usage_estimate_test.go`

- [ ] **Step 1:** `EstimateAIUsageTokens(input string) (in, out int64)` — `max(1, ceil(runes/4))`, out=0
- [ ] **Step 2:** `ShouldEstimateAIUsage(err error) bool` — 設計どおり: `err==nil` → false。Failure で **ローカル invalid_request（Status==0 かつ Kind==invalid_request）だけ false**。それ以外の Failure（Status==0 の invalid_output 含む、および timeout 等）→ true。Failure でない err → true（到達後の未知エラー）
- [ ] **Step 3:** `AIChatEstimateInput(system string, turns []ChatTurn) string` — system + 各 Body 連結。`RefinedEstimateInput(draft Draft) string` — `json.Marshal(draft)`（Marshal は drafts で失敗しない想定。失敗したら `Title+"\n"+Description`）
- [ ] **Step 4:** 単体テスト（空→1, 5 runes→2; local invalid false; timeout true; Status==0 invalid_output true; 非 Failure err → true）
- [ ] **Step 5:** `go test ./internal/kanban/ -run 'Estimate|ShouldEstimate|AIChatEstimate|RefinedEstimate' -count=1`

---

## Task 2: Chatter が失敗時も Usage を返す

**Files:** `aichat/chatter.go`, `chatter_test.go`

- [ ] **Step 1:** refusal / max_tokens / default StopReason で Usage + Failure
- [ ] **Step 2:** end_turn + 空本文 → Usage + kindInvalidOutput
- [ ] **Step 3:** テスト stub
- [ ] **Step 4:** `go test ./internal/aichat/ -count=1`

---

## Task 3: recordAIUsageAfterCall + ハンドラ配線

**Files:** `ai_usage_record.go`, `ai_chat_handler.go`, `refined_handler.go`

- [ ] **Step 1:** `recordAIUsageAfterCall` — AddAIUsage、失敗は slog のみ（戻りは無視可）
- [ ] **Step 2:** **Chat / Format の直後（失敗の early return より前）** に設計正本の `bill` ロジックのみを置く（他の配線例は使わない）:

```go
in, out := inTok, outTok
bill := false
switch {
case err == nil:
	bill = true
case in > 0 || out > 0:
	bill = true
case ShouldEstimateAIUsage(err):
	in, out = EstimateAIUsageTokens(AIChatEstimateInput(system, turns)) // refined: RefinedEstimateInput(draft)
	bill = true
}
if bill {
	_ = h.recordAIUsageAfterCall(r.Context(), 1, in, out)
}
if err != nil {
	// existing fail path
	return
}
```

- [ ] **Step 3:** 成功経路末尾の `AddAIUsage` を削除（append/create の後にあったもの）
- [ ] **Step 4:** ストレージ失敗でも加算済みになる配線を、ai-chat で Append 失敗スタブ（または既存 failPut 相当）により usage が増えることを Task 4 で1ケース固定
- [ ] **Step 5:** 既存 handler テスト通過
---

## Task 4: 結合テスト

**Files:** `ai_chat_handler_test.go`, `refined_handler_test.go`

- [ ] **Step 1:** ai-chat truncated + tokens → usage 増 → 再 POST 429
- [ ] **Step 2:** ai-chat 0,0 + timeout Failure → 見積もり増
- [ ] **Step 3:** ai-chat 未到達（例: 空 message で 400）→ usage 不変
- [ ] **Step 4:** refined truncated → usage 増 → 429
- [ ] **Step 5:** refined 0,0 + timeout → 見積もり増
- [ ] **Step 6:** ai-chat: Chat 成功だが Append 失敗 → 502 相当でも usage は増えている
- [ ] **Step 7:** `cd backend && go test ./internal/kanban/ ./internal/aichat/ ./internal/aiformat/ -count=1`
- [ ] **Step 8:** `cd backend && go test ./... -count=1`

## レビューで直せなかった指摘

なし。
