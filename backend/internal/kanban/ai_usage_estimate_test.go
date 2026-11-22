package kanban

import (
	"errors"
	"strings"
	"testing"
)

type stubFailure struct {
	kind   string
	status int
}

func (f stubFailure) Error() string       { return "stub:" + f.kind }
func (f stubFailure) FailureKind() string { return f.kind }
func (f stubFailure) UpstreamStatus() int { return f.status }

func TestEstimateAIUsageTokens(t *testing.T) {
	in, out := EstimateAIUsageTokens("")
	if in != 1 || out != 0 {
		t.Fatalf("empty: %d %d", in, out)
	}
	in, out = EstimateAIUsageTokens("abcd") // 4 runes
	if in != 1 || out != 0 {
		t.Fatalf("4 runes: %d %d", in, out)
	}
	in, out = EstimateAIUsageTokens("abcde") // 5 → ceil 2
	if in != 2 || out != 0 {
		t.Fatalf("5 runes: %d %d", in, out)
	}
}

func TestShouldEstimateAIUsage(t *testing.T) {
	if ShouldEstimateAIUsage(nil) {
		t.Fatal("nil")
	}
	if ShouldEstimateAIUsage(stubFailure{kind: "invalid_request", status: 0}) {
		t.Fatal("local invalid_request")
	}
	if !ShouldEstimateAIUsage(stubFailure{kind: "timeout", status: 0}) {
		t.Fatal("timeout")
	}
	if !ShouldEstimateAIUsage(stubFailure{kind: "invalid_output", status: 0}) {
		t.Fatal("invalid_output status 0")
	}
	if !ShouldEstimateAIUsage(stubFailure{kind: "invalid_request", status: 400}) {
		t.Fatal("API invalid_request")
	}
	if !ShouldEstimateAIUsage(errors.New("plain")) {
		t.Fatal("non-Failure")
	}
}

func TestAIChatEstimateInput(t *testing.T) {
	got := AIChatEstimateInput("SYS", []ChatTurn{{Body: "a"}, {Body: "b"}})
	if got != "SYSab" {
		t.Fatalf("%q", got)
	}
}

func TestRefinedEstimateInput(t *testing.T) {
	got := RefinedEstimateInput(Draft{Title: "t", Description: "d"})
	if !strings.Contains(got, "t") || !strings.Contains(got, "d") {
		t.Fatalf("%q", got)
	}
}
