package kanban

import (
	"encoding/json"
	"testing"
)

func TestCreateAndMoveFreeOffsetY(t *testing.T) {
	repo := fresh()
	repo.settings.CardLayout = CardLayoutFree
	h := NewHandler(repo)

	w := request(h, "POST", "/api/items", `{"title":"first","columnId":1}`)
	if w.Code != 201 {
		t.Fatalf("create empty: %d %s", w.Code, w.Body)
	}
	var first Item
	if err := json.Unmarshal(w.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	if first.OffsetY != 0 || first.Position != 0 {
		t.Fatalf("empty free create: %+v", first)
	}

	w = request(h, "POST", "/api/items", `{"title":"second","columnId":1}`)
	if w.Code != 201 {
		t.Fatalf("create non-empty: %d %s", w.Code, w.Body)
	}
	var second Item
	if err := json.Unmarshal(w.Body.Bytes(), &second); err != nil {
		t.Fatal(err)
	}
	if second.OffsetY != freePlacementStepY || second.Position != 1 {
		t.Fatalf("non-empty free create: %+v", second)
	}

	w = request(h, "PATCH", "/api/items/1", `{"columnId":2}`)
	if w.Code != 200 {
		t.Fatalf("move to empty: %d %s", w.Code, w.Body)
	}
	var moved Item
	if err := json.Unmarshal(w.Body.Bytes(), &moved); err != nil {
		t.Fatal(err)
	}
	if moved.ColumnID != 2 || moved.OffsetY != 0 || moved.Position != 0 {
		t.Fatalf("move to empty free column: %+v", moved)
	}

	repo.cards[3] = Item{ID: 3, Number: 3, ColumnID: 2, Title: "anchor", Position: 0, OffsetY: 40}
	repo.next = 4
	w = request(h, "PATCH", "/api/items/2", `{"columnId":2}`)
	if w.Code != 200 {
		t.Fatalf("move to non-empty: %d %s", w.Code, w.Body)
	}
	if err := json.Unmarshal(w.Body.Bytes(), &moved); err != nil {
		t.Fatal(err)
	}
	wantOffset := 40 + freePlacementStepY
	if moved.ColumnID != 2 || moved.OffsetY != wantOffset {
		t.Fatalf("move to non-empty free column: %+v", moved)
	}
}

func TestCreateFreeOffsetYCapsAtMax(t *testing.T) {
	repo := fresh()
	repo.settings.CardLayout = CardLayoutFree
	repo.cards[1] = Item{ID: 1, Number: 1, ColumnID: 1, Title: "near-max", Position: 0, OffsetY: MaxOffsetY - 10}
	repo.cards[2] = Item{ID: 2, Number: 2, ColumnID: 2, Title: "at-max", Position: 0, OffsetY: MaxOffsetY}
	repo.next = 3
	h := NewHandler(repo)

	w := request(h, "POST", "/api/items", `{"title":"capped","columnId":1}`)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body)
	}
	var created Item
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.OffsetY != MaxOffsetY {
		t.Fatalf("want OffsetY=%d, got %d", MaxOffsetY, created.OffsetY)
	}

	w = request(h, "PATCH", "/api/items/"+itoa(created.ID), `{"columnId":2}`)
	if w.Code != 200 {
		t.Fatalf("move to max column: %d %s", w.Code, w.Body)
	}
	var moved Item
	if err := json.Unmarshal(w.Body.Bytes(), &moved); err != nil {
		t.Fatal(err)
	}
	if moved.ColumnID != 2 || moved.OffsetY != MaxOffsetY {
		t.Fatalf("move near max want col=2 offset=%d, got %+v", MaxOffsetY, moved)
	}
}

func TestCreateAndMovePackLeavesOffsetY(t *testing.T) {
	repo := fresh()
	repo.settings.CardLayout = CardLayoutPack
	repo.cards[1] = Item{ID: 1, Number: 1, ColumnID: 1, Title: "a", Position: 0, OffsetY: 99}
	repo.next = 2
	h := NewHandler(repo)

	w := request(h, "POST", "/api/items", `{"title":"new","columnId":1}`)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body)
	}
	var created Item
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.OffsetY != 0 || created.Position != 1 {
		t.Fatalf("pack create: %+v", created)
	}

	w = request(h, "PATCH", "/api/items/1", `{"columnId":2}`)
	if w.Code != 200 {
		t.Fatalf("move: %d %s", w.Code, w.Body)
	}
	var moved Item
	if err := json.Unmarshal(w.Body.Bytes(), &moved); err != nil {
		t.Fatal(err)
	}
	if moved.ColumnID != 2 || moved.OffsetY != 99 || moved.Position != 0 {
		t.Fatalf("pack move must keep offsetY: %+v", moved)
	}
}
