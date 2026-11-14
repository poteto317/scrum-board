package kanban

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// newOrderedBoard resets the disposable DB and returns a repository with two cards in Todo.
func newOrderedBoard(t *testing.T) (MySQLRepository, Card, Card) {
	t.Helper()
	r := MySQLRepository{DB: mysqlTestDB(t, "")}
	ctx := context.Background()
	if err := r.InitializeCardPositions(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r.InitializeNumbers(ctx); err != nil {
		t.Fatal(err)
	}
	a, err := r.CreateCard(ctx, CardInput{ColumnID: 1, Title: "a"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := r.CreateCard(ctx, CardInput{ColumnID: 1, Title: "b"})
	if err != nil {
		t.Fatal(err)
	}
	return r, a, b
}

// CreateCard, UpdateCard (status move / edit), DeleteCard and ReorderCards must take locks in the same order,
// otherwise InnoDB reports error 1213 (deadlock) under concurrent use.
func TestCardWritesDoNotDeadlockMySQL(t *testing.T) {
	r, a, b := newOrderedBoard(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	errCh := make(chan error, 400)
	run := func(f func() error) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errCh <- f()
		}()
	}
	for i := 0; i < 60; i++ {
		col := int64(1 + i%3)
		moveTo := int64(2 + i%2)
		title := "edited"
		run(func() error {
			_, err := r.CreateCard(ctx, CardInput{ColumnID: col, Title: "n"})
			return err
		})
		run(func() error {
			_, err := r.UpdateCard(ctx, b.ID, CardPatch{ColumnID: &moveTo})
			return err
		})
		run(func() error {
			// A reorder that raced with a create/move legitimately reports a stale card set.
			if err := reverseAllColumns(ctx, r); !errors.Is(err, ErrCardOrderMismatch) {
				return err
			}
			return nil
		})
		run(func() error {
			_, err := r.UpdateCard(ctx, a.ID, CardPatch{Title: &title})
			return err
		})
		run(func() error {
			c, err := r.CreateCard(ctx, CardInput{ColumnID: col, Title: "d"})
			if err != nil {
				return err
			}
			return r.DeleteCard(ctx, c.ID)
		})
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		// A reorder that raced with a create/move legitimately reports a stale card set.
		if err != nil && !errors.Is(err, ErrCardOrderMismatch) {
			t.Fatalf("concurrent write failed: %v", err)
		}
	}
	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// DeleteCard leaves a gap (positions stay unique and ordered; the next reorder renumbers them densely).
	for _, column := range []int64{1, 2, 3} {
		prev := -1
		for _, c := range cardsInColumn(board.Cards, column) {
			if c.Position <= prev {
				t.Fatalf("column %d positions not strictly increasing: %+v", column, cardsInColumn(board.Cards, column))
			}
			prev = c.Position
		}
	}
}

// The test above fires reorders from a possibly stale board, which nearly always end in a stale-set rejection after
// the all-columns lock and the card scan. This one makes reorders succeed (rebuild from the current board and retry)
// while cards are created and moved, so the write path after the set check (UPDATE, history, commit) also runs
// concurrently with the other writers.
func TestSuccessfulReordersRunAlongsideWritesMySQL(t *testing.T) {
	r, _, b := newOrderedBoard(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	var reordered atomic.Int64
	errCh := make(chan error, 200)
	run := func(f func() error) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errCh <- f()
		}()
	}
	for i := 0; i < 20; i++ {
		col := int64(1 + i%3)
		moveTo := int64(2 + i%2)
		run(func() error {
			_, err := r.CreateCard(ctx, CardInput{ColumnID: col, Title: "n"})
			return err
		})
		run(func() error {
			_, err := r.UpdateCard(ctx, b.ID, CardPatch{ColumnID: &moveTo})
			return err
		})
		run(func() error {
			for attempt := 0; attempt < 30; attempt++ {
				err := reverseAllColumns(ctx, r)
				if err == nil {
					reordered.Add(1)
					return nil
				}
				if !errors.Is(err, ErrCardOrderMismatch) {
					return err
				}
			}
			return nil
		})
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		if err != nil {
			t.Fatalf("concurrent write failed: %v", err)
		}
	}
	if reordered.Load() == 0 {
		t.Fatal("no ReorderCards succeeded, so the write path after the card-set check never ran concurrently")
	}
	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// A successful reorder renumbers its columns densely; later creates and moves append at the end.
	for _, column := range []int64{1, 2, 3} {
		prev := -1
		for _, c := range cardsInColumn(board.Cards, column) {
			if c.Position <= prev {
				t.Fatalf("column %d positions not strictly increasing: %+v", column, cardsInColumn(board.Cards, column))
			}
			prev = c.Position
		}
	}
}

// reverseAllColumns reads the board and reorders columns 1-3 into the reverse of the order it just read.
func reverseAllColumns(ctx context.Context, r MySQLRepository) error {
	board, err := r.Board(ctx)
	if err != nil {
		return err
	}
	orders := make([]CardColumnOrder, 0, 3)
	for _, column := range []int64{1, 2, 3} {
		ids := []int64{}
		cards := cardsInColumn(board.Cards, column)
		for j := len(cards) - 1; j >= 0; j-- {
			ids = append(ids, cards[j].ID)
		}
		orders = append(orders, CardColumnOrder{ColumnID: column, CardIDs: ids})
	}
	_, err = r.ReorderCards(ctx, orders)
	return err
}

func TestUnknownColumnIsRejectedMySQL(t *testing.T) {
	r, a, _ := newOrderedBoard(t)
	ctx := context.Background()
	missing := int64(9999)
	if _, err := r.UpdateCard(ctx, a.ID, CardPatch{ColumnID: &missing}); !errors.Is(err, ErrColumn) {
		t.Fatalf("UpdateCard want ErrColumn, got %v", err)
	}
	if _, err := r.CreateCard(ctx, CardInput{ColumnID: missing, Title: "x"}); !errors.Is(err, ErrColumn) {
		t.Fatalf("CreateCard want ErrColumn, got %v", err)
	}
}

func updatedAtByID(t *testing.T, r MySQLRepository) map[int64]time.Time {
	t.Helper()
	board, err := r.Board(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	m := map[int64]time.Time{}
	for _, c := range board.Cards {
		m[c.ID] = c.UpdatedAt
	}
	return m
}

// Only a card whose status changes counts as updated; reordering or compacting must not touch updatedAt.
func TestReorderKeepsUpdatedAtOfUnmovedCardsMySQL(t *testing.T) {
	r, a, b := newOrderedBoard(t)
	ctx := context.Background()
	c, err := r.CreateCard(ctx, CardInput{ColumnID: 1, Title: "c"})
	if err != nil {
		t.Fatal(err)
	}
	// The schema seeds one sample card in Todo, so Todo holds seed, a, b, c here.
	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	seed := cardsInColumn(board.Cards, 1)[0]
	time.Sleep(20 * time.Millisecond)
	before := updatedAtByID(t, r)

	if _, err = r.ReorderCards(ctx, []CardColumnOrder{{ColumnID: 1, CardIDs: []int64{c.ID, a.ID, b.ID, seed.ID}}}); err != nil {
		t.Fatal(err)
	}
	after := updatedAtByID(t, r)
	for _, id := range []int64{a.ID, b.ID, c.ID, seed.ID} {
		if !after[id].Equal(before[id]) {
			t.Fatalf("within-column reorder changed updatedAt of card %d: %v -> %v", id, before[id], after[id])
		}
	}

	// Moving one card to another column through reorder updates that card only.
	if _, err = r.ReorderCards(ctx, []CardColumnOrder{
		{ColumnID: 1, CardIDs: []int64{c.ID, b.ID, seed.ID}},
		{ColumnID: 2, CardIDs: []int64{a.ID}},
	}); err != nil {
		t.Fatal(err)
	}
	moved := updatedAtByID(t, r)
	if !moved[a.ID].After(after[a.ID]) {
		t.Fatalf("cross-column move must update updatedAt: %v -> %v", after[a.ID], moved[a.ID])
	}
	for _, id := range []int64{b.ID, c.ID, seed.ID} {
		if !moved[id].Equal(after[id]) {
			t.Fatalf("untouched card %d changed updatedAt: %v -> %v", id, after[id], moved[id])
		}
	}

	// A status change through UpdateCard compacts the source column: the remaining cards keep updatedAt.
	time.Sleep(20 * time.Millisecond)
	three := int64(3)
	if _, err = r.UpdateCard(ctx, c.ID, CardPatch{ColumnID: &three}); err != nil {
		t.Fatal(err)
	}
	last := updatedAtByID(t, r)
	if !last[b.ID].Equal(moved[b.ID]) {
		t.Fatalf("compaction changed updatedAt of card %d: %v -> %v", b.ID, moved[b.ID], last[b.ID])
	}
	board, err = r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for i, got := range cardsInColumn(board.Cards, 1) {
		if got.Position != i {
			t.Fatalf("source column not compacted: %+v", cardsInColumn(board.Cards, 1))
		}
	}
	for _, id := range []int64{b.ID, seed.ID} {
		if !last[id].Equal(moved[id]) {
			t.Fatalf("compaction changed updatedAt of card %d: %v -> %v", id, moved[id], last[id])
		}
	}
}

// DeleteCard joins the all-columns lock, so it reports a missing card the same way and still cascades.
func TestDeleteCardMySQL(t *testing.T) {
	r, a, _ := newOrderedBoard(t)
	ctx := context.Background()
	if err := r.DeleteCard(ctx, 99999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing card want ErrNotFound, got %v", err)
	}
	if err := r.DeleteCard(ctx, a.ID); err != nil {
		t.Fatal(err)
	}
	if err := r.DeleteCard(ctx, a.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete want ErrNotFound, got %v", err)
	}
	var rest int
	if err := r.DB.QueryRow("SELECT (SELECT COUNT(*) FROM card_history WHERE card_id=?)+(SELECT COUNT(*) FROM card_numbers WHERE card_id=?)", a.ID, a.ID).Scan(&rest); err != nil || rest != 0 {
		t.Fatalf("history/number cascade: %d %v", rest, err)
	}
}
