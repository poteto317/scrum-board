package kanban

import (
	"strings"
	"testing"
)

func TestBuildBacklogReorderBatchSQL(t *testing.T) {
	rows := []backlogPositionAssign{{ID: 5, Position: 0}, {ID: 7, Position: 1}}
	q, args := buildBacklogReorderBatchSQL(rows)
	if !strings.Contains(q, "backlog_position=CASE id") || !strings.Contains(q, "updated_at=updated_at") {
		t.Fatalf("query=%q", q)
	}
	if len(args) != 6 {
		t.Fatalf("args len=%d want 6: %v", len(args), args)
	}
}

func TestChangedBacklogAssignments(t *testing.T) {
	current := map[int64]int{5: 0, 7: 1}
	got := changedBacklogAssignments(current, []int64{7, 5})
	if len(got) != 2 || got[0].ID != 7 || got[0].Position != 0 || got[1].ID != 5 || got[1].Position != 1 {
		t.Fatalf("got=%v", got)
	}
	if len(changedBacklogAssignments(current, []int64{5, 7})) != 0 {
		t.Fatal("unchanged order should yield empty")
	}
	missing := changedBacklogAssignments(current, []int64{5, 99})
	if len(missing) != 1 || missing[0].ID != 99 || missing[0].Position != 1 {
		t.Fatalf("missing id: %v", missing)
	}
}
