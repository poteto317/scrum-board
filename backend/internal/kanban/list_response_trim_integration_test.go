package kanban

import (
	"context"
	"strings"
	"testing"
)

// 一覧（Board / Backlog）は説明を先頭 listDescriptionRunes 文字に切り、ソリューションを返さない。
// 詳細（GetItem）は全文のまま。
func TestListReadsTrimDescriptionAndDropSolutionMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()

	long := strings.Repeat("あ", listDescriptionRunes+50)
	created, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "trim-seed", Description: long, Solution: "sol"})
	if err != nil {
		t.Fatal(err)
	}
	check := func(name string, items []Item) {
		t.Helper()
		for _, it := range items {
			if it.ID != created.ID {
				continue
			}
			if want := strings.Repeat("あ", listDescriptionRunes); it.Description != want {
				t.Fatalf("%s: description runes=%d", name, len([]rune(it.Description)))
			}
			if it.Solution != "" {
				t.Fatalf("%s: solution=%q", name, it.Solution)
			}
			return
		}
		t.Fatalf("%s: item %d missing", name, created.ID)
	}
	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	check("board", board.Items)
	backlog, err := r.Backlog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	check("backlog", backlog)
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	ordered, err := listOrderedCards(ctx, tx, created.ProjectID)
	if err != nil {
		t.Fatal(err)
	}
	check("ordered", ordered)
	full, err := r.GetItem(ctx, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if full.Description != long || full.Solution != "sol" {
		t.Fatalf("detail is trimmed: runes=%d solution=%q", len([]rune(full.Description)), full.Solution)
	}
}
