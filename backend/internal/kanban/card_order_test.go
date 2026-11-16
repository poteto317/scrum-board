package kanban

import (
	"testing"
	"time"
)

func TestPlanCardReorder(t *testing.T) {
	now := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	before := Item{ID: 10, ColumnID: 1, Position: 2, OffsetY: 40}

	t.Run("skip when unchanged", func(t *testing.T) {
		plan := planCardReorder(before, 1, 2, nil, now)
		if !plan.Skip {
			t.Fatalf("want skip, got %#v", plan)
		}
	})

	t.Run("skip when offset matches", func(t *testing.T) {
		off := 40
		plan := planCardReorder(before, 1, 2, &off, now)
		if !plan.Skip {
			t.Fatalf("want skip, got %#v", plan)
		}
	})

	t.Run("position only keeps updated_at", func(t *testing.T) {
		plan := planCardReorder(before, 1, 3, nil, now)
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
		plan := planCardReorder(before, 1, 2, &off, now)
		if plan.Skip || plan.ColumnChanged || plan.NextOffset != 99 {
			t.Fatalf("got %#v", plan)
		}
		if plan.Query != "UPDATE items SET column_id=?, position=?, offset_y=?, updated_at=updated_at WHERE id=?" {
			t.Fatalf("query=%q", plan.Query)
		}
	})

	t.Run("column change sets updated_at", func(t *testing.T) {
		plan := planCardReorder(before, 2, 0, nil, now)
		if plan.Skip || !plan.ColumnChanged {
			t.Fatalf("got %#v", plan)
		}
		if plan.Query != "UPDATE items SET column_id=?, position=?, offset_y=?, updated_at=? WHERE id=?" {
			t.Fatalf("query=%q", plan.Query)
		}
		if len(plan.Args) != 5 || plan.Args[0] != int64(2) || plan.Args[1] != 0 || plan.Args[2] != 40 || plan.Args[3] != now || plan.Args[4] != int64(10) {
			t.Fatalf("args=%v", plan.Args)
		}
	})
}
