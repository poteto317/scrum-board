package kanban

import (
	"context"
	"fmt"
	"testing"
)

func TestAppendAITurnTrimsOldestBeyond200(t *testing.T) {
	repo := fresh()
	card, err := repo.CreateItem(context.Background(), ItemInput{ColumnID: 1, Title: "t", Description: "d"})
	if err != nil {
		t.Fatal(err)
	}
	// Seed 200 messages (100 turns), then one more turn should drop the oldest two.
	for i := 0; i < 100; i++ {
		if err := repo.AppendAITurn(context.Background(), card.ID, fmt.Sprintf("u%d", i), fmt.Sprintf("a%d", i), 1, 2); err != nil {
			t.Fatalf("seed %d: %v", i, err)
		}
	}
	list, err := repo.ListAIMessages(context.Background(), card.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 200 {
		t.Fatalf("want 200, got %d", len(list))
	}
	oldestUser := list[0].Body
	if err := repo.AppendAITurn(context.Background(), card.ID, "newest-u", "newest-a", 3, 4); err != nil {
		t.Fatal(err)
	}
	list, err = repo.ListAIMessages(context.Background(), card.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 200 {
		t.Fatalf("after trim want 200, got %d", len(list))
	}
	for _, m := range list {
		if m.Body == oldestUser {
			t.Fatalf("oldest message %q should have been trimmed", oldestUser)
		}
	}
	if list[len(list)-2].Body != "newest-u" || list[len(list)-1].Body != "newest-a" {
		t.Fatalf("tail=%+v %+v", list[len(list)-2], list[len(list)-1])
	}
	if list[len(list)-1].InputTokens == nil || *list[len(list)-1].InputTokens != 3 {
		t.Fatalf("tokens=%v", list[len(list)-1].InputTokens)
	}
}

func TestHardDeleteItemRemovesAIMessagesMemory(t *testing.T) {
	// Memory repo mirrors MySQL ON DELETE CASCADE for item_ai_messages.
	repo := fresh()
	card, err := repo.CreateItem(context.Background(), ItemInput{ColumnID: 1, Title: "t", Description: "d"})
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.AppendAITurn(context.Background(), card.ID, "hello", "hi", 1, 1); err != nil {
		t.Fatal(err)
	}
	list, err := repo.ListAIMessages(context.Background(), card.ID)
	if err != nil || len(list) != 2 {
		t.Fatalf("list=%v err=%v", list, err)
	}
	if err := repo.HardDeleteItem(context.Background(), card.ID); err != nil {
		t.Fatal(err)
	}
	list, err = repo.ListAIMessages(context.Background(), card.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Fatalf("want cascade clear, got %d", len(list))
	}
}

func TestHardDeleteItemRemovesAIMessagesMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	repo := MySQLRepository{DB: db}
	card, err := repo.CreateItem(t.Context(), ItemInput{ColumnID: 1, Title: "t", Description: "d"})
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.AppendAITurn(t.Context(), card.ID, "hello", "hi", 5, 6); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM item_ai_messages WHERE item_id=?`, card.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("want 2, got %d", n)
	}
	if err := repo.DeleteItem(t.Context(), card.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM item_ai_messages WHERE item_id=?`, card.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("soft delete should keep messages, got %d", n)
	}
	if err := repo.HardDeleteItem(t.Context(), card.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM item_ai_messages WHERE item_id=?`, card.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("hard delete cascade want 0, got %d", n)
	}
}

func TestAddAndGetAIUsage(t *testing.T) {
	repo := fresh()
	if err := repo.AddAIUsage(context.Background(), 1, 10, 20); err != nil {
		t.Fatal(err)
	}
	if err := repo.AddAIUsage(context.Background(), 2, 5, 7); err != nil {
		t.Fatal(err)
	}
	u, err := repo.GetAIUsage(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if u.RequestCount != 3 || u.InputTokens != 15 || u.OutputTokens != 27 {
		t.Fatalf("usage=%+v", u)
	}
}
