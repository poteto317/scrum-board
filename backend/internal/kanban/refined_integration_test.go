package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

func TestMySQLRefinedCardIsFiledInTodoWithHistory(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	if err := r.InitializeHistory(ctx); err != nil {
		t.Fatal(err)
	}
	h := NewHandler(r, WithCardFormatter(&fakeFormatter{fn: ok("整えた題名", "整えた説明")}))
	w := postJSON(h, `{"title":"下書き","description":"下書き説明"}`)
	var card Card
	if err := json.Unmarshal(w.Body.Bytes(), &card); err != nil || w.Code != 201 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	todo, err := r.GetColumnByName(ctx, "Todo")
	if err != nil || card.ColumnID != todo.ID || card.Title != "整えた題名" || card.Description != "整えた説明" || card.PRURL != "" {
		t.Fatalf("card=%+v todo=%+v err=%v", card, todo, err)
	}
	page, err := r.History(ctx, card.Number, 0)
	if err != nil || len(page.Events) != 1 || page.Events[0].Kind != "created" {
		t.Fatalf("history=%+v err=%v", page, err)
	}
}

func TestMySQLRefinedCardFailureWritesNothingAndKeepsTheNumber(t *testing.T) {
	captureLogs(t) // the expected failures are logged; keep them out of the test output
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	mustInit(t, r)
	count := func() (cards, next int) {
		if err := db.QueryRow("SELECT COUNT(*) FROM cards").Scan(&cards); err != nil {
			t.Fatal(err)
		}
		if err := db.QueryRow("SELECT next_number FROM card_number_sequence WHERE singleton=1").Scan(&next); err != nil {
			t.Fatal(err)
		}
		return
	}
	cardsBefore, nextBefore := count()
	failing := &fakeFormatter{fn: func(context.Context, Draft) (RefinedCard, error) { return RefinedCard{}, errors.New("upstream down") }}
	if w := postJSON(NewHandler(r, WithCardFormatter(failing)), `{"title":"下書き"}`); w.Code != 502 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	unusable := &fakeFormatter{fn: ok("", "")}
	if w := postJSON(NewHandler(r, WithCardFormatter(unusable)), `{"title":"下書き"}`); w.Code != 502 {
		t.Fatalf("unusable output: status=%d", w.Code)
	}
	if cards, next := count(); cards != cardsBefore || next != nextBefore {
		t.Fatalf("a failed request changed the database: cards %d→%d, next number %d→%d", cardsBefore, cards, nextBefore, next)
	}
}
