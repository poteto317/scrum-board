package kanban

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestUnknownStatusResultListsTheColumnNames(t *testing.T) {
	out := unknownStatusResult([]Column{{ID: 1, Name: "Todo"}, {ID: 2, Name: "Doing"}})
	if out.Total != 0 || out.Truncated || out.Items == nil || len(out.Items) != 0 {
		t.Fatalf("nothing is found: %+v", out)
	}
	if len(out.AvailableStatuses) != 2 || out.AvailableStatuses[0] != "Todo" || out.AvailableStatuses[1] != "Doing" {
		t.Fatalf("statuses=%v", out.AvailableStatuses)
	}
	// 列が 1 つも無くても、JSON の形（items は配列）は保つ。
	text := searchItemsResultText(unknownStatusResult(nil), 1000)
	if !strings.Contains(text, `"items":[]`) || strings.Contains(text, "availableStatuses") {
		t.Fatalf("text=%s", text)
	}
}

func TestLookedAtMatchesCutsToTheMaximum(t *testing.T) {
	if got, more := lookedAtMatches(make([]Item, maxItemSearchMatches)); more || len(got) != maxItemSearchMatches {
		t.Fatalf("exactly the maximum: len=%d more=%v", len(got), more)
	}
	if got, more := lookedAtMatches(make([]Item, maxItemSearchMatches+1)); !more || len(got) != maxItemSearchMatches {
		t.Fatalf("one more than the maximum: len=%d more=%v", len(got), more)
	}
	if got, more := lookedAtMatches(nil); more || len(got) != 0 {
		t.Fatalf("no match: len=%d more=%v", len(got), more)
	}
}

// 収まらなければ、切った JSON。空でも収まらなければ、固定の文言のエラー。
func TestSearchItemsResultTextFallsBackToTheBudgetError(t *testing.T) {
	out := searchItemsOut{Total: 2, Items: []searchItemOut{{Number: 1, Title: strings.Repeat("あ", 300)}, {Number: 2, Title: "b"}}}
	whole := searchItemsResultText(out, 10000)
	var decoded searchItemsOut
	if err := json.Unmarshal([]byte(whole), &decoded); err != nil || len(decoded.Items) != 2 || decoded.Truncated {
		t.Fatalf("whole: err=%v %s", err, whole)
	}
	cut := searchItemsResultText(out, len([]rune(whole))-1)
	if err := json.Unmarshal([]byte(cut), &decoded); err != nil || len(decoded.Items) != 1 || !decoded.Truncated {
		t.Fatalf("cut: err=%v %s", err, cut)
	}
	if got := searchItemsResultText(out, 5); got != toolErrorResult(toolErrBudget) {
		t.Fatalf("no room at all: %s", got)
	}
}

func TestGetItemResultTextFallsBackToTheBudgetError(t *testing.T) {
	now := time.Date(2026, 11, 26, 0, 0, 0, 0, time.UTC)
	item := Item{Number: 12, Title: "t", Description: strings.Repeat("d", 500), CreatedAt: now, UpdatedAt: now}
	comments := []Comment{{Author: "a", Body: "old", CreatedAt: now}, {Author: "b", Body: "new", CreatedAt: now}}
	whole := getItemResultText(item, comments, nil, 16000)
	var decoded getItemOut
	if err := json.Unmarshal([]byte(whole), &decoded); err != nil || len(decoded.Comments) != 2 || decoded.Comments[0].Body != "new" || decoded.Truncated {
		t.Fatalf("whole: err=%v %s", err, whole)
	}
	cut := getItemResultText(item, comments, nil, len([]rune(whole))-1)
	if err := json.Unmarshal([]byte(cut), &decoded); err != nil || len(decoded.Comments) != 1 || decoded.Comments[0].Body != "new" || !decoded.Truncated {
		t.Fatalf("the oldest comment goes first: err=%v %s", err, cut)
	}
	if got := getItemResultText(item, comments, nil, 5); got != toolErrorResult(toolErrBudget) {
		t.Fatalf("no room at all: %s", got)
	}
}

// getItemResultText is the text getItemResultWithDescription hands the model.
func getItemResultText(item Item, comments []Comment, columns []Column, limit int) string {
	text, _ := getItemResultWithDescription(item, comments, columns, limit)
	return text
}

// fitGetItem is fitGetItemOut encoded, as getItemResultWithDescription encodes it.
func fitGetItem(item Item, comments []Comment, columns []Column, limit int) (string, bool) {
	out, ok := fitGetItemOut(item, comments, columns, limit)
	if !ok {
		return "", false
	}
	return toolJSON(out), true
}
