package kanban

import (
	"context"
	"errors"
	"fmt"
	"testing"
)

// boardSnapshot is everything a rejected reorder must leave untouched: card placement, updated_at and history.
func boardSnapshot(t *testing.T, r MySQLRepository) string {
	t.Helper()
	rows, err := r.DB.Query("SELECT id,column_id,position,updated_at FROM cards ORDER BY id")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := ""
	for rows.Next() {
		var id, col int64
		var pos int
		var updated any
		if err = rows.Scan(&id, &col, &pos, &updated); err != nil {
			t.Fatal(err)
		}
		out += fmt.Sprintf("card %d col=%d pos=%d updated=%v\n", id, col, pos, updated)
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	var n, maxID int64
	if err = r.DB.QueryRow("SELECT COUNT(*), COALESCE(MAX(id),0) FROM card_history").Scan(&n, &maxID); err != nil {
		t.Fatal(err)
	}
	return out + fmt.Sprintf("history rows=%d max=%d\n", n, maxID)
}

// ReorderItems answers 409 (ErrItemOrderMismatch) when the client's card set differs from the database, and
// 400 (ErrItemOrder) for a malformed request. Either way nothing is written.
func TestReorderItemsRejectsStaleSetMySQL(t *testing.T) {
	r, a, b := newOrderedBoard(t) // Todo: seed, a, b
	ctx := context.Background()
	d, err := r.CreateItem(ctx, ItemInput{ColumnID: 2, Title: "d"}) // Doing
	if err != nil {
		t.Fatal(err)
	}
	e, err := r.CreateItem(ctx, ItemInput{ColumnID: 3, Title: "e"}) // Done
	if err != nil {
		t.Fatal(err)
	}
	seed := int64(1)
	cases := []struct {
		name   string
		orders []ItemColumnOrder
		want   error
	}{
		{"omits a card of the column (stale screen)", []ItemColumnOrder{{ColumnID: 1, ItemIDs: []int64{seed, a.ID}}}, ErrItemOrderMismatch},
		{"empty list for a non-empty column", []ItemColumnOrder{{ColumnID: 1, ItemIDs: []int64{}}}, ErrItemOrderMismatch},
		{"card of an unsent column, same count", []ItemColumnOrder{{ColumnID: 1, ItemIDs: []int64{seed, a.ID, d.ID}}}, ErrItemOrderMismatch},
		{"card of an unsent column, extra", []ItemColumnOrder{{ColumnID: 1, ItemIDs: []int64{seed, a.ID, b.ID, e.ID}}}, ErrItemOrderMismatch},
		{"unknown card id, same count", []ItemColumnOrder{{ColumnID: 1, ItemIDs: []int64{seed, a.ID, 9999}}}, ErrItemOrderMismatch},
		{"unknown column id", []ItemColumnOrder{{ColumnID: 9999, ItemIDs: []int64{}}}, ErrItemOrderMismatch},
		{"unknown column after a valid one", []ItemColumnOrder{{ColumnID: 1, ItemIDs: []int64{b.ID, a.ID, seed}}, {ColumnID: 9999, ItemIDs: []int64{}}}, ErrItemOrderMismatch},
		{"invalid second column after a valid move", []ItemColumnOrder{{ColumnID: 1, ItemIDs: []int64{b.ID, a.ID, seed}}, {ColumnID: 2, ItemIDs: []int64{d.ID, 9999}}}, ErrItemOrderMismatch},
		{"duplicate card across columns", []ItemColumnOrder{{ColumnID: 1, ItemIDs: []int64{seed, a.ID, b.ID}}, {ColumnID: 2, ItemIDs: []int64{d.ID, a.ID}}}, ErrItemOrder},
		{"duplicate column", []ItemColumnOrder{{ColumnID: 1, ItemIDs: []int64{seed}}, {ColumnID: 1, ItemIDs: []int64{a.ID, b.ID}}}, ErrItemOrder},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := boardSnapshot(t, r)
			if _, err := r.ReorderItems(ctx, tc.orders); !errors.Is(err, tc.want) {
				t.Fatalf("want %v, got %v", tc.want, err)
			}
			if after := boardSnapshot(t, r); after != before {
				t.Fatalf("rejected reorder changed the database:\nbefore:\n%s\nafter:\n%s", before, after)
			}
		})
	}

	// The same sets are accepted once they are complete (moving d into Todo while leaving Doing empty is legal).
	if _, err = r.ReorderItems(ctx, []ItemColumnOrder{
		{ColumnID: 1, ItemIDs: []int64{d.ID, seed, a.ID, b.ID}},
		{ColumnID: 2, ItemIDs: []int64{}},
	}); err != nil {
		t.Fatalf("complete set rejected: %v", err)
	}

	// The HTTP contract over the real repository: stale set -> 409, malformed -> 400, DB untouched.
	h := NewHandler(r)
	before := boardSnapshot(t, r)
	if w := request(h, "PUT", "/api/items/order", fmt.Sprintf(`{"columns":[{"columnId":1,"itemIds":[%d]}]}`, seed)); w.Code != 409 {
		t.Fatalf("stale set: %d %s", w.Code, w.Body)
	}
	if w := request(h, "PUT", "/api/items/order", fmt.Sprintf(`{"columns":[{"columnId":1,"itemIds":[%d,%d]},{"columnId":2,"itemIds":[%d]}]}`, seed, a.ID, a.ID)); w.Code != 400 {
		t.Fatalf("duplicate card: %d %s", w.Code, w.Body)
	}
	if after := boardSnapshot(t, r); after != before {
		t.Fatalf("rejected HTTP reorder changed the database:\n%s\n%s", before, after)
	}
}
