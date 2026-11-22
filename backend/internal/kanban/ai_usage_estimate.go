package kanban

import (
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"
)

// EstimateAIUsageTokens approximates provider usage when no Usage was returned.
// Input is ceil(runes/4) with a minimum of 1; output is always 0.
func EstimateAIUsageTokens(input string) (inTok, outTok int64) {
	n := utf8.RuneCountInString(input)
	inTok = int64((n + 3) / 4)
	if inTok < 1 {
		inTok = 1
	}
	return inTok, 0
}

// ShouldEstimateAIUsage reports whether a failed call should bill an estimate.
// Local invalid_request (Status==0 and Kind==invalid_request) is false; other failures are true.
func ShouldEstimateAIUsage(err error) bool {
	if err == nil {
		return false
	}
	var failure FormatFailure
	if errors.As(err, &failure) {
		if failure.UpstreamStatus() == 0 && failure.FailureKind() == "invalid_request" {
			return false
		}
		return true
	}
	return true
}

// AIChatEstimateInput builds the estimate string from the same pieces sent to the model.
func AIChatEstimateInput(system string, turns []ChatTurn) string {
	var b strings.Builder
	b.WriteString(system)
	for _, t := range turns {
		b.WriteString(t.Body)
	}
	return b.String()
}

// RefinedEstimateInput builds the estimate string from the draft JSON sent to the model.
func RefinedEstimateInput(draft Draft) string {
	raw, err := json.Marshal(draft)
	if err != nil {
		return draft.Title + "\n" + draft.Description
	}
	return string(raw)
}
