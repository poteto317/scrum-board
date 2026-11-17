package kanban

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"
	"time"
)

func TestUpdateItemDueAt(t *testing.T) {
	h := NewHandler(fresh())
	created := request(h, "POST", "/api/items", `{"title":"Due me","description":"d","columnId":1}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	var card Item
	if err := json.Unmarshal(created.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	assertDueAtKey(t, created.Body.Bytes())
	if card.DueAt != nil {
		t.Fatalf("default dueAt want nil, got %v", card.DueAt)
	}

	idPath := "/api/items/" + strconv.FormatInt(card.ID, 10)

	w := request(h, "PATCH", idPath, `{"dueAt":"2026-11-17T08:30:45Z"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("Z set: %d %s", w.Code, w.Body.String())
	}
	assertDueAtKey(t, w.Body.Bytes())
	if err := json.Unmarshal(w.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	want := time.Date(2026, 11, 17, 8, 30, 0, 0, time.UTC)
	if card.DueAt == nil || !card.DueAt.Equal(want) {
		t.Fatalf("Z set: got %v want %v", card.DueAt, want)
	}

	w = request(h, "PATCH", idPath, `{"dueAt":"2026-11-18T17:30:00+09:00"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("+09:00: %d %s", w.Code, w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	want = time.Date(2026, 11, 18, 8, 30, 0, 0, time.UTC)
	if card.DueAt == nil || !card.DueAt.Equal(want) {
		t.Fatalf("+09:00→UTC: got %v want %v", card.DueAt, want)
	}

	kept := *card.DueAt
	omit := request(h, "PATCH", idPath, `{"title":"Due me2"}`)
	if omit.Code != http.StatusOK {
		t.Fatalf("omit: %d %s", omit.Code, omit.Body.String())
	}
	if err := json.Unmarshal(omit.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if card.DueAt == nil || !card.DueAt.Equal(kept) {
		t.Fatalf("omit should keep dueAt: got %v want %v", card.DueAt, kept)
	}

	clear := request(h, "PATCH", idPath, `{"dueAt":null}`)
	if clear.Code != http.StatusOK {
		t.Fatalf("null clear: %d %s", clear.Code, clear.Body.String())
	}
	assertDueAtKey(t, clear.Body.Bytes())
	if err := json.Unmarshal(clear.Body.Bytes(), &card); err != nil {
		t.Fatal(err)
	}
	if card.DueAt != nil {
		t.Fatalf("null clear: got %v", card.DueAt)
	}

	for _, body := range []string{
		`{"dueAt":""}`,
		`{"dueAt":"2026-11-17T08:30:00"}`,
		`{"dueAt":"2026-11-17"}`,
		`{"dueAt":"2026-02-31T08:30:00Z"}`,
	} {
		bad := request(h, "PATCH", idPath, body)
		if bad.Code != http.StatusBadRequest {
			t.Fatalf("%s -> %d want 400 (%s)", body, bad.Code, bad.Body.String())
		}
	}

	only := request(h, "PATCH", idPath, `{"dueAt":"2026-11-17T08:30:00Z"}`)
	if only.Code != http.StatusOK {
		t.Fatalf("dueAt-only PATCH: %d %s", only.Code, only.Body.String())
	}

	get := request(h, "GET", idPath, "")
	if get.Code != http.StatusOK {
		t.Fatalf("GET: %d", get.Code)
	}
	assertDueAtKey(t, get.Body.Bytes())

	board := request(h, "GET", "/api/board", "")
	if board.Code != http.StatusOK {
		t.Fatalf("board: %d", board.Code)
	}
	var b Board
	if err := json.Unmarshal(board.Body.Bytes(), &b); err != nil {
		t.Fatal(err)
	}
	var rawBoard map[string]json.RawMessage
	if err := json.Unmarshal(board.Body.Bytes(), &rawBoard); err != nil {
		t.Fatal(err)
	}
	var items []map[string]json.RawMessage
	if err := json.Unmarshal(rawBoard["items"], &items); err != nil {
		t.Fatal(err)
	}
	if len(items) == 0 {
		t.Fatal("board items empty")
	}
	for i, item := range items {
		if _, ok := item["dueAt"]; !ok {
			t.Fatalf("board item[%d] missing dueAt key", i)
		}
	}
}

func assertDueAtKey(t *testing.T, body []byte) {
	t.Helper()
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		t.Fatal(err)
	}
	if _, ok := raw["dueAt"]; !ok {
		t.Fatalf("missing dueAt key in %s", body)
	}
}
