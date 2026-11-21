package kanban

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
)

// aiChatError writes the fixed {message, code} body. It never includes upstream text.
func aiChatError(w http.ResponseWriter, status int, code, message string) {
	reply(w, status, map[string]string{"message": message, "code": code})
}

func aiChatFailed(w http.ResponseWriter) {
	aiChatError(w, http.StatusBadGateway, "ai_failed", "AIチャットに失敗しました。時間をおいて再試行してください。")
}

func logChatFailure(err error) {
	kind, status := "unknown", 0
	var failure FormatFailure
	if errors.As(err, &failure) {
		kind, status = failure.FailureKind(), failure.UpstreamStatus()
	}
	slog.Error("ai chat failed", "kind", kind, "upstream_status", status)
}

func (h handler) aiChatParentItem(w http.ResponseWriter, r *http.Request) (Item, bool) {
	number, ok := taskNumber(w, r)
	if !ok {
		return Item{}, false
	}
	pid, err := h.resolveByNumberProjectID(r)
	if err != nil {
		fail(w, err)
		return Item{}, false
	}
	card, err := h.repo.GetItemByNumber(r.Context(), number, pid)
	if err != nil {
		fail(w, err)
		return Item{}, false
	}
	if _, ok := h.requireEdit(w, r, card); !ok {
		return Item{}, false
	}
	return card, true
}

func (h handler) listAIChat(w http.ResponseWriter, r *http.Request) {
	card, ok := h.aiChatParentItem(w, r)
	if !ok {
		return
	}
	list, err := h.repo.ListAIMessages(r.Context(), card.ID)
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, http.StatusOK, map[string]any{"messages": list})
}

func (h handler) clearAIChat(w http.ResponseWriter, r *http.Request) {
	card, ok := h.aiChatParentItem(w, r)
	if !ok {
		return
	}
	if err := h.repo.ClearAIMessages(r.Context(), card.ID); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type aiChatRequest struct {
	Message string `json:"message"`
}

func (h handler) postAIChat(w http.ResponseWriter, r *http.Request) {
	if !isJSONRequest(r) {
		aiChatError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "Content-Typeはapplication/jsonにしてください。")
		return
	}
	var req aiChatRequest
	if !decode(w, r, &req) {
		return
	}
	msg, ok := NormalizeAIChatMessage(req.Message, h.messageMax)
	if !ok {
		invalid(w, fmt.Sprintf("メッセージは1〜%d文字で、制御文字を含めず入力してください。", h.messageMax))
		return
	}
	card, ok := h.aiChatParentItem(w, r)
	if !ok {
		return
	}
	if h.chatter == nil {
		aiChatError(w, http.StatusServiceUnavailable, "ai_not_configured", "AIチャットが設定されていません。サーバーにANTHROPIC_API_KEYを設定してください。")
		return
	}
	if h.rejectIfAICreditLimitReached(w, r, aiChatError) {
		return
	}
	rateUser, rateAt, rateReserved, rateLimited := h.reserveAIRateLimit(r)
	if rateLimited {
		writeAIRateLimited(w, aiChatError)
		return
	}
	release, acquired := h.acquireSlot()
	if !acquired {
		h.releaseAIRateLimit(rateUser, rateAt, rateReserved)
		aiChatError(w, http.StatusTooManyRequests, "ai_busy", "AIが混み合っています。少し待って再試行してください。")
		return
	}
	defer release()

	comments, err := h.repo.ListComments(r.Context(), card.ID)
	if err != nil {
		h.releaseAIRateLimit(rateUser, rateAt, rateReserved)
		fail(w, err)
		return
	}
	history, err := h.repo.ListAIMessages(r.Context(), card.ID)
	if err != nil {
		h.releaseAIRateLimit(rateUser, rateAt, rateReserved)
		fail(w, err)
		return
	}
	system := buildAIChatSystem(card, comments)
	turns := selectAIChatHistoryForModel(history, h.historyTurns)
	turns = append(turns, ChatTurn{Role: AIRoleUser, Body: msg})

	aiCtx, cancel, hasTime := aiContext(r.Context())
	defer cancel()
	if !hasTime {
		h.releaseAIRateLimit(rateUser, rateAt, rateReserved)
		slog.Error("ai chat skipped", "kind", "no_time")
		aiChatFailed(w)
		return
	}
	replyText, inTok, outTok, err := h.chatter.Chat(aiCtx, system, turns)
	if err != nil {
		logChatFailure(err)
		aiChatFailed(w)
		return
	}
	if err := h.repo.AppendAITurn(r.Context(), card.ID, msg, replyText, inTok, outTok); err != nil {
		slog.Error("ai chat storage failed", "stage", "append")
		aiChatError(w, http.StatusInternalServerError, "server_error", "処理に失敗しました。時間をおいて再試行してください。")
		return
	}
	// Usage is best-effort after append: failing here must not 500 (would invite retry-duplicate turns).
	if err := h.repo.AddAIUsage(r.Context(), 1, inTok, outTok); err != nil {
		slog.Error("ai chat usage add failed", "stage", "usage")
	}
	list, err := h.repo.ListAIMessages(r.Context(), card.ID)
	if err != nil {
		// Turn is already stored; avoid 500 so clients do not retry and duplicate.
		slog.Error("ai chat list after append failed", "stage", "list")
		assistant := AIMessage{Role: AIRoleAssistant, Body: replyText}
		if inTok > 0 {
			v := int(inTok)
			assistant.InputTokens = &v
		}
		if outTok > 0 {
			v := int(outTok)
			assistant.OutputTokens = &v
		}
		reply(w, http.StatusOK, map[string]any{
			"assistant": assistant,
			"messages":  append(append([]AIMessage{}, history...), AIMessage{Role: AIRoleUser, Body: msg}, assistant),
		})
		return
	}
	var assistant AIMessage
	if len(list) > 0 {
		assistant = list[len(list)-1]
	}
	reply(w, http.StatusOK, map[string]any{
		"assistant": assistant,
		"messages":  list,
	})
}

func (h handler) getAIUsage(w http.ResponseWriter, r *http.Request) {
	if _, ok := CurrentUser(r.Context()); !ok {
		reply(w, 401, map[string]string{"message": msgLoginRequired})
		return
	}
	u, err := h.repo.GetAIUsage(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, http.StatusOK, map[string]any{
		"requestCount": u.RequestCount,
		"inputTokens":  u.InputTokens,
		"outputTokens": u.OutputTokens,
		"configured":   h.chatter != nil,
	})
}
