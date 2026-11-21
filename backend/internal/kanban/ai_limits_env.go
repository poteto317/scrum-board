package kanban

import (
	"log/slog"
	"strconv"
	"strings"
)

// AILimits holds optional runtime overrides for AI call guards.
type AILimits struct {
	RatePerMinute       int // 0 = rate limit off
	MessageMax          int
	HistoryTurns        int
	ChatMaxOutputTokens int
}

// DefaultAIChatMaxOutputTokens is the chat Completions maxTokens default (format uses a separate constant).
const DefaultAIChatMaxOutputTokens = 4096

// DefaultAILimits returns hard-coded defaults (rate limit off).
func DefaultAILimits() AILimits {
	return AILimits{
		RatePerMinute:       0,
		MessageMax:          maxAIChatMessageLen,
		HistoryTurns:        maxAIChatHistoryTurns,
		ChatMaxOutputTokens: DefaultAIChatMaxOutputTokens,
	}
}

// ParseAILimits reads AI_* env vars. Invalid values leave that field at its default and log a warning (L-044/L-752).
func ParseAILimits(getenv func(string) string) AILimits {
	out := DefaultAILimits()
	if getenv == nil {
		return out
	}
	if v, ok, warn := parseOptionalPositiveInt(getenv("AI_RATE_LIMIT_PER_MINUTE")); ok {
		out.RatePerMinute = v
	} else if warn != "" {
		slog.Warn("AI_RATE_LIMIT_PER_MINUTE ignored; rate limit off", "reason", warn)
	}
	if v, ok, warn := parseRequiredPositiveInt(getenv("AI_CHAT_MESSAGE_MAX")); ok {
		out.MessageMax = v
	} else if warn != "" {
		slog.Warn("AI_CHAT_MESSAGE_MAX ignored; using default", "reason", warn, "default", out.MessageMax)
	}
	if v, ok, warn := parseRequiredPositiveInt(getenv("AI_CHAT_HISTORY_TURNS")); ok {
		out.HistoryTurns = v
	} else if warn != "" {
		slog.Warn("AI_CHAT_HISTORY_TURNS ignored; using default", "reason", warn, "default", out.HistoryTurns)
	}
	if v, ok, warn := parseRequiredPositiveInt(getenv("AI_CHAT_MAX_OUTPUT_TOKENS")); ok {
		out.ChatMaxOutputTokens = v
	} else if warn != "" {
		slog.Warn("AI_CHAT_MAX_OUTPUT_TOKENS ignored; using default", "reason", warn, "default", out.ChatMaxOutputTokens)
	}
	return out
}

// parseOptionalPositiveInt: empty → unset (ok=false, warn=""); "0" → ok with 0; positive → ok; else warn.
func parseOptionalPositiveInt(raw string) (int, bool, string) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return 0, false, ""
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0, false, "not an integer"
	}
	if n < 0 {
		return 0, false, "negative"
	}
	return n, true, ""
}

// parseRequiredPositiveInt: empty → unset; must be >= 1 to apply.
func parseRequiredPositiveInt(raw string) (int, bool, string) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return 0, false, ""
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0, false, "not an integer"
	}
	if n < 1 {
		return 0, false, "must be >= 1"
	}
	return n, true, ""
}
