package kanban

import (
	"strings"
	"testing"
)

func TestBuildIntCaseColumnUpdateSQL(t *testing.T) {
	q, args := buildIntCaseColumnUpdateSQL("position", []int64{10, 11}, []int{0, 1})
	if !strings.Contains(q, "position=CASE id") || !strings.Contains(q, "updated_at=updated_at") {
		t.Fatalf("query=%q", q)
	}
	if strings.Count(q, "WHEN ? THEN ?") != 2 {
		t.Fatalf("WHEN count: %q", q)
	}
	if len(args) != 6 || args[0] != int64(10) || args[1] != 0 || args[4] != int64(10) || args[5] != int64(11) {
		t.Fatalf("args=%v", args)
	}
}

func TestBuildIntCaseColumnUpdateSQLPanicsOnLenMismatch(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic")
		}
	}()
	buildIntCaseColumnUpdateSQL("position", []int64{1}, []int{0, 1})
}
