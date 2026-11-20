package kanban

import (
	"encoding/json"
	"testing"
)

func TestHeaderMenuGETDefaults(t *testing.T) {
	h := NewHandler(fresh())
	rec := request(h, "GET", "/api/header-menu", "")
	if rec.Code != 200 {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var got WorkspaceHeaderMenu
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	for _, p := range []PageHeaderMenu{got.Board, got.Backlog, got.ItemDetail} {
		if p.HiddenIDs == nil || len(p.HiddenIDs) != 0 {
			t.Fatalf("want empty hiddenIds, got %+v", p)
		}
	}
}

func TestHeaderMenuPUTRoundTrip(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	body := `{"board":{"hiddenIds":[]},"backlog":{"hiddenIds":["open_trash","open_trash"]},"itemDetail":{"hiddenIds":["item_favorite"]}}`
	rec := request(h, "PUT", "/api/header-menu", body)
	if rec.Code != 200 {
		t.Fatalf("put status %d body %s", rec.Code, rec.Body.String())
	}
	var put WorkspaceHeaderMenu
	if err := json.Unmarshal(rec.Body.Bytes(), &put); err != nil {
		t.Fatal(err)
	}
	if len(put.Board.HiddenIDs) != 0 {
		t.Fatalf("board %+v", put.Board)
	}
	if len(put.Backlog.HiddenIDs) != 1 || put.Backlog.HiddenIDs[0] != "open_trash" {
		t.Fatalf("deduped backlog %+v", put.Backlog)
	}
	if len(put.ItemDetail.HiddenIDs) != 1 || put.ItemDetail.HiddenIDs[0] != "item_favorite" {
		t.Fatalf("itemDetail %+v", put.ItemDetail)
	}
	rec = request(h, "GET", "/api/header-menu", "")
	var got WorkspaceHeaderMenu
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Backlog.HiddenIDs) != 1 || got.ItemDetail.HiddenIDs[0] != "item_favorite" {
		t.Fatalf("get %+v", got)
	}
}

func TestHeaderMenuPUTValidation(t *testing.T) {
	h := NewHandler(fresh())
	cases := []struct {
		name string
		body string
	}{
		{"unknown top key", `{"board":{"hiddenIds":[]},"backlog":{"hiddenIds":[]},"itemDetail":{"hiddenIds":[]},"extra":1}`},
		{"missing board", `{"backlog":{"hiddenIds":[]},"itemDetail":{"hiddenIds":[]}}`},
		{"missing backlog", `{"board":{"hiddenIds":[]},"itemDetail":{"hiddenIds":[]}}`},
		{"missing itemDetail", `{"board":{"hiddenIds":[]},"backlog":{"hiddenIds":[]}}`},
		{"null board", `{"board":null,"backlog":{"hiddenIds":[]},"itemDetail":{"hiddenIds":[]}}`},
		{"null backlog", `{"board":{"hiddenIds":[]},"backlog":null,"itemDetail":{"hiddenIds":[]}}`},
		{"board unknown key", `{"board":{"hiddenIds":[],"extra":1},"backlog":{"hiddenIds":[]},"itemDetail":{"hiddenIds":[]}}`},
		{"null hiddenIds", `{"board":{"hiddenIds":null},"backlog":{"hiddenIds":[]},"itemDetail":{"hiddenIds":[]}}`},
		{"missing hiddenIds", `{"board":{},"backlog":{"hiddenIds":[]},"itemDetail":{"hiddenIds":[]}}`},
		{"non-array hiddenIds", `{"board":{"hiddenIds":1},"backlog":{"hiddenIds":[]},"itemDetail":{"hiddenIds":[]}}`},
		{"non-string element", `{"board":{"hiddenIds":[1]},"backlog":{"hiddenIds":[]},"itemDetail":{"hiddenIds":[]}}`},
		{"unknown id", `{"board":{"hiddenIds":["project_nope"]},"backlog":{"hiddenIds":[]},"itemDetail":{"hiddenIds":[]}}`},
		{"wrong pageKind id on board", `{"board":{"hiddenIds":["item_history"]},"backlog":{"hiddenIds":[]},"itemDetail":{"hiddenIds":[]}}`},
		{"unknown retired id on itemDetail", `{"board":{"hiddenIds":[]},"backlog":{"hiddenIds":[]},"itemDetail":{"hiddenIds":["project_add"]}}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := request(h, "PUT", "/api/header-menu", tc.body)
			if rec.Code != 400 {
				t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestParseStoredHeaderMenuPayload(t *testing.T) {
	empty := emptyWorkspaceHeaderMenu()

	got := parseStoredHeaderMenuPayload(nil)
	if !workspaceHeaderMenuEqual(got, empty) {
		t.Fatalf("nil payload → empty×3, got %+v", got)
	}
	got = parseStoredHeaderMenuPayload([]byte(`{not-json`))
	if !workspaceHeaderMenuEqual(got, empty) {
		t.Fatalf("corrupt → empty×3, got %+v", got)
	}

	got = parseStoredHeaderMenuPayload([]byte(`{"board":{"hiddenIds":[]},"backlog":{"hiddenIds":["open_trash"]},"itemDetail":{"hiddenIds":[]},"extra":1}`))
	if len(got.Board.HiddenIDs) != 0 || len(got.ItemDetail.HiddenIDs) != 0 {
		t.Fatalf("extra key ignored, got %+v", got)
	}
	if len(got.Backlog.HiddenIDs) != 1 || got.Backlog.HiddenIDs[0] != "open_trash" {
		t.Fatalf("backlog %+v", got.Backlog)
	}
	got = parseStoredHeaderMenuPayload([]byte(`{"board":{"hiddenIds":[]},"backlog":{"hiddenIds":["project_delete"]},"itemDetail":{"hiddenIds":[]}}`))
	if len(got.Backlog.HiddenIDs) != 0 {
		t.Fatalf("retired project_* ids stripped on GET, got %+v", got.Backlog)
	}

	got = parseStoredHeaderMenuPayload([]byte(`{"backlog":{"hiddenIds":[]}}`))
	if len(got.Board.HiddenIDs) != 0 || len(got.ItemDetail.HiddenIDs) != 0 {
		t.Fatalf("missing keys supplemented, got %+v", got)
	}

	got = parseStoredHeaderMenuPayload([]byte(`{"board":null,"backlog":{"hiddenIds":[]},"itemDetail":{"hiddenIds":[]}}`))
	if len(got.Board.HiddenIDs) != 0 {
		t.Fatalf("bad board type → empty board, got %+v", got.Board)
	}

	got = parseStoredHeaderMenuPayload([]byte(`{"board":{"hiddenIds":["open_projects","item_history","open_projects","bad",42,"project_rename"]},"backlog":{"hiddenIds":[]},"itemDetail":{"hiddenIds":[]}}`))
	if len(got.Board.HiddenIDs) != 1 || got.Board.HiddenIDs[0] != "open_projects" {
		t.Fatalf("filter unknown/wrong-kind/non-string/dedupe, got %+v", got.Board.HiddenIDs)
	}
}

func workspaceHeaderMenuEqual(a, b WorkspaceHeaderMenu) bool {
	return hiddenIDsEqual(a.Board.HiddenIDs, b.Board.HiddenIDs) &&
		hiddenIDsEqual(a.Backlog.HiddenIDs, b.Backlog.HiddenIDs) &&
		hiddenIDsEqual(a.ItemDetail.HiddenIDs, b.ItemDetail.HiddenIDs)
}

func hiddenIDsEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
