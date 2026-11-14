package kanban

import (
	"context"
	"errors"
	"fmt"
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

// CreateCard, UpdateCard (status move / edit), DeleteCard, ReorderCards and ReorderBacklog must take locks in the same order,
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

// position (order inside a column) and backlogPosition (order of the whole backlog) are separate columns:
// reordering one must not change the other.
func TestPositionAndBacklogPositionAreIndependentMySQL(t *testing.T) {
	r, a, b := newOrderedBoard(t)
	ctx := context.Background()
	positions := func() (map[int64]int, map[int64]int) {
		board, err := r.Board(ctx)
		if err != nil {
			t.Fatal(err)
		}
		pos, backlog := map[int64]int{}, map[int64]int{}
		for _, c := range board.Cards {
			pos[c.ID], backlog[c.ID] = c.Position, c.BacklogPosition
		}
		return pos, backlog
	}
	pos0, backlog0 := positions()
	if len(backlog0) != 3 || backlog0[a.ID] >= backlog0[b.ID] {
		t.Fatalf("new cards must get increasing backlogPosition: %v", backlog0)
	}
	if _, err := r.ReorderCards(ctx, []CardColumnOrder{{ColumnID: 1, CardIDs: reverseIDs(t, r, 1)}}); err != nil {
		t.Fatal(err)
	}
	pos1, backlog1 := positions()
	if fmt.Sprint(backlog1) != fmt.Sprint(backlog0) || fmt.Sprint(pos1) == fmt.Sprint(pos0) {
		t.Fatalf("ReorderCards must change position only: pos %v -> %v, backlog %v -> %v", pos0, pos1, backlog0, backlog1)
	}
	if _, err := r.ReorderBacklog(ctx, []int64{b.ID, a.ID, 1}); err != nil {
		t.Fatal(err)
	}
	pos2, backlog2 := positions()
	if fmt.Sprint(pos2) != fmt.Sprint(pos1) || fmt.Sprint(backlog2) == fmt.Sprint(backlog1) {
		t.Fatalf("ReorderBacklog must change backlogPosition only: pos %v -> %v, backlog %v -> %v", pos1, pos2, backlog1, backlog2)
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

// Deterministic form of the lock-order rule: while another transaction holds the all-columns lock, every card writer
// must queue on it before it touches a card. Whether a bad interleaving crosses is a matter of timing (the stress
// test above finds it only some of the time); whether a writer takes the column lock first is not.
func TestCardWritersQueueOnTheAllColumnsLockMySQL(t *testing.T) {
	ctx := context.Background()
	three := int64(3)
	writers := map[string]func(r MySQLRepository, a, b Card) error{
		"CreateCard": func(r MySQLRepository, _, _ Card) error {
			_, err := r.CreateCard(ctx, CardInput{ColumnID: 1, Title: "new"})
			return err
		},
		"UpdateCard moving a card": func(r MySQLRepository, _, b Card) error {
			_, err := r.UpdateCard(ctx, b.ID, CardPatch{ColumnID: &three})
			return err
		},
		"UpdateCard rewriting the PR links": func(r MySQLRepository, _, b Card) error {
			urls := []string{"https://github.com/o/r/pull/1", "https://github.com/o/r/pull/2"}
			_, err := r.UpdateCard(ctx, b.ID, CardPatch{PRURLs: &urls})
			return err
		},
		"DeleteCard": func(r MySQLRepository, _, b Card) error { return r.DeleteCard(ctx, b.ID) },
		"ReorderCards": func(r MySQLRepository, _, _ Card) error {
			_, err := r.ReorderCards(ctx, []CardColumnOrder{{ColumnID: 1, CardIDs: reverseIDs(t, r, 1)}})
			return err
		},
		"ReorderBacklog": func(r MySQLRepository, _, _ Card) error {
			board, err := r.Board(ctx)
			if err != nil {
				return err
			}
			ids := make([]int64, 0, len(board.Cards))
			for i := len(board.Cards) - 1; i >= 0; i-- {
				ids = append(ids, board.Cards[i].ID)
			}
			_, err = r.ReorderBacklog(ctx, ids)
			return err
		},
		"ImportHistory": func(r MySQLRepository, a, _ Card) error {
			return r.ImportHistory(ctx, []HistoricalRecord{{Number: a.Number, CardID: a.ID, CreatedAt: a.CreatedAt, Key: "k", OccurredAt: a.CreatedAt, Note: "verified import"}})
		},
	}
	for name, write := range writers {
		t.Run(name, func(t *testing.T) {
			// Every case starts from a freshly reset database so one writer's effect cannot break another's.
			r, a, b := newOrderedBoard(t)
			if err := r.InitializeHistory(ctx); err != nil {
				t.Fatal(err)
			}
			holder, err := r.DB.BeginTx(ctx, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer holder.Rollback()
			if _, err = lockColumnRows(ctx, holder); err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() { done <- write(r, a, b) }()
			deadline := time.Now().Add(5 * time.Second)
			for {
				select {
				case err := <-done:
					t.Fatalf("%s finished (err=%v) while the all-columns lock was held: it does not queue on the lock first", name, err)
				default:
				}
				var status string
				var waits int
				if err = r.DB.QueryRow("SHOW GLOBAL STATUS LIKE 'Innodb_row_lock_current_waits'").Scan(&status, &waits); err != nil {
					t.Fatal(err)
				}
				if waits >= 1 {
					break
				}
				if time.Now().After(deadline) {
					t.Fatalf("%s never waited on a row lock", name)
				}
				time.Sleep(5 * time.Millisecond)
			}
			// Queued on the column lock means holding no card yet: every card row can still be locked by someone else.
			// (A writer that locked cards first and only then hit the column lock, for example through the foreign
			// key check, is exactly the order that crosses other writers.)
			probe, err := r.DB.BeginTx(ctx, nil)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = probe.ExecContext(ctx, "SELECT id FROM cards FOR UPDATE NOWAIT"); err != nil {
				probe.Rollback()
				t.Fatalf("%s holds a card lock while it waits for the all-columns lock: %v", name, err)
			}
			probe.Rollback()
			// Still queued: releasing the lock lets it finish.
			select {
			case err := <-done:
				t.Fatalf("%s finished (err=%v) before the all-columns lock was released", name, err)
			default:
			}
			holder.Rollback()
			if err = <-done; err != nil {
				t.Fatalf("%s after the lock was released: %v", name, err)
			}
		})
	}
}

// reverseIDs returns the ids of one column in the reverse of its current order.
func reverseIDs(t *testing.T, r MySQLRepository, column int64) []int64 {
	t.Helper()
	board, err := r.Board(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	cards := cardsInColumn(board.Cards, column)
	ids := make([]int64, 0, len(cards))
	for i := len(cards) - 1; i >= 0; i-- {
		ids = append(ids, cards[i].ID)
	}
	return ids
}
