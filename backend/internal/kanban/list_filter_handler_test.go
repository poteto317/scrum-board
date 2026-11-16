package kanban

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestListFilterGETEmpty(t *testing.T) {
	h := NewHandler(fresh())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/list-filter", nil))
	if rec.Code != 200 {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var got ListFilter
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Query != "" || got.StatusIDs == nil || len(got.StatusIDs) != 0 {
		t.Fatalf("got %+v", got)
	}
}

func TestListFilterPUTRoundTrip(t *testing.T) {
	repo := fresh()
	h := NewHandler(repo)
	body := `{"query":"  hello  ","statusIds":[1,2,2,999]}`
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/api/list-filter", strings.NewReader(body)))
	if rec.Code != 200 {
		t.Fatalf("put status %d body %s", rec.Code, rec.Body.String())
	}
	var put ListFilter
	if err := json.Unmarshal(rec.Body.Bytes(), &put); err != nil {
		t.Fatal(err)
	}
	if put.Query != "hello" || len(put.StatusIDs) != 2 || put.StatusIDs[0] != 1 || put.StatusIDs[1] != 2 {
		t.Fatalf("normalized put %+v", put)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/list-filter", nil))
	var got ListFilter
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Query != "hello" || len(got.StatusIDs) != 2 {
		t.Fatalf("get after put %+v", got)
	}
}

func TestListFilterPUTValidation(t *testing.T) {
	h := NewHandler(fresh())
	cases := []struct {
		name string
		body string
	}{
		{"unknown key", `{"query":"","statusIds":[],"extra":1}`},
		{"null query", `{"query":null,"statusIds":[]}`},
		{"null statusIds", `{"query":"","statusIds":null}`},
		{"missing query", `{"statusIds":[]}`},
		{"missing statusIds", `{"query":""}`},
		{"non-array statusIds", `{"query":"","statusIds":1}`},
		{"non-positive id", `{"query":"","statusIds":[0]}`},
		{"float id", `{"query":"","statusIds":[1.5]}`},
		{"query too long", `{"query":"` + strings.Repeat("a", 201) + `","statusIds":[]}`},
		{"query too many runes", `{"query":"` + strings.Repeat("あ", 201) + `","statusIds":[]}`},
		{"statusIds too many", `{"query":"","statusIds":[` + strings.TrimRight(strings.Repeat("1,", 65), ",") + `]}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, "/api/list-filter", strings.NewReader(tc.body)))
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
