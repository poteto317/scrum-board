package kanban

import (
	"context"
	"errors"
	"log/slog"
	"mime"
	"net/http"
	"time"
)

const todoColumnName = "Todo"

// refinedError writes the fixed {message, code} body. It never includes upstream text, drafts or keys.
func refinedError(w http.ResponseWriter, status int, code, message string) {
	reply(w, status, map[string]string{"message": message, "code": code})
}

// aiFailed is the one response for every way the AI step can fail, so callers cannot tell failures apart or learn upstream details.
func aiFailed(w http.ResponseWriter) {
	refinedError(w, http.StatusBadGateway, "ai_failed", "AIによる整形に失敗しました。時間をおいて再試行してください。")
}

// storageFailed answers a repository failure with a fixed 500; only the stage is logged, never the error text.
func storageFailed(w http.ResponseWriter, stage string) {
	slog.Error("refined card storage failed", "stage", stage)
	refinedError(w, http.StatusInternalServerError, "server_error", "処理に失敗しました。時間をおいて再試行してください。")
}

func isJSONRequest(r *http.Request) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	return err == nil && mediaType == "application/json"
}

// aiContext limits one AI call to maxAIDuration, and to what the request has left after keeping createReserve for storing the card.
func aiContext(ctx context.Context) (context.Context, context.CancelFunc, bool) {
	limit := maxAIDuration
	if deadline, ok := ctx.Deadline(); ok {
		left := time.Until(deadline) - createReserve
		if left <= 0 {
			return ctx, func() {}, false
		}
		limit = min(limit, left)
	}
	aiCtx, cancel := context.WithTimeout(ctx, limit)
	return aiCtx, cancel, true
}

// acquireSlot takes one of the limited concurrent AI call slots without waiting.
func (h handler) acquireSlot() (release func(), ok bool) {
	select {
	case h.slots <- struct{}{}:
		return func() { <-h.slots }, true
	default:
		return nil, false
	}
}

func logFormatFailure(err error) {
	kind, status := "unknown", 0
	var failure FormatFailure
	if errors.As(err, &failure) {
		kind, status = failure.FailureKind(), failure.UpstreamStatus()
	}
	// Only the kind and status are logged: error strings may carry the key, the draft or the upstream body.
	slog.Error("ai card formatting failed", "kind", kind, "upstream_status", status)
}

// createRefinedCard files a Todo card whose title and description were tidied by the AI from the caller's draft.
func (h handler) createRefinedCard(w http.ResponseWriter, r *http.Request) {
	if !isJSONRequest(r) {
		refinedError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "Content-Typeはapplication/jsonにしてください。")
		return
	}
	var draft Draft
	if !decode(w, r, &draft) {
		return
	}
	draft, problem := normalizeDraft(draft)
	if problem != "" {
		invalid(w, problem)
		return
	}
	if h.formatter == nil {
		refinedError(w, http.StatusServiceUnavailable, "ai_not_configured", "AI整形が設定されていません。サーバーにANTHROPIC_API_KEYを設定してください。")
		return
	}
	// Resolve the column before spending money on the AI call.
	todo, err := h.repo.GetColumnByName(r.Context(), todoColumnName)
	if err != nil {
		storageFailed(w, "column")
		return
	}
	release, acquired := h.acquireSlot()
	if !acquired {
		refinedError(w, http.StatusTooManyRequests, "ai_busy", "AI整形が混み合っています。少し待って再試行してください。")
		return
	}
	defer release()
	aiCtx, cancel, hasTime := aiContext(r.Context())
	defer cancel()
	if !hasTime {
		slog.Error("ai card formatting skipped", "kind", "no_time")
		aiFailed(w)
		return
	}
	refined, err := h.formatter.Format(aiCtx, draft)
	if err != nil {
		logFormatFailure(err)
		aiFailed(w)
		return
	}
	stored, valid := normalizeRefined(draft, refined)
	if !valid {
		slog.Error("ai card formatting failed", "kind", "invalid_output", "upstream_status", 0)
		aiFailed(w)
		return
	}
	card, err := h.repo.CreateCard(r.Context(), CardInput{ColumnID: todo.ID, Title: stored.Title, Description: stored.Description})
	if err != nil {
		storageFailed(w, "create")
		return
	}
	reply(w, http.StatusCreated, card)
}
