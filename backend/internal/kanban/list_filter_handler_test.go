package kanban

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestListFilterGETDefaults(t *testing.T) {
	h := NewHandler(fresh())
	rec := request(h, "GET", "/api/list-filter", "")
	if rec.Code != 200 {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var got WorkspaceListFilters
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Board.Query != "" || got.Board.StatusIDs == nil || len(got.Board.StatusIDs) != 0 {
		t.Fatalf("board %+v", got.Board)
	}
	if got.Backlog.Query != "" || len(got.Backlog.StatusIDs) != 1 || got.Backlog.StatusIDs[0] != 1 {
		t.Fatalf("backlog want Todo id=1, got %+v", got.Backlog)
	}
}

func TestListFilterGETNoTodoColumn(t *testing.T) {
	repo := fresh()
	repo.columns = []Column{{ID: 2, Name: "Doing", Position: 0}}
	h := NewHandler(repo)
	rec := request(h, "GET", "/api/list-filter", "")
	var got WorkspaceListFilters
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Backlog.StatusIDs) != 0 {
		t.Fatalf("no Todo → empty backlog statusIds, got %+v", got.Backlog)
	}
}

func TestListFilterPUTRoundTrip(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	body := `{"board":{"query":"  hello  ","statusIds":[1,2,2,999]},"backlog":{"query":"","statusIds":[]}}`
	rec := request(h, "PUT", "/api/list-filter", body)
	if rec.Code != 200 {
		t.Fatalf("put status %d body %s", rec.Code, rec.Body.String())
	}
	var put WorkspaceListFilters
	if err := json.Unmarshal(rec.Body.Bytes(), &put); err != nil {
		t.Fatal(err)
	}
	if put.Board.Query != "hello" || len(put.Board.StatusIDs) != 2 || put.Board.StatusIDs[0] != 1 || put.Board.StatusIDs[1] != 2 {
		t.Fatalf("normalized board %+v", put.Board)
	}
	if put.Backlog.Query != "" || len(put.Backlog.StatusIDs) != 0 {
		t.Fatalf("cleared backlog %+v", put.Backlog)
	}
	rec = request(h, "GET", "/api/list-filter", "")
	var got WorkspaceListFilters
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Board.Query != "hello" || len(got.Board.StatusIDs) != 2 {
		t.Fatalf("get board %+v", got.Board)
	}
	if len(got.Backlog.StatusIDs) != 0 {
		t.Fatalf("cleared backlog must not re-seed Todo, got %+v", got.Backlog)
	}
}

func TestListFilterPUTValidation(t *testing.T) {
	h := NewHandler(fresh())
	cases := []struct {
		name string
		body string
	}{
		{"unknown top key", `{"board":{"query":"","statusIds":[]},"backlog":{"query":"","statusIds":[]},"extra":1}`},
		{"missing board", `{"backlog":{"query":"","statusIds":[]}}`},
		{"missing backlog", `{"board":{"query":"","statusIds":[]}}`},
		{"null board", `{"board":null,"backlog":{"query":"","statusIds":[]}}`},
		{"board unknown key", `{"board":{"query":"","statusIds":[],"extra":1},"backlog":{"query":"","statusIds":[]}}`},
		{"null query", `{"board":{"query":null,"statusIds":[]},"backlog":{"query":"","statusIds":[]}}`},
		{"null statusIds", `{"board":{"query":"","statusIds":null},"backlog":{"query":"","statusIds":[]}}`},
		{"missing query", `{"board":{"statusIds":[]},"backlog":{"query":"","statusIds":[]}}`},
		{"missing statusIds", `{"board":{"query":""},"backlog":{"query":"","statusIds":[]}}`},
		{"non-array statusIds", `{"board":{"query":"","statusIds":1},"backlog":{"query":"","statusIds":[]}}`},
		{"non-positive id", `{"board":{"query":"","statusIds":[0]},"backlog":{"query":"","statusIds":[]}}`},
		{"float id", `{"board":{"query":"","statusIds":[1.5]},"backlog":{"query":"","statusIds":[]}}`},
		{"query too long", `{"board":{"query":"` + strings.Repeat("a", 201) + `","statusIds":[]},"backlog":{"query":"","statusIds":[]}}`},
		{"statusIds too many", `{"board":{"query":"","statusIds":[` + strings.TrimRight(strings.Repeat("1,", 65), ",") + `]},"backlog":{"query":"","statusIds":[]}}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := request(h, "PUT", "/api/list-filter", tc.body)
			if rec.Code != 400 {
				t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestParseStoredListFilterCorrupt(t *testing.T) {
	got := parseStoredListFilter("keep", []byte(`{not-json`))
	if got.Query != "" || len(got.StatusIDs) != 0 {
		t.Fatalf("corrupt should yield empty, got %+v", got)
	}
	got = parseStoredListFilter("q", []byte(`"not-array"`))
	if got.Query != "" || len(got.StatusIDs) != 0 {
		t.Fatalf("non-array should yield empty, got %+v", got)
	}
	got = parseStoredListFilter("ok", []byte(`[1,2]`))
	if got.Query != "ok" || len(got.StatusIDs) != 2 {
		t.Fatalf("valid %+v", got)
	}
}

func TestResolveTodoColumnID(t *testing.T) {
	id, ok := resolveTodoColumnID([]Column{
		{ID: 3, Name: "Done", Position: 2},
		{ID: 2, Name: " TODO ", Position: 1},
		{ID: 9, Name: "todo", Position: 0},
	})
	if !ok || id != 9 {
		t.Fatalf("want earliest position todo id=9, got %d ok=%v", id, ok)
	}
	_, ok = resolveTodoColumnID([]Column{{ID: 1, Name: "Doing"}})
	if ok {
		t.Fatal("expected no todo")
	}
}
