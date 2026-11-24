package kanban

import (
	"strings"
	"testing"
	"time"
)

func TestPlanCardReorder(t *testing.T) {
	now := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	before := Item{ID: 10, ColumnID: 1, Position: 2, OffsetY: 40}

	t.Run("skip when unchanged", func(t *testing.T) {
		plan := planCardReorder(before, 1, 2, nil, now, false, false)
		if !plan.Skip {
			t.Fatalf("want skip, got %#v", plan)
		}
	})

	t.Run("skip when offset matches", func(t *testing.T) {
		off := 40
		plan := planCardReorder(before, 1, 2, &off, now, false, false)
		if !plan.Skip {
			t.Fatalf("want skip, got %#v", plan)
		}
	})

	t.Run("position only keeps updated_at", func(t *testing.T) {
		plan := planCardReorder(before, 1, 3, nil, now, false, false)
		if plan.Skip || plan.ColumnChanged {
			t.Fatalf("got %#v", plan)
		}
		if plan.Query != "UPDATE items SET column_id=?, position=?, offset_y=?, updated_at=updated_at WHERE id=?" {
			t.Fatalf("query=%q", plan.Query)
		}
		if len(plan.Args) != 4 || plan.Args[0] != int64(1) || plan.Args[1] != 3 || plan.Args[2] != 40 || plan.Args[3] != int64(10) {
			t.Fatalf("args=%v", plan.Args)
		}
	})

	t.Run("offset change keeps updated_at", func(t *testing.T) {
		off := 99
		plan := planCardReorder(before, 1, 2, &off, now, false, false)
		if plan.Skip || plan.ColumnChanged || plan.NextOffset != 99 {
			t.Fatalf("got %#v", plan)
		}
		if plan.Query != "UPDATE items SET column_id=?, position=?, offset_y=?, updated_at=updated_at WHERE id=?" {
			t.Fatalf("query=%q", plan.Query)
		}
	})

	t.Run("column change sets updated_at", func(t *testing.T) {
		plan := planCardReorder(before, 2, 0, nil, now, false, false)
		if plan.Skip || !plan.ColumnChanged {
			t.Fatalf("got %#v", plan)
		}
		if plan.Query != "UPDATE items SET column_id=?, position=?, offset_y=?, done_at=?, updated_at=? WHERE id=?" {
			t.Fatalf("query=%q", plan.Query)
		}
		if len(plan.Args) != 6 || plan.Args[0] != int64(2) || plan.Args[1] != 0 || plan.Args[2] != 40 || plan.Args[3] != (*time.Time)(nil) || plan.Args[4] != now || plan.Args[5] != int64(10) {
			t.Fatalf("args=%v", plan.Args)
		}
	})

	t.Run("entering Done starts timer", func(t *testing.T) {
		plan := planCardReorder(before, 2, 0, nil, now, false, true)
		if plan.DoneAt == nil || !plan.DoneAt.Equal(now) {
			t.Fatalf("doneAt=%v", plan.DoneAt)
		}
	})

	t.Run("leaving Done clears timer", func(t *testing.T) {
		doneAt := now.Add(-time.Hour)
		done := before
		done.DoneAt = &doneAt
		plan := planCardReorder(done, 2, 0, nil, now, true, false)
		if plan.DoneAt != nil {
			t.Fatalf("doneAt=%v", plan.DoneAt)
		}
	})
}

func TestBuildCardReorderBatchSQL(t *testing.T) {
	now := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	rows := []appliedCardReorder{
		{ID: 10, ColumnID: 1, Position: 0, Plan: cardReorderPlan{NextOffset: 0}},
		{ID: 11, ColumnID: 1, Position: 1, Plan: cardReorderPlan{NextOffset: 40}},
	}
	q, args := buildCardReorderBatchSQL(rows, false, now)
	if !strings.Contains(q, "updated_at=updated_at") || strings.Contains(q, "done_at=") {
		t.Fatalf("same-col query=%q", q)
	}
	if len(args) != 14 { // 3 CASE pairs ×2 rows + 2 ids
		t.Fatalf("args len=%d want 14: %v", len(args), args)
	}
	moved := []appliedCardReorder{
		{ID: 10, ColumnID: 2, Position: 0, Plan: cardReorderPlan{NextOffset: 0, DoneAt: &now}},
	}
	q, args = buildCardReorderBatchSQL(moved, true, now)
	if !strings.Contains(q, "done_at=") || !strings.Contains(q, "updated_at=CASE") {
		t.Fatalf("moved query=%q", q)
	}
	if len(args) != 11 { // 5 CASE pairs + 1 id
		t.Fatalf("moved args len=%d want 11: %v", len(args), args)
	}
}

func TestPlanCardReorderKeepsTheFinishedTimeBetweenFinishedColumns(t *testing.T) {
	now := time.Now().UTC()
	doneAt := now.Add(-time.Hour)
	card := Item{ID: 1, ColumnID: 2, DoneAt: &doneAt}
	// source and target are both finished (Done -> Close): the time is kept.
	if plan := planCardReorder(card, 3, 0, nil, now, true, true); plan.DoneAt == nil || !plan.DoneAt.Equal(doneAt) {
		t.Fatalf("Done->Close doneAt=%v; want %v", plan.DoneAt, doneAt)
	}
	// Close -> Todo clears it.
	if plan := planCardReorder(card, 1, 0, nil, now, true, false); plan.DoneAt != nil {
		t.Fatalf("Close->Todo doneAt=%v; want nil", plan.DoneAt)
	}
}
