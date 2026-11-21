package kanban

import "testing"

func TestParseAILimitsDefaults(t *testing.T) {
	got := ParseAILimits(func(string) string { return "" })
	want := DefaultAILimits()
	if got != want {
		t.Fatalf("got %+v want %+v", got, want)
	}
	got = ParseAILimits(func(string) string { return "   " })
	if got != want {
		t.Fatalf("whitespace-only: got %+v want %+v", got, want)
	}
}

func TestParseAILimitsRateZeroAndPositive(t *testing.T) {
	got := ParseAILimits(func(k string) string {
		if k == "AI_RATE_LIMIT_PER_MINUTE" {
			return "0"
		}
		return ""
	})
	if got.RatePerMinute != 0 {
		t.Fatalf("rate=%d", got.RatePerMinute)
	}
	got = ParseAILimits(func(k string) string {
		if k == "AI_RATE_LIMIT_PER_MINUTE" {
			return " 12 "
		}
		return ""
	})
	if got.RatePerMinute != 12 {
		t.Fatalf("rate=%d", got.RatePerMinute)
	}
}

func TestParseAILimitsInvalidKeepsDefault(t *testing.T) {
	got := ParseAILimits(func(k string) string {
		switch k {
		case "AI_RATE_LIMIT_PER_MINUTE":
			return "abc"
		case "AI_CHAT_MESSAGE_MAX":
			return "0"
		case "AI_CHAT_HISTORY_TURNS":
			return "-1"
		case "AI_CHAT_MAX_OUTPUT_TOKENS":
			return "x"
		default:
			return ""
		}
	})
	want := DefaultAILimits()
	if got != want {
		t.Fatalf("got %+v want %+v", got, want)
	}
}

func TestParseAILimitsAllSet(t *testing.T) {
	got := ParseAILimits(func(k string) string {
		switch k {
		case "AI_RATE_LIMIT_PER_MINUTE":
			return "5"
		case "AI_CHAT_MESSAGE_MAX":
			return "2000"
		case "AI_CHAT_HISTORY_TURNS":
			return "10"
		case "AI_CHAT_MAX_OUTPUT_TOKENS":
			return "2048"
		default:
			return ""
		}
	})
	if got.RatePerMinute != 5 || got.MessageMax != 2000 || got.HistoryTurns != 10 || got.ChatMaxOutputTokens != 2048 {
		t.Fatalf("got %+v", got)
	}
}
