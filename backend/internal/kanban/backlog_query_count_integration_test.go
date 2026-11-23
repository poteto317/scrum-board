package kanban

import (
	"context"
	"fmt"
	"testing"
)

func countBacklogReorderMeasured(t *testing.T, r MySQLRepository, order []int64) int {
	t.Helper()
	n := 0
	prev := noteBacklogReorderMeasuredSQL
	noteBacklogReorderMeasuredSQL = func() { n++ }
	t.Cleanup(func() { noteBacklogReorderMeasuredSQL = prev })
	if _, err := r.ReorderBacklog(context.Background(), order); err != nil {
		t.Fatal(err)
	}
	return n
}

func seedActiveBacklogCards(t *testing.T, r MySQLRepository, n int) []int64 {
	t.Helper()
	ctx := context.Background()
	cards, err := r.Backlog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]int64, len(cards))
	for i, c := range cards {
		ids[i] = c.ID
	}
	for len(ids) < n {
		c, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: fmt.Sprintf("backlog-q-%d", len(ids))})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, c.ID)
	}
	return ids
}

func reverseCopy(ids []int64) []int64 {
	out := make([]int64, len(ids))
	for i, id := range ids {
		out[len(ids)-1-i] = id
	}
	return out
}

func TestReorderBacklogQueryCountNearConstantMySQL(t *testing.T) {
	r := MySQLRepository{DB: mysqlTestDB(t, "")}
	ctx := context.Background()
	if err := r.InitializeItemPositions(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r.InitializeNumbers(ctx); err != nil {
		t.Fatal(err)
	}

	ids20 := seedActiveBacklogCards(t, r, 20)
	count20 := countBacklogReorderMeasured(t, r, reverseCopy(ids20))

	ids80 := seedActiveBacklogCards(t, r, 80)
	reversed80 := reverseCopy(ids80)
	count80 := countBacklogReorderMeasured(t, r, reversed80)
	assertMeasuredSQLNearConstant(t, count20, count80)

	// Same order again: CASE Exec skipped → measured count drops by 1 (no batch hook).
	countSame := countBacklogReorderMeasured(t, r, reversed80)
	if countSame != count80-1 {
		t.Fatalf("noop reorder measured=%d want %d (count80 without CASE)", countSame, count80-1)
	}
}
