package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
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
	pageSame, err := r.History(ctx, c1.Number, 0)
	if err != nil {
		t.Fatal(err)
	}
	// Within-column-only cards should not gain history from the reorder of others;
	// c1 stayed in column 1 — reorder of siblings doesn't touch c1 column.
	_ = pageSame

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
