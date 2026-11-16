package kanban

import (
	"context"
	"testing"
)

func TestBoardSettingsFreeToPackAndReorderOffsetYsMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()

	low, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "low-y", Description: ""})
	if err != nil {
		t.Fatal(err)
	}
	high, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "high-y", Description: ""})
	if err != nil {
		t.Fatal(err)
	}
	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	todo := cardsInColumn(board.Items, 1)
	if len(todo) < 3 {
		t.Fatalf("want seed + 2 cards, got %+v", todo)
	}
	seed := todo[0]
	// Position order: seed, low, high — but offsetYs put high visually above low.
	offs := []int{0, 300, 50}
	cards, err := r.ReorderItems(ctx, []ItemColumnOrder{{
		ColumnID: 1,
		ItemIDs:  []int64{seed.ID, low.ID, high.ID},
		OffsetYs: &offs,
	}})
	if err != nil {
		t.Fatal(err)
	}
	byID := map[int64]Item{}
	for _, c := range cardsInColumn(cards, 1) {
		byID[c.ID] = c
	}
	if byID[seed.ID].OffsetY != 0 || byID[low.ID].OffsetY != 300 || byID[high.ID].OffsetY != 50 {
		t.Fatalf("ReorderItems offsetYs: %+v", byID)
	}
	if byID[seed.ID].Position != 0 || byID[low.ID].Position != 1 || byID[high.ID].Position != 2 {
		t.Fatalf("ReorderItems positions (payload order): %+v", byID)
	}

	if _, _, err = r.UpdateBoardSettings(ctx, BoardSettings{CardLayout: CardLayoutFree}); err != nil {
		t.Fatal(err)
	}
	settings, packed, err := r.UpdateBoardSettings(ctx, BoardSettings{CardLayout: CardLayoutPack})
	if err != nil {
		t.Fatal(err)
	}
	if settings.CardLayout != CardLayoutPack {
		t.Fatalf("settings=%+v", settings)
	}
	todo = cardsInColumn(packed, 1)
	// free→pack reassigns position by offset_y, position, id: seed@0, high@50, low@300
	if len(todo) != 3 || todo[0].ID != seed.ID || todo[1].ID != high.ID || todo[2].ID != low.ID {
		t.Fatalf("free→pack position order by offsetY: %+v", todo)
	}
	for i, c := range todo {
		if c.Position != i {
			t.Fatalf("packed position[%d]=%d want %d (%+v)", i, c.Position, i, todo)
		}
	}
	if todo[0].OffsetY != 0 || todo[1].OffsetY != 50 || todo[2].OffsetY != 300 {
		t.Fatalf("offsetY must be preserved on free→pack: %+v", todo)
	}
}
