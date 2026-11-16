package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
)

func seedCards(repo *memoryRepo) {
	repo.cards[1] = Item{ID: 1, Number: 1, ColumnID: 1, Title: "a", Position: 0}
	repo.cards[2] = Item{ID: 2, Number: 2, ColumnID: 1, Title: "b", Position: 1}
	repo.cards[3] = Item{ID: 3, Number: 3, ColumnID: 2, Title: "c", Position: 0}
	repo.next = 4
}

func TestReorderItemsHandler(t *testing.T) {
	repo := fresh()
	seedCards(repo)
	h := NewHandler(repo)

	w := request(h, "PUT", "/api/items/order", `{"columns":[{"columnId":1,"itemIds":[2,1]}]}`)
	if w.Code != 200 {
		t.Fatalf("reorder: %d %s", w.Code, w.Body)
	}
	var out struct {
		Items []Item `json:"items"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Items) != 3 {
		t.Fatalf("want all cards, got %d", len(out.Items))
	}
	todo := cardsInColumn(out.Items, 1)
	if len(todo) != 2 || todo[0].ID != 2 || todo[1].ID != 1 {
		t.Fatalf("todo order: %+v", todo)
	}

	w = request(h, "PUT", "/api/items/order", `{"columns":[{"columnId":1,"itemIds":[2]},{"columnId":2,"itemIds":[1,3]}]}`)
	if w.Code != 200 {
		t.Fatalf("cross-column: %d %s", w.Code, w.Body)
	}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if c := repo.cards[1]; c.ColumnID != 2 || c.Position != 0 {
		t.Fatalf("moved card: %+v", c)
	}
	doing := cardsInColumn(out.Items, 2)
	if len(doing) != 2 || doing[0].ID != 1 || doing[1].ID != 3 {
		t.Fatalf("doing order: %+v", doing)
	}

	w = request(h, "PUT", "/api/items/order", `{"columns":[{"columnId":2,"itemIds":[]},{"columnId":1,"itemIds":[2,1,3]}]}`)
	if w.Code != 200 {
		t.Fatalf("empty column: %d %s", w.Code, w.Body)
	}
}

func TestReorderItemsValidationAndConflict(t *testing.T) {
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
		{"null itemIds", `{"columns":[{"columnId":1,"itemIds":null}]}`, 400},
		{"duplicate card", `{"columns":[{"columnId":1,"itemIds":[1,1]}]}`, 400},
		{"duplicate column", `{"columns":[{"columnId":1,"itemIds":[1]},{"columnId":1,"itemIds":[2]}]}`, 400},
		{"zero column", `{"columns":[{"columnId":0,"itemIds":[]}]}`, 400},
		{"zero card", `{"columns":[{"columnId":1,"itemIds":[0]}]}`, 400},
		{"unknown field", `{"columns":[{"columnId":1,"itemIds":[1]}],"oops":1}`, 400},
		{"mismatch drop card", `{"columns":[{"columnId":1,"itemIds":[1]}]}`, 409},
		{"mismatch unknown card", `{"columns":[{"columnId":1,"itemIds":[1,2,99]}]}`, 409},
		{"unknown column", `{"columns":[{"columnId":99,"itemIds":[]}]}`, 409},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := request(h, "PUT", "/api/items/order", tc.body)
			if w.Code != tc.status {
				t.Fatalf("status=%d body=%s", w.Code, w.Body)
			}
		})
	}
}

// The Go tests decode into Item, which uses the same struct tags as the encoder, so renaming a tag would cancel out
// there. The client reads these exact keys, so the raw JSON is checked.
func TestCardPositionJSONKey(t *testing.T) {
	repo := fresh()
	seedCards(repo)
	late := repo.cards[3]
	late.Position = 7
	repo.cards[3] = late
	h := NewHandler(repo)

	positions := func(w *httptest.ResponseRecorder) map[float64]float64 {
		t.Helper()
		if w.Code != 200 {
			t.Fatalf("status=%d body=%s", w.Code, w.Body)
		}
		var raw struct {
			Items []map[string]any `json:"items"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &raw); err != nil {
			t.Fatal(err)
		}
		if len(raw.Items) != 3 {
			t.Fatalf("want 3 cards: %s", w.Body)
		}
		byID := map[float64]float64{}
		for _, card := range raw.Items {
			id, ok := card["id"].(float64)
			if !ok {
				t.Fatalf("card without a numeric id: %v", card)
			}
			position, ok := card["position"].(float64)
			if !ok {
				t.Fatalf("card %v has no numeric \"position\" key: %v", id, card)
			}
			byID[id] = position
		}
		return byID
	}

	got := positions(request(h, "GET", "/api/board", ""))
	if got[1] != 0 || got[2] != 1 || got[3] != 7 {
		t.Fatalf("GET /api/board positions: %v", got)
	}
	got = positions(request(h, "PUT", "/api/items/order", `{"columns":[{"columnId":1,"itemIds":[2,1]}]}`))
	if got[2] != 0 || got[1] != 1 || got[3] != 7 {
		t.Fatalf("PUT /api/items/order positions: %v", got)
	}
}

type cardOrderFailureRepo struct {
	*memoryRepo
	err error
}

func (r cardOrderFailureRepo) ReorderItems(context.Context, []ItemColumnOrder) ([]Item, error) {
	return nil, r.err
}

func TestReorderItemsStorageFailure(t *testing.T) {
	secret := "internal-card-order-db-failure"
	r := cardOrderFailureRepo{memoryRepo: fresh(), err: errors.New(secret)}
	seedCards(r.memoryRepo)
	w := request(NewHandler(r), "PUT", "/api/items/order", `{"columns":[{"columnId":1,"itemIds":[2,1]}]}`)
	if w.Code != 500 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	if strings.Contains(w.Body.String(), secret) {
		t.Fatalf("leaked: %s", w.Body.String())
	}
}

func cardsInColumn(cards []Item, columnID int64) []Item {
	out := []Item{}
	for _, c := range cards {
		if c.ColumnID == columnID {
			out = append(out, c)
		}
	}
	return out
}
