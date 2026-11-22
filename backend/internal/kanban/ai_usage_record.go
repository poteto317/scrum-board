package kanban

import (
	"context"
	"log/slog"
)

// recordAIUsageAfterCall adds usage after a model call. Failures are logged only (L-575).
func (h handler) recordAIUsageAfterCall(ctx context.Context, requests, inTok, outTok int64) error {
	if err := h.repo.AddAIUsage(ctx, requests, inTok, outTok); err != nil {
		slog.Error("ai usage add failed", "error", err)
		return err
	}
	return nil
}
