package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strconv"
	"testing"
)

func TestMySQLStatusChange(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	if _, err := db.Exec("ALTER TABLE cards AUTO_INCREMENT=22"); err != nil {
		t.Fatal(err)
	}
	original, err := r.CreateCard(ctx, CardInput{ColumnID: 1, Title: "AI status task", Description: "preserve description"})
	if err != nil {
		t.Fatal(err)
	}
	if original.ID != 22 || original.Number != 2 {
		t.Fatal("fixture does not separate ID and number", original)
	}
	other, err := r.GetCard(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	custom, err := r.CreateColumn(ctx, "レビュー待ち")
	if err != nil {
		t.Fatal(err)
	}
	canonical, err := r.GetColumnByName(ctx, "doing")
	if err != nil || canonical.Name != "Doing" {
		t.Fatalf("column name lookup: %+v %v", canonical, err)
	}
	if _, err = r.GetColumnByName(ctx, "Doing' OR 1=1 --"); !errors.Is(err, ErrColumn) {
		t.Fatalf("unsafe column lookup %v", err)
	}
	h := NewHandler(r)
	path := "/api/cards/by-number/" + strconv.FormatInt(original.Number, 10) + "/status"
	for _, tc := range []struct {
		name string
		id   int64
	}{{"doing", 2}, {"レビュー待ち", custom.ID}, {"レビュー待ち", custom.ID}, {"Done", 3}} {
		body, _ := json.Marshal(map[string]string{"status": tc.name})
		w := request(h, "PATCH", path, string(body))
		if w.Code != 200 {
			t.Fatalf("status %q: %d %s", tc.name, w.Code, w.Body)
		}
		var card Card
		if err = json.Unmarshal(w.Body.Bytes(), &card); err != nil {
			t.Fatal(err)
		}
		if card.ID != original.ID || card.Number != original.Number || card.ColumnID != tc.id || card.Title != original.Title || card.Description != original.Description || !card.CreatedAt.Equal(original.CreatedAt) {
			t.Fatalf("bad persisted status response %+v", card)
		}
		persisted, err := r.GetCard(ctx, card.ID)
		if err != nil || persisted.ColumnID != tc.id || !persisted.UpdatedAt.Equal(card.UpdatedAt) {
			t.Fatalf("not persisted: %+v %v", persisted, err)
		}
	}
	before, err := r.GetCard(ctx, original.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{`{"status":"missing"}`, `{"status":"Doing","description":"overwrite"}`, `{"status":null}`} {
		if w := request(h, "PATCH", path, body); w.Code != 400 {
			t.Fatalf("invalid status: %d %s", w.Code, w.Body)
		}
	}
	after, err := r.GetCard(ctx, original.ID)
	if err != nil || !reflect.DeepEqual(after, before) {
		t.Fatalf("failed status request modified card: %+v %v", after, err)
	}
	untouched, err := r.GetCard(ctx, 1)
	if err != nil || !reflect.DeepEqual(untouched, other) {
		t.Fatal("unrelated card changed", err)
	}
	var next int64
	if err = db.QueryRow("SELECT next_number FROM card_number_sequence WHERE singleton=1").Scan(&next); err != nil || next != 3 {
		t.Fatalf("status consumed a number: %d %v", next, err)
	}
}
