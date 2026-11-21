package kanban

import (
	"encoding/json"
	"math"
	"net/http"
	"strings"
)

func (h handler) getAICredits(w http.ResponseWriter, r *http.Request) {
	if _, ok := CurrentUser(r.Context()); !ok {
		reply(w, 401, map[string]string{"message": msgLoginRequired})
		return
	}
	h.replyAICredits(w, r)
}

func (h handler) putAICredits(w http.ResponseWriter, r *http.Request) {
	actor, ok := CurrentUser(r.Context())
	if !ok {
		reply(w, 401, map[string]string{"message": msgLoginRequired})
		return
	}
	if actor.Role != RoleAdmin {
		reply(w, 403, map[string]string{"message": msgForbidden})
		return
	}
	if !isJSONRequest(r) {
		reply(w, http.StatusUnsupportedMediaType, map[string]string{"message": "Content-Typeはapplication/jsonにしてください。"})
		return
	}
	var body struct {
		LimitTokens json.RawMessage `json:"limitTokens"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.LimitTokens == nil {
		invalid(w, "limitTokens が必要です。")
		return
	}
	raw := strings.TrimSpace(string(body.LimitTokens))
	if raw == "null" {
		if err := h.repo.SetAICreditLimit(r.Context(), nil); err != nil {
			fail(w, err)
			return
		}
		h.replyAICredits(w, r)
		return
	}
	lim, ok := parseAICreditLimitJSON(w, body.LimitTokens)
	if !ok {
		return
	}
	if err := h.repo.SetAICreditLimit(r.Context(), &lim); err != nil {
		fail(w, err)
		return
	}
	h.replyAICredits(w, r)
}

func (h handler) replyAICredits(w http.ResponseWriter, r *http.Request) {
	u, err := h.repo.GetAIUsage(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	// configured matches GET /api/ai/usage (chatter wired when ANTHROPIC_API_KEY is set).
	reply(w, http.StatusOK, BuildAICreditsView(u, h.chatter != nil))
}

func parseAICreditLimitJSON(w http.ResponseWriter, raw json.RawMessage) (int64, bool) {
	var num json.Number
	if err := json.Unmarshal(raw, &num); err != nil {
		invalid(w, "limitTokens は0以上の整数、または null で指定してください。")
		return 0, false
	}
	f, err := num.Float64()
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) || f != math.Trunc(f) || f < 0 || f > float64(math.MaxInt64) {
		invalid(w, "limitTokens は0以上の整数、または null で指定してください。")
		return 0, false
	}
	return int64(f), true
}

// rejectIfAICreditLimitReached writes 429 ai_credit_limit when the workspace token budget is exhausted.
// Call before acquireSlot so a rejected request does not consume the shared semaphore.
func (h handler) rejectIfAICreditLimitReached(w http.ResponseWriter, r *http.Request, writeErr func(http.ResponseWriter, int, string, string)) bool {
	u, err := h.repo.GetAIUsage(r.Context())
	if err != nil {
		fail(w, err)
		return true
	}
	if !u.CreditLimitExceeded() {
		return false
	}
	writeErr(w, http.StatusTooManyRequests, "ai_credit_limit", "AI利用上限に達しています。")
	return true
}
