package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func TestSoftDeleteExcludesFromReadsMemory(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	w := request(h, "POST", "/api/items", `{"title":"keep","columnId":1}`)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body)
	}
	var created Item
	_ = json.Unmarshal(w.Body.Bytes(), &created)

	if w = request(h, "DELETE", "/api/items/1", ""); w.Code != 204 {
		t.Fatalf("soft delete: %d", w.Code)
	}
	c, ok := repo.cards[1]
	if !ok || c.DeletedAt == nil {
		t.Fatalf("want soft-deleted row kept: ok=%v deletedAt=%v", ok, c.DeletedAt)
	}
	if c.Title != "keep" || c.ColumnID != 1 {
		t.Fatalf("soft delete must not rewrite fields: %+v", c)
	}

	if w = request(h, "GET", "/api/items/1", ""); w.Code != 404 {
		t.Fatalf("GetItem soft: %d", w.Code)
	}
	if w = request(h, "GET", "/api/items/by-number/1", ""); w.Code != 404 {
		t.Fatalf("GetItemByNumber soft: %d", w.Code)
	}
	w = request(h, "GET", "/api/board", "")
	var b Board
	_ = json.Unmarshal(w.Body.Bytes(), &b)
	if w.Code != 200 || len(b.Items) != 0 {
		t.Fatalf("Board soft: %d items=%d", w.Code, len(b.Items))
	}
	w = request(h, "GET", "/api/backlog", "")
	var backlog struct {
		Items []Item `json:"items"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &backlog)
	if w.Code != 200 || len(backlog.Items) != 0 {
		t.Fatalf("Backlog soft: %d items=%d body=%s", w.Code, len(backlog.Items), w.Body)
	}
	if w = request(h, "PATCH", "/api/items/1", `{"title":"nope"}`); w.Code != 404 {
		t.Fatalf("Update soft: %d", w.Code)
	}
	if w = request(h, "DELETE", "/api/items/1", ""); w.Code != 404 {
		t.Fatalf("re-DELETE soft: %d", w.Code)
	}
}

func TestSoftDeleteReorderExcludesMemory(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	_ = request(h, "POST", "/api/items", `{"title":"a","columnId":1}`)
	_ = request(h, "POST", "/api/items", `{"title":"b","columnId":1}`)
	if w := request(h, "DELETE", "/api/items/1", ""); w.Code != 204 {
		t.Fatal(w.Code)
	}
	body := `{"columns":[{"columnId":1,"itemIds":[2]},{"columnId":2,"itemIds":[]},{"columnId":3,"itemIds":[]}]}`
	if w := request(h, "PUT", "/api/items/order", body); w.Code != 200 {
		t.Fatalf("reorder living only: %d %s", w.Code, w.Body)
	}
}

func TestSoftDeleteMySQL(t *testing.T) {
	r, a, b := newOrderedBoard(t)
	ctx := context.Background()
	title, col := a.Title, a.ColumnID
	if err := r.DeleteItem(ctx, a.ID); err != nil {
		t.Fatal(err)
	}
	var deletedAt *time.Time
	var gotTitle string
	var gotCol int64
	err := r.DB.QueryRow(`SELECT deleted_at, title, column_id FROM items WHERE id=?`, a.ID).Scan(&deletedAt, &gotTitle, &gotCol)
	if err != nil || deletedAt == nil || gotTitle != title || gotCol != col {
		t.Fatalf("row kept with deleted_at: title=%q col=%d deletedAt=%v err=%v", gotTitle, gotCol, deletedAt, err)
	}
	if _, err = r.GetItem(ctx, a.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetItem: %v", err)
	}
	if _, err = r.GetItemByNumber(ctx, a.Number, a.ProjectID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetItemByNumber: %v", err)
	}
	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range board.Items {
		if c.ID == a.ID {
			t.Fatal("Board includes soft-deleted")
		}
	}
	backlog, err := r.Backlog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range backlog {
		if c.ID == a.ID {
			t.Fatal("Backlog includes soft-deleted")
		}
	}
	if _, err = r.UpdateItem(ctx, a.ID, ItemPatch{Title: strPtr("x")}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("UpdateItem: %v", err)
	}
	if err = r.DeleteItem(ctx, a.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("re-delete: %v", err)
	}
	// living cards (seed + b) still reorderable; soft-deleted a must not be required
	boardAfter, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	byCol := map[int64][]int64{}
	for _, c := range boardAfter.Items {
		byCol[c.ColumnID] = append(byCol[c.ColumnID], c.ID)
	}
	for _, id := range byCol[1] {
		if id == a.ID {
			t.Fatal("soft-deleted id still in Board before reorder")
		}
	}
	foundB := false
	for _, id := range byCol[1] {
		if id == b.ID {
			foundB = true
		}
	}
	if !foundB {
		t.Fatal("living sibling missing from Board")
	}
	var orders []ItemColumnOrder
	for _, col := range boardAfter.Columns {
		ids := byCol[col.ID]
		if ids == nil {
			ids = []int64{}
		}
		orders = append(orders, ItemColumnOrder{ColumnID: col.ID, ItemIDs: ids})
	}
	if _, err = r.ReorderItems(ctx, orders); err != nil {
		t.Fatalf("ReorderItems exclude soft: %v", err)
	}
	var hist, nums int
	if err = r.DB.QueryRow(`SELECT COUNT(*) FROM item_history WHERE item_id=?`, a.ID).Scan(&hist); err != nil {
		t.Fatal(err)
	}
	if err = r.DB.QueryRow(`SELECT COUNT(*) FROM item_numbers WHERE item_id=?`, a.ID).Scan(&nums); err != nil {
		t.Fatal(err)
	}
	if hist == 0 || nums == 0 {
		t.Fatalf("soft delete must keep history/numbers: hist=%d nums=%d", hist, nums)
	}
}

func strPtr(s string) *string { return &s }
