package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"sync"
	"testing"
	"time"
)

func TestCardOrderMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	if err := r.InitializeCardPositions(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r.InitializeNumbers(ctx); err != nil {
		t.Fatal(err)
	}

	// Sample card from schema starts at position 0 in Todo.
	c1, err := r.CreateCard(ctx, CardInput{ColumnID: 1, Title: "second", Description: ""})
	if err != nil {
		t.Fatal(err)
	}
	c2, err := r.CreateCard(ctx, CardInput{ColumnID: 1, Title: "third", Description: ""})
	if err != nil {
		t.Fatal(err)
	}
	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	todo := cardsInColumn(board.Cards, 1)
	if len(todo) != 3 || todo[0].Position != 0 || todo[1].ID != c1.ID || todo[2].ID != c2.ID {
		t.Fatalf("create order: %+v", todo)
	}

	sampleID := todo[0].ID
	cards, err := r.ReorderCards(ctx, []CardColumnOrder{
		{ColumnID: 1, CardIDs: []int64{c2.ID, sampleID, c1.ID}},
	})
	if err != nil {
		t.Fatal(err)
	}
	todo = cardsInColumn(cards, 1)
	if todo[0].ID != c2.ID || todo[1].ID != sampleID || todo[2].ID != c1.ID {
		t.Fatalf("reorder: %+v", todo)
	}

	// Idempotent Initialize after reorder must not wipe positions.
	before := map[int64]int{}
	for _, c := range todo {
		before[c.ID] = c.Position
	}
	if err = r.InitializeCardPositions(ctx); err != nil {
		t.Fatal(err)
	}
	board, err = r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range cardsInColumn(board.Cards, 1) {
		if before[c.ID] != c.Position {
			t.Fatalf("backfill wiped position for %d: %d -> %d", c.ID, before[c.ID], c.Position)
		}
	}

	// Cross-column move + history only on column change.
	pageBefore, err := r.History(ctx, c2.Number, 0)
	if err != nil {
		t.Fatal(err)
	}
	siblingBefore, err := r.History(ctx, c1.Number, 0)
	if err != nil {
		t.Fatal(err)
	}
	_, err = r.ReorderCards(ctx, []CardColumnOrder{
		{ColumnID: 1, CardIDs: []int64{sampleID, c1.ID}},
		{ColumnID: 2, CardIDs: []int64{c2.ID}},
	})
	if err != nil {
		t.Fatal(err)
	}
	pageAfter, err := r.History(ctx, c2.Number, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(pageAfter.Events) != len(pageBefore.Events)+1 {
		t.Fatalf("history delta for moved card: before=%d after=%d", len(pageBefore.Events), len(pageAfter.Events))
	}
	// c1 stays in Todo (its position shifts up) when c2 leaves: no history for it.
	pageSame, err := r.History(ctx, c1.Number, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(pageSame.Events) != len(siblingBefore.Events) {
		t.Fatalf("a sibling's move must not add history to c1: before=%d after=%d", len(siblingBefore.Events), len(pageSame.Events))
	}

	_, err = r.ReorderCards(ctx, []CardColumnOrder{
		{ColumnID: 1, CardIDs: []int64{c1.ID, sampleID}},
	})
	if err != nil {
		t.Fatal(err)
	}
	pageAfterReorder, err := r.History(ctx, c1.Number, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(pageAfterReorder.Events) != len(pageSame.Events) {
		t.Fatalf("within-column reorder must not add history: before=%d after=%d", len(pageSame.Events), len(pageAfterReorder.Events))
	}

	// UpdateCard column change appends to end.
	moved, err := r.UpdateCard(ctx, sampleID, CardPatch{ColumnID: int64Ptr(2)})
	if err != nil {
		t.Fatal(err)
	}
	if moved.ColumnID != 2 || moved.Position != 1 {
		t.Fatalf("update move: %+v", moved)
	}

	if _, err = r.ReorderCards(ctx, []CardColumnOrder{{ColumnID: 1, CardIDs: []int64{999}}}); !errors.Is(err, ErrCardOrderMismatch) {
		t.Fatalf("want mismatch, got %v", err)
	}

	h := NewHandler(r)
	payload, _ := json.Marshal(map[string]any{
		"columns": []map[string]any{{"columnId": 2, "cardIds": []int64{c2.ID, sampleID}}},
	})
	w := request(h, "PUT", "/api/cards/order", string(payload))
	if w.Code != 200 {
		t.Fatalf("http reorder: %d %s", w.Code, w.Body)
	}

	var wg sync.WaitGroup
	errCh := make(chan error, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			order := []int64{c2.ID, sampleID}
			if i%2 == 0 {
				order = []int64{sampleID, c2.ID}
			}
			_, err := r.ReorderCards(ctx, []CardColumnOrder{{ColumnID: 2, CardIDs: order}})
			errCh <- err
		}(i)
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		if err != nil {
			t.Fatal(err)
		}
	}
	board, err = r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	doing := cardsInColumn(board.Cards, 2)
	if len(doing) != 2 {
		t.Fatalf("doing cards: %+v", doing)
	}
	seenPos := map[int]struct{}{}
	for i, c := range doing {
		if c.Position != i {
			t.Fatalf("position not dense: %+v", doing)
		}
		if _, ok := seenPos[c.Position]; ok {
			t.Fatalf("duplicate position: %+v", doing)
		}
		seenPos[c.Position] = struct{}{}
	}
}

func int64Ptr(v int64) *int64 { return &v }

// idsByPosition lists a column's card ids in position order and fails unless the positions are exactly 0..n-1.
func idsByPosition(t *testing.T, r MySQLRepository, column int64) []int64 {
	t.Helper()
	board, err := r.Board(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	cards := cardsInColumn(board.Cards, column)
	ids := make([]int64, len(cards))
	seen := make([]bool, len(cards))
	for _, c := range cards {
		if c.Position < 0 || c.Position >= len(cards) || seen[c.Position] {
			t.Fatalf("column %d positions are not 0..%d: %+v", column, len(cards)-1, cards)
		}
		seen[c.Position] = true
		ids[c.Position] = c.ID
	}
	return ids
}

// A move between columns through ReorderCards is a status change: it is recorded as an update of that card,
// stamped with the time of the move, and it names the two columns.
func TestReorderCardsColumnMoveHistoryMySQL(t *testing.T) {
	r, a, b := newOrderedBoard(t)
	ctx := context.Background()
	created, err := r.History(ctx, a.Number, 0)
	if err != nil || len(created.Events) != 1 || created.Events[0].Kind != "created" {
		t.Fatalf("history after create: %+v, %v", created, err)
	}
	siblingBefore, err := r.History(ctx, b.Number, 0)
	if err != nil {
		t.Fatal(err)
	}
	seed := idsByPosition(t, r, 1)[0]

	time.Sleep(20 * time.Millisecond)
	start := time.Now().UTC()
	if _, err = r.ReorderCards(ctx, []CardColumnOrder{
		{ColumnID: 1, CardIDs: []int64{seed, b.ID}},
		{ColumnID: 2, CardIDs: []int64{a.ID}},
	}); err != nil {
		t.Fatal(err)
	}
	end := time.Now().UTC()

	page, err := r.History(ctx, a.Number, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Events) != 2 {
		t.Fatalf("want created + one move, got %+v", page.Events)
	}
	move, first := page.Events[0], page.Events[1]
	if first.Kind != "created" || first.ID != created.Events[0].ID {
		t.Fatalf("the earlier event must stay the creation: %+v", first)
	}
	if move.Kind != "updated" {
		t.Fatalf("a column move is an update, got kind %q", move.Kind)
	}
	if len(move.Changes) != 1 || move.Changes[0] != (HistoryChange{Field: "status", Before: "Todo", After: "Doing"}) {
		t.Fatalf("a column move changes only the status: %+v", move.Changes)
	}
	// The move happened between start and end, not at the card's creation or edit time before it.
	if move.OccurredAt.Before(start.Add(-time.Millisecond)) || move.OccurredAt.After(end.Add(time.Millisecond)) {
		t.Fatalf("occurredAt %v is outside the move window %v .. %v", move.OccurredAt, start, end)
	}
	if !move.OccurredAt.After(first.OccurredAt) {
		t.Fatalf("occurredAt %v must be after the creation %v", move.OccurredAt, first.OccurredAt)
	}
	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range board.Cards {
		if c.ID == a.ID && !c.UpdatedAt.Equal(move.OccurredAt) {
			t.Fatalf("occurredAt %v must match the card's updatedAt %v", move.OccurredAt, c.UpdatedAt)
		}
	}
	// The card that only lost a neighbour has nothing new in its history.
	sibling, err := r.History(ctx, b.Number, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(sibling.Events) != len(siblingBefore.Events) {
		t.Fatalf("a sibling's history must not change: %+v", sibling.Events)
	}
}

// Closing the gap a status change leaves follows the board order (position), not the order the cards were created in.
func TestStatusChangeCompactsSourceColumnInPositionOrderMySQL(t *testing.T) {
	r, a, b := newOrderedBoard(t)
	ctx := context.Background()
	c, err := r.CreateCard(ctx, CardInput{ColumnID: 1, Title: "c"})
	if err != nil {
		t.Fatal(err)
	}
	seed := idsByPosition(t, r, 1)[0]
	// The board reads c, b, a, seed: the reverse of the order the cards were created in.
	if _, err = r.ReorderCards(ctx, []CardColumnOrder{{ColumnID: 1, CardIDs: []int64{c.ID, b.ID, a.ID, seed}}}); err != nil {
		t.Fatal(err)
	}
	if got := idsByPosition(t, r, 1); !slices.Equal(got, []int64{c.ID, b.ID, a.ID, seed}) {
		t.Fatalf("setup order: %v", got)
	}

	// b sits second; moving it away leaves a gap that must close without reshuffling c, a and seed.
	if _, err = r.UpdateCard(ctx, b.ID, CardPatch{ColumnID: int64Ptr(2)}); err != nil {
		t.Fatal(err)
	}
	if got := idsByPosition(t, r, 1); !slices.Equal(got, []int64{c.ID, a.ID, seed}) {
		t.Fatalf("source column order after the move: %v, want %v", got, []int64{c.ID, a.ID, seed})
	}
	if got := idsByPosition(t, r, 2); !slices.Equal(got, []int64{b.ID}) {
		t.Fatalf("target column: %v", got)
	}
}

// A PATCH that names the card's current column is an edit, not a move: the card keeps its place and nothing
// is recorded as a status change.
func TestUpdateCardWithItsCurrentColumnKeepsItsPlaceMySQL(t *testing.T) {
	r, a, b := newOrderedBoard(t)
	ctx := context.Background()
	seed := idsByPosition(t, r, 1)[0]
	want := []int64{seed, a.ID, b.ID}
	if got := idsByPosition(t, r, 1); !slices.Equal(got, want) {
		t.Fatalf("setup order: %v", got)
	}
	before, err := r.History(ctx, a.Number, 0)
	if err != nil {
		t.Fatal(err)
	}

	title := "a, renamed"
	updated, err := r.UpdateCard(ctx, a.ID, CardPatch{ColumnID: int64Ptr(1), Title: &title})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Title != title || updated.ColumnID != 1 || updated.Position != 1 {
		t.Fatalf("the card is renamed in place: %+v", updated)
	}
	if got := idsByPosition(t, r, 1); !slices.Equal(got, want) {
		t.Fatalf("order after a same-column PATCH: %v, want %v", got, want)
	}
	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range board.Cards {
		if c.ID == b.ID && c.Position != 2 {
			t.Fatalf("a neighbour's position moved: %+v", c)
		}
	}
	after, err := r.History(ctx, a.Number, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Events) != len(before.Events)+1 {
		t.Fatalf("want exactly the title edit recorded: %+v", after.Events)
	}
	for _, ch := range after.Events[0].Changes {
		if ch.Field == "status" {
			t.Fatalf("a same-column PATCH must not record a status change: %+v", after.Events[0])
		}
	}
	if len(after.Events[0].Changes) != 1 || after.Events[0].Changes[0].Field != "title" {
		t.Fatalf("only the title changed: %+v", after.Events[0].Changes)
	}
}
