package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestReorderBacklogHandler(t *testing.T) {
	r := fresh()
	h := NewHandler(r)
	for _, title := range []string{"A", "B", "C"} {
		w := request(h, "POST", "/api/items", `{"title":"`+title+`","columnId":1}`)
		if w.Code != 201 {
			t.Fatalf("create %s: %d %s", title, w.Code, w.Body)
		}
	}

	w := request(h, "PUT", "/api/backlog/order", `{"itemIds":[3,1,2]}`)
	if w.Code != 200 {
		t.Fatalf("reorder: %d %s", w.Code, w.Body)
	}
	var resp struct {
		Items []Item `json:"items"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	want := []int64{3, 1, 2}
	if len(resp.Items) != len(want) {
		t.Fatalf("len=%d want %d", len(resp.Items), len(want))
	}
	for i, c := range resp.Items {
		if c.ID != want[i] || c.BacklogPosition != i {
			t.Fatalf("card[%d]=%+v want id=%d pos=%d", i, c, want[i], i)
		}
	}

	w = request(h, "GET", "/api/backlog", "")
	if w.Code != 200 {
		t.Fatalf("get backlog: %d", w.Code)
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	for i, c := range resp.Items {
		if c.ID != want[i] {
			t.Fatalf("GET backlog[%d].ID=%d want %d", i, c.ID, want[i])
		}
	}

	w = request(h, "POST", "/api/items", `{"title":"D","columnId":2}`)
	if w.Code != 201 {
		t.Fatalf("create after reorder: %d %s", w.Code, w.Body)
	}
	var created Item
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.BacklogPosition != 3 {
		t.Fatalf("new card backlogPosition=%d want 3", created.BacklogPosition)
	}
	w = request(h, "GET", "/api/backlog", "")
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Items) != 4 || resp.Items[3].ID != created.ID {
		t.Fatalf("expected D at end, got %+v", resp.Items)
	}
}

func TestReorderBacklogValidationAndConflict(t *testing.T) {
	seed := func() *memoryRepo {
		r := fresh()
		r.cards[1] = Item{ID: 1, Number: 1, ColumnID: 1, Title: "A", BacklogPosition: 0}
		r.cards[2] = Item{ID: 2, Number: 2, ColumnID: 1, Title: "B", BacklogPosition: 1}
		r.cards[3] = Item{ID: 3, Number: 3, ColumnID: 3, Title: "C", BacklogPosition: 2}
		r.next = 4
		return r
	}
	cases := []struct {
		name, body string
		status     int
	}{
		{"missing field", `{}`, 400},
		{"null itemIds", `{"itemIds":null}`, 400},
		{"empty array", `{"itemIds":[]}`, 400},
		{"zero id", `{"itemIds":[1,0,3]}`, 400},
		{"negative id", `{"itemIds":[1,-2,3]}`, 400},
		{"duplicate id", `{"itemIds":[1,2,2]}`, 400},
		{"unknown field", `{"itemIds":[1,2,3],"extra":true}`, 400},
		{"malformed json", `{`, 400},
		{"multiple json", `{"itemIds":[1,2,3]}{}`, 400},
		{"missing existing card", `{"itemIds":[1,2]}`, 409},
		{"unknown card id", `{"itemIds":[1,2,99]}`, 409},
		{"extra card id", `{"itemIds":[1,2,3,99]}`, 409},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := seed()
			h := NewHandler(r)
			w := request(h, "PUT", "/api/backlog/order", tc.body)
			if w.Code != tc.status {
				t.Fatalf("status=%d want=%d body=%s", w.Code, tc.status, w.Body)
			}
			cards, _ := r.Backlog(context.Background())
			if len(cards) != 3 || cards[0].ID != 1 || cards[1].ID != 2 || cards[2].ID != 3 {
				t.Fatalf("backlog mutated on error: %+v", cards)
			}
		})
	}
}

type backlogOrderFailureRepo struct {
	*memoryRepo
	err error
}

func (r backlogOrderFailureRepo) ReorderBacklog(context.Context, []int64) ([]Item, error) {
	return nil, r.err
}

func TestReorderBacklogStorageFailure(t *testing.T) {
	internalSecret := "internal-mysql-connection-lost-secret"
	mem := fresh()
	mem.cards[1] = Item{ID: 1, Number: 1, ColumnID: 1, Title: "A", BacklogPosition: 0}
	mem.cards[2] = Item{ID: 2, Number: 2, ColumnID: 1, Title: "B", BacklogPosition: 1}
	r := backlogOrderFailureRepo{memoryRepo: mem, err: errors.New(internalSecret)}
	w := request(NewHandler(r), "PUT", "/api/backlog/order", `{"itemIds":[2,1]}`)
	if w.Code != 500 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	if strings.Contains(w.Body.String(), internalSecret) {
		t.Fatalf("leaked internal error detail: %s", w.Body.String())
	}
	cards, _ := mem.Backlog(context.Background())
	if len(cards) != 2 || cards[0].ID != 1 || cards[1].ID != 2 {
		t.Fatalf("backlog mutated on storage failure: %+v", cards)
	}
}
