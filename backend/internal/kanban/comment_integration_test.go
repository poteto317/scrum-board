package kanban

import (
	"encoding/json"
	"strconv"
	"testing"
)

func TestCommentCascadeAndHistoryUnchangedMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	repo := MySQLRepository{DB: db}
	h := NewHandler(repo)

	created := request(h, "POST", "/api/items", `{"title":"c","description":"d","columnId":1}`)
	if created.Code != 201 {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	var card Item
	if err := json.Unmarshal(created.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	base := "/api/items/by-number/" + strconv.FormatInt(card.Number, 10) + "/comments"
	histPath := "/api/items/by-number/" + strconv.FormatInt(card.Number, 10) + "/history"

	beforeHist := request(h, "GET", histPath, "")
	if beforeHist.Code != 200 {
		t.Fatalf("history before: %d", beforeHist.Code)
	}
	var hist struct {
		Events []json.RawMessage `json:"events"`
	}
	if err := json.Unmarshal(beforeHist.Body.Bytes(), &hist); err != nil {
		t.Fatal(err)
	}
	beforeCount := len(hist.Events)

	post := request(h, "POST", base, `{"author":"A","body":"hello"}`)
	if post.Code != 201 {
		t.Fatalf("post: %d %s", post.Code, post.Body.String())
	}
	var c Comment
	if err := json.Unmarshal(post.Body.Bytes(), &c); err != nil {
		t.Fatal(err)
	}
	patch := request(h, "PATCH", base+"/"+strconv.FormatInt(c.ID, 10), `{"body":"hello2"}`)
	if patch.Code != 200 {
		t.Fatalf("patch: %d", patch.Code)
	}
	del := request(h, "DELETE", base+"/"+strconv.FormatInt(c.ID, 10), "")
	if del.Code != 204 {
		t.Fatalf("delete: %d", del.Code)
	}

	afterHist := request(h, "GET", histPath, "")
	if err := json.Unmarshal(afterHist.Body.Bytes(), &hist); err != nil {
		t.Fatal(err)
	}
	if len(hist.Events) != beforeCount {
		t.Fatalf("history changed: before=%d after=%d", beforeCount, len(hist.Events))
	}

	post2 := request(h, "POST", base, `{"body":"cascade-me"}`)
	if post2.Code != 201 {
		t.Fatalf("post2: %d", post2.Code)
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM item_comments WHERE item_id=?`, card.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("want 1 comment, got %d", n)
	}
	if w := request(h, "DELETE", "/api/items/"+strconv.FormatInt(card.ID, 10), ""); w.Code != 204 {
		t.Fatalf("delete item: %d", w.Code)
	}
	// Soft delete keeps the row; comments remain until hard delete / purge CASCADE.
	if err := db.QueryRow(`SELECT COUNT(*) FROM item_comments WHERE item_id=?`, card.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("soft delete should keep comments, got %d", n)
	}
	if err := (MySQLRepository{DB: db}).HardDeleteItem(t.Context(), card.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM item_comments WHERE item_id=?`, card.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("hard delete cascade want 0, got %d", n)
	}
}
