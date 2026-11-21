package kanban

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
)

func TestItemFavoriteAPI(t *testing.T) {
	h := NewHandler(fresh())
	created := request(h, "POST", "/api/items", `{"title":"fav","description":"d","columnId":1}`)
	if created.Code != 201 {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	var card Item
	if err := json.Unmarshal(created.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if card.Favorite {
		t.Fatalf("default favorite: %v", card.Favorite)
	}

	for _, path := range []string{
		"/api/board",
		"/api/backlog",
		"/api/items/" + strconv.FormatInt(card.ID, 10),
		"/api/items/by-number/" + strconv.FormatInt(card.Number, 10),
	} {
		w := request(h, "GET", path, "")
		if w.Code != 200 {
			t.Fatalf("%s: %d", path, w.Code)
		}
		if !strings.Contains(w.Body.String(), `"favorite"`) {
			t.Fatalf("%s missing favorite key: %s", path, w.Body.String())
		}
	}

	withTrue := request(h, "POST", "/api/items", `{"title":"on","description":"d","columnId":1,"favorite":true}`)
	if withTrue.Code != 201 {
		t.Fatalf("create true: %d %s", withTrue.Code, withTrue.Body.String())
	}
	if err := json.Unmarshal(withTrue.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if !card.Favorite {
		t.Fatal("create favorite true")
	}

	idPath := "/api/items/" + strconv.FormatInt(card.ID, 10)
	titleBefore := card.Title
	solBefore := card.Solution

	w := request(h, "PATCH", idPath, `{"favorite":false}`)
	if w.Code != 200 {
		t.Fatalf("patch false: %d %s", w.Code, w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if card.Favorite {
		t.Fatal("patched false")
	}
	if card.Title != titleBefore || card.Solution != solBefore {
		t.Fatal("other fields changed")
	}

	w = request(h, "PATCH", idPath, `{"favorite":true}`)
	if w.Code != 200 {
		t.Fatalf("patch true: %d %s", w.Code, w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if !card.Favorite {
		t.Fatal("patched true")
	}

	w = request(h, "PATCH", idPath, `{"title":"still"}`)
	if w.Code != 200 {
		t.Fatalf("omit: %d %s", w.Code, w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if !card.Favorite {
		t.Fatal("omit should keep true")
	}

	for _, body := range []string{`{"favorite":null}`, `{"favorite":"true"}`, `{"favorite":1}`} {
		w = request(h, "PATCH", idPath, body)
		if w.Code != 400 {
			t.Fatalf("want 400 for %s got %d %s", body, w.Code, w.Body.String())
		}
	}

	w = request(h, "PATCH", idPath, `{"favorite":true}`)
	if w.Code != 200 {
		t.Fatalf("same value: %d", w.Code)
	}

	status := request(h, "PATCH", "/api/items/by-number/"+strconv.FormatInt(card.Number, 10)+"/status", `{"status":"Doing"}`)
	if status.Code != 200 {
		t.Fatalf("status: %d %s", status.Code, status.Body.String())
	}
	if err := json.Unmarshal(status.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if !card.Favorite {
		t.Fatal("status must not clear favorite")
	}

	assignee := request(h, "PATCH", "/api/items/by-number/"+strconv.FormatInt(card.Number, 10)+"/assignee", `{"assignee":"Cursor"}`)
	if assignee.Code != 200 {
		t.Fatalf("assignee: %d %s", assignee.Code, assignee.Body.String())
	}
	if err := json.Unmarshal(assignee.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if !card.Favorite {
		t.Fatal("assignee must not clear favorite")
	}
}
