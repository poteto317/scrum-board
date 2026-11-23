package kanban

import (
	"context"
	"fmt"
	"testing"
)

// Measures lock→batch UPDATE SQL only (excludes listOrderedCards and history INSERT).
func countReorderMeasured(t *testing.T, r MySQLRepository, orders []ItemColumnOrder) int {
	t.Helper()
	n := 0
	prev := noteReorderMeasuredSQL
	noteReorderMeasuredSQL = func() { n++ }
	t.Cleanup(func() { noteReorderMeasuredSQL = prev })
	if _, err := r.ReorderItems(context.Background(), orders); err != nil {
		t.Fatal(err)
	}
	return n
}

func seedColumnCards(t *testing.T, r MySQLRepository, columnID int64, n int) {
	t.Helper()
	ctx := context.Background()
	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	have := 0
	for _, c := range board.Items {
		if c.ColumnID == columnID {
			have++
		}
	}
	for have < n {
		if _, err := r.CreateItem(ctx, ItemInput{ColumnID: columnID, Title: fmt.Sprintf("q-%d", have)}); err != nil {
			t.Fatal(err)
		}
		have++
	}
}

func TestReorderItemsQueryCountNearConstantMySQL(t *testing.T) {
	r := MySQLRepository{DB: mysqlTestDB(t, "")}
	ctx := context.Background()
	if err := r.InitializeItemPositions(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r.InitializeNumbers(ctx); err != nil {
		t.Fatal(err)
	}

	seedColumnCards(t, r, 1, 20)
	count20 := countReorderMeasured(t, r, []ItemColumnOrder{{ColumnID: 1, ItemIDs: reverseIDs(t, r, 1)}})

	seedColumnCards(t, r, 1, 80)
	count80 := countReorderMeasured(t, r, []ItemColumnOrder{{ColumnID: 1, ItemIDs: reverseIDs(t, r, 1)}})

	if count20 > 40 || count80 > 40 {
		t.Fatalf("query count cap 40: n20=%d n80=%d", count20, count80)
	}
	delta := count80 - count20
	if delta < 0 {
		delta = -delta
	}
	if delta > 5 {
		t.Fatalf("|count80-count20|=%d > 5 (n20=%d n80=%d)", delta, count20, count80)
	}
}
