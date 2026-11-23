package kanban

import (
	"strings"
	"testing"
)

func TestBuildCompactPositionBatchSQL(t *testing.T) {
	q, args := buildCompactPositionBatchSQL([]int64{10, 11, 12})
	if !strings.Contains(q, "updated_at=updated_at") || !strings.Contains(q, "position=CASE id") {
		t.Fatalf("query=%q", q)
	}
	// 3 WHEN pairs + 3 ids in IN
	if len(args) != 9 {
		t.Fatalf("args len=%d want 9: %v", len(args), args)
	}
	if args[0] != int64(10) || args[1] != 0 || args[6] != int64(10) {
		t.Fatalf("args=%v", args)
	}
}
