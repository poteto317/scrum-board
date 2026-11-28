package kanban

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
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
	got := parseStoredListFilter("keep", []byte(`{not-json`), []byte(`[]`))
	if got.Query != "" || len(got.StatusIDs) != 0 || len(got.LabelIDs) != 0 {
		t.Fatalf("corrupt status should yield empty, got %+v", got)
	}
	got = parseStoredListFilter("keep", []byte(`[1]`), []byte(`{not-json`))
	if got.Query != "" || len(got.StatusIDs) != 0 || len(got.LabelIDs) != 0 {
		t.Fatalf("corrupt label should yield empty, got %+v", got)
	}
	got = parseStoredListFilter("q", []byte(`"not-array"`), []byte(`[]`))
	if got.Query != "" || len(got.StatusIDs) != 0 || len(got.LabelIDs) != 0 {
		t.Fatalf("non-array status should yield empty, got %+v", got)
	}
	got = parseStoredListFilter("q", []byte(`[1]`), []byte(`"not-array"`))
	if got.Query != "" || len(got.StatusIDs) != 0 || len(got.LabelIDs) != 0 {
		t.Fatalf("non-array label should yield empty, got %+v", got)
	}
	got = parseStoredListFilter("ok", []byte(`[1,2]`), []byte(`[3,4]`))
	if got.Query != "ok" || len(got.StatusIDs) != 2 || len(got.LabelIDs) != 2 {
		t.Fatalf("valid %+v", got)
	}
}

func TestListFilterLabelIDsRoundTripAndValidation(t *testing.T) {
	repo := fresh()
	l1, err := repo.CreateLabel(context.Background(), LabelInput{Name: "bug", Color: "#ef4444"})
	if err != nil {
		t.Fatal(err)
	}
	l2, err := repo.CreateLabel(context.Background(), LabelInput{Name: "api", Color: "#3b82f6"})
	if err != nil {
		t.Fatal(err)
	}
	h := NewHandler(repo)

	// Omit labelIds -> defaults to [] (preserves existing label behavior of returning slices, not null).
	w := request(h, "PUT", "/api/list-filter", `{"board":{"query":"q","statusIds":[1]},"backlog":{"query":"","statusIds":[]}}`)
	if w.Code != 200 {
		t.Fatalf("omit labelIds PUT: %d %s", w.Code, w.Body.String())
	}

	// Round-trip labelIds with dedup and unknown pruning on write + read.
	body := fmt.Sprintf(`{"board":{"query":"  bug ","statusIds":[1],"labelIds":[%d,%d,%d,999999]},"backlog":{"query":"","statusIds":[],"labelIds":[%d]}}`, l2.ID, l1.ID, l2.ID, l1.ID)
	w = request(h, "PUT", "/api/list-filter", body)
	if w.Code != 200 {
		t.Fatalf("labelIds PUT: %d %s", w.Code, w.Body.String())
	}
	var got WorkspaceListFilters
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(got.Board.LabelIDs, []int64{l2.ID, l1.ID}) || !slices.Equal(got.Backlog.LabelIDs, []int64{l1.ID}) {
		t.Fatalf("unexpected PUT round-trip labels: %+v", got)
	}

	// Delete l2 -> GET prunes hidden deleted label id immediately.
	if err := repo.DeleteLabel(context.Background(), l2.ID); err != nil {
		t.Fatal(err)
	}
	w = request(h, "GET", "/api/list-filter", "")
	if w.Code != 200 {
		t.Fatalf("GET after label delete: %d", w.Code)
	}
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(got.Board.LabelIDs, []int64{l1.ID}) || !slices.Equal(got.Backlog.LabelIDs, []int64{l1.ID}) {
		t.Fatalf("expected deleted label pruned from GET filter, got %+v", got)
	}

	// Invalid labelIds payloads -> 400.
	tooMany := make([]string, MaxListFilterLabelIDs+1)
	for i := range tooMany {
		tooMany[i] = fmt.Sprintf("%d", i+1)
	}
	badPayloads := []string{
		`{"board":{"query":"","statusIds":[],"labelIds":null},"backlog":{"query":"","statusIds":[]}}`,
		`{"board":{"query":"","statusIds":[],"labelIds":[0]},"backlog":{"query":"","statusIds":[]}}`,
		`{"board":{"query":"","statusIds":[],"labelIds":[-1]},"backlog":{"query":"","statusIds":[]}}`,
		`{"board":{"query":"","statusIds":[],"labelIds":[1.5]},"backlog":{"query":"","statusIds":[]}}`,
		`{"board":{"query":"","statusIds":[],"labelIds":["1"]},"backlog":{"query":"","statusIds":[]}}`,
		fmt.Sprintf(`{"board":{"query":"","statusIds":[],"labelIds":[%s]},"backlog":{"query":"","statusIds":[]}}`, strings.Join(tooMany, ",")),
	}
	for _, p := range badPayloads {
		w = request(h, "PUT", "/api/list-filter", p)
		if w.Code != 400 {
			t.Fatalf("expected 400 for %s, got %d %s", p, w.Code, w.Body.String())
		}
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
