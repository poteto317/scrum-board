package kanban

import (
	"context"
	"testing"
)

func TestMySQLAssigneeMigrationAndHistory(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	if err := r.InitializeAssignee(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r.InitializeAssignee(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r.InitializeHistory(ctx); err != nil {
		t.Fatal(err)
	}
	card, err := r.CreateCard(ctx, CardInput{Title: "assignee-it", Description: "", ColumnID: 1})
	if err != nil {
		t.Fatal(err)
	}
	if card.Assignee != "" {
		t.Fatalf("new card assignee=%q", card.Assignee)
	}
	value := "Cursor"
	updated, err := r.UpdateCard(ctx, card.ID, CardPatch{Assignee: &value})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Assignee != "Cursor" {
		t.Fatalf("updated=%+v", updated)
	}
	page, err := r.History(ctx, card.Number, 0)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, event := range page.Events {
		for _, change := range event.Changes {
			if change.Field == "assignee" && change.After == "Cursor" {
				found = true
			}
		}
	}
	if !found {
		t.Fatalf("history missing assignee change: %+v", page.Events)
	}
}
