package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func seedCards(repo *memoryRepo) {
	repo.cards[1] = Card{ID: 1, Number: 1, ColumnID: 1, Title: "a", Position: 0}
	repo.cards[2] = Card{ID: 2, Number: 2, ColumnID: 1, Title: "b", Position: 1}
	repo.cards[3] = Card{ID: 3, Number: 3, ColumnID: 2, Title: "c", Position: 0}
	repo.next = 4
}

func TestReorderCardsHandler(t *testing.T) {
	repo := fresh()
	seedCards(repo)
	h := NewHandler(repo)

	w := request(h, "PUT", "/api/cards/order", `{"columns":[{"columnId":1,"cardIds":[2,1]}]}`)
	if w.Code != 200 {
		t.Fatalf("reorder: %d %s", w.Code, w.Body)
	}
	var out struct {
		Cards []Card `json:"cards"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Cards) != 3 {
		t.Fatalf("want all cards, got %d", len(out.Cards))
	}
	todo := cardsInColumn(out.Cards, 1)
	if len(todo) != 2 || todo[0].ID != 2 || todo[1].ID != 1 {
		t.Fatalf("todo order: %+v", todo)
	}

	w = request(h, "PUT", "/api/cards/order", `{"columns":[{"columnId":1,"cardIds":[2]},{"columnId":2,"cardIds":[1,3]}]}`)
	if w.Code != 200 {
		t.Fatalf("cross-column: %d %s", w.Code, w.Body)
	}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if c := repo.cards[1]; c.ColumnID != 2 || c.Position != 0 {
		t.Fatalf("moved card: %+v", c)
	}
	doing := cardsInColumn(out.Cards, 2)
	if len(doing) != 2 || doing[0].ID != 1 || doing[1].ID != 3 {
		t.Fatalf("doing order: %+v", doing)
	}

	w = request(h, "PUT", "/api/cards/order", `{"columns":[{"columnId":2,"cardIds":[]},{"columnId":1,"cardIds":[2,1,3]}]}`)
	if w.Code != 200 {
		t.Fatalf("empty column: %d %s", w.Code, w.Body)
	}
}

func TestReorderCardsValidationAndConflict(t *testing.T) {
	repo := fresh()
	seedCards(repo)
	h := NewHandler(repo)
	cases := []struct {
		name, body string
		status     int
	}{
		{"missing columns", `{}`, 400},
		{"null columns", `{"columns":null}`, 400},
		{"empty columns", `{"columns":[]}`, 400},
		{"null cardIds", `{"columns":[{"columnId":1,"cardIds":null}]}`, 400},
		{"duplicate card", `{"columns":[{"columnId":1,"cardIds":[1,1]}]}`, 400},
		{"duplicate column", `{"columns":[{"columnId":1,"cardIds":[1]},{"columnId":1,"cardIds":[2]}]}`, 400},
		{"zero column", `{"columns":[{"columnId":0,"cardIds":[]}]}`, 400},
		{"zero card", `{"columns":[{"columnId":1,"cardIds":[0]}]}`, 400},
		{"unknown field", `{"columns":[{"columnId":1,"cardIds":[1]}],"oops":1}`, 400},
		{"mismatch drop card", `{"columns":[{"columnId":1,"cardIds":[1]}]}`, 409},
		{"mismatch unknown card", `{"columns":[{"columnId":1,"cardIds":[1,2,99]}]}`, 409},
		{"unknown column", `{"columns":[{"columnId":99,"cardIds":[]}]}`, 409},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := request(h, "PUT", "/api/cards/order", tc.body)
			if w.Code != tc.status {
				t.Fatalf("status=%d body=%s", w.Code, w.Body)
			}
		})
	}
}

type cardOrderFailureRepo struct {
	*memoryRepo
	err error
}

func (r cardOrderFailureRepo) ReorderCards(context.Context, []CardColumnOrder) ([]Card, error) {
	return nil, r.err
}

func TestReorderCardsStorageFailure(t *testing.T) {
	secret := "internal-card-order-db-failure"
	r := cardOrderFailureRepo{memoryRepo: fresh(), err: errors.New(secret)}
	seedCards(r.memoryRepo)
	w := request(NewHandler(r), "PUT", "/api/cards/order", `{"columns":[{"columnId":1,"cardIds":[2,1]}]}`)
	if w.Code != 500 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	if strings.Contains(w.Body.String(), secret) {
		t.Fatalf("leaked: %s", w.Body.String())
	}
}

func cardsInColumn(cards []Card, columnID int64) []Card {
	out := []Card{}
	for _, c := range cards {
		if c.ColumnID == columnID {
			out = append(out, c)
		}
	}
	return out
}
