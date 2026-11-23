package kanban

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func countCompactMeasured(t *testing.T, r MySQLRepository, moveID int64, toColumn int64) int {
	t.Helper()
	n := 0
	prev := noteCompactMeasuredSQL
	noteCompactMeasuredSQL = func() { n++ }
	t.Cleanup(func() { noteCompactMeasuredSQL = prev })
	if _, err := r.UpdateItem(context.Background(), moveID, ItemPatch{ColumnID: &toColumn}); err != nil {
		t.Fatal(err)
	}
	return n
}

func seedColumnCardsExact(t *testing.T, r MySQLRepository, columnID int64, n int) []int64 {
	t.Helper()
	ctx := context.Background()
	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var ids []int64
	for _, c := range board.Items {
		if c.ColumnID == columnID {
			ids = append(ids, c.ID)
		}
	}
	for len(ids) < n {
		c, err := r.CreateItem(ctx, ItemInput{ColumnID: columnID, Title: fmt.Sprintf("compact-q-%d", len(ids))})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, c.ID)
	}
	return ids
}

func TestCompactColumnPositionsQueryCountNearConstantMySQL(t *testing.T) {
	r := MySQLRepository{DB: mysqlTestDB(t, "")}
	ctx := context.Background()
	if err := r.InitializeItemPositions(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r.InitializeNumbers(ctx); err != nil {
		t.Fatal(err)
	}

	// Leave n cards in column 1 after moving one to column 2.
	ids21 := seedColumnCardsExact(t, r, 1, 21)
	count20 := countCompactMeasured(t, r, ids21[0], 2)

	seedColumnCardsExact(t, r, 1, 81)
	// Prefer a card still in column 1 (first seed may already be in col 2).
	var moveID int64
	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range board.Items {
		if c.ColumnID == 1 {
			moveID = c.ID
			break
		}
	}
	if moveID == 0 {
		t.Fatal("no card in column 1")
	}
	count80 := countCompactMeasured(t, r, moveID, 2)
	assertMeasuredSQLNearConstant(t, count20, count80)
}

func TestCompactPreservesUpdatedAtOfRemainingCardsMySQL(t *testing.T) {
	r := MySQLRepository{DB: mysqlTestDB(t, "")}
	ctx := context.Background()
	if err := r.InitializeItemPositions(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r.InitializeNumbers(ctx); err != nil {
		t.Fatal(err)
	}
	a, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "a"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "b"})
	if err != nil {
		t.Fatal(err)
	}
	c, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "c"})
	if err != nil {
		t.Fatal(err)
	}
	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	before := map[int64]time.Time{}
	for _, it := range board.Items {
		if it.ColumnID == 1 {
			before[it.ID] = it.UpdatedAt
		}
	}
	if _, err = r.UpdateItem(ctx, b.ID, ItemPatch{ColumnID: int64Ptr(2)}); err != nil {
		t.Fatal(err)
	}
	board, err = r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, it := range board.Items {
		if it.ID == a.ID || it.ID == c.ID {
			if !it.UpdatedAt.Equal(before[it.ID]) {
				t.Fatalf("compact changed updated_at id=%d", it.ID)
			}
		}
	}
}
