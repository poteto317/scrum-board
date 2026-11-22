package kanban

import "context"

// applyAIUsageAfterCall records provider usage or an estimate after a model call.
// Local invalid_request with 0 tokens is skipped. Add failures are logged only.
func (h handler) applyAIUsageAfterCall(ctx context.Context, err error, inTok, outTok int64, estimateInput string) {
	in, out := inTok, outTok
	bill := false
	switch {
	case err == nil:
		bill = true
	case in > 0 || out > 0:
		bill = true
	case ShouldEstimateAIUsage(err):
		in, out = EstimateAIUsageTokens(estimateInput)
		bill = true
	}
	if bill {
		_ = h.recordAIUsageAfterCall(ctx, 1, in, out)
	}
}
