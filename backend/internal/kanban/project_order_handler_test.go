package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

func seedThreeProjects(t *testing.T, h http.Handler) []int64 {
	t.Helper()
	ids := []int64{1}
	for _, name := range []string{"Beta", "Gamma"} {
		w := request(h, "POST", "/api/projects", `{"name":"`+name+`"}`)
		if w.Code != 201 {
			t.Fatalf("create %s: %d %s", name, w.Code, w.Body)
		}
		var p Project
		if err := json.Unmarshal(w.Body.Bytes(), &p); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, p.ID)
	}
	return ids
}

func TestReorderProjectsHandler(t *testing.T) {
	h := NewHandler(fresh())
	ids := seedThreeProjects(t, h)
	body := `{"projectIds":[` +
		strconv.FormatInt(ids[2], 10) + `,` +
		strconv.FormatInt(ids[1], 10) + `,` +
		strconv.FormatInt(ids[0], 10) + `]}`
	w := request(h, "PUT", "/api/projects/order", body)
	if w.Code != 200 {
		t.Fatalf("reorder: %d %s", w.Code, w.Body)
	}
	var resp struct {
		Projects []Project `json:"projects"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	want := []int64{ids[2], ids[1], ids[0]}
	if len(resp.Projects) != len(want) {
		t.Fatalf("len=%d want %d", len(resp.Projects), len(want))
	}
	for i, p := range resp.Projects {
		if p.ID != want[i] || p.Position != i {
			t.Fatalf("projects[%d]=%+v want id=%d pos=%d", i, p, want[i], i)
		}
	}
	w = request(h, "GET", "/api/projects", "")
	if w.Code != 200 {
		t.Fatalf("list: %d", w.Code)
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	for i, p := range resp.Projects {
		if p.ID != want[i] {
			t.Fatalf("GET projects[%d].ID=%d want %d", i, p.ID, want[i])
		}
	}
}

func TestReorderProjectsValidationAndConflict(t *testing.T) {
	cases := []struct {
		name, body string
		status     int
	}{
		{"missing field", `{}`, 400},
		{"null projectIds", `{"projectIds":null}`, 400},
		{"empty array", `{"projectIds":[]}`, 400},
		{"zero id", `{"projectIds":[1,0,2]}`, 400},
		{"negative id", `{"projectIds":[1,-2,2]}`, 400},
		{"duplicate id", `{"projectIds":[1,2,2]}`, 400},
		{"unknown field", `{"projectIds":[1,2,3],"extra":true}`, 400},
		{"malformed json", `{`, 400},
		{"multiple json", `{"projectIds":[1,2,3]}{}`, 400},
		{"missing existing project", `{"projectIds":[1,2]}`, 409},
		{"unknown project id", `{"projectIds":[1,2,99]}`, 409},
		{"extra project id", `{"projectIds":[1,2,3,99]}`, 409},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := fresh()
			h := NewHandler(r)
			_ = seedThreeProjects(t, h)
			w := request(h, "PUT", "/api/projects/order", tc.body)
			if w.Code != tc.status {
				t.Fatalf("status=%d want=%d body=%s", w.Code, tc.status, w.Body)
			}
			listed, err := r.ListProjects(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if len(listed) != 3 || listed[0].ID != 1 || listed[0].Position != 0 {
				t.Fatalf("projects mutated on error: %+v", listed)
			}
		})
	}
}

type projectOrderFailureRepo struct {
	*memoryRepo
	err error
}

func (r projectOrderFailureRepo) ReorderProjects(context.Context, []int64) ([]Project, error) {
	return nil, r.err
}

func TestReorderProjectsStorageFailure(t *testing.T) {
	internalSecret := "internal-mysql-connection-lost-secret"
	base := fresh()
	ids := seedThreeProjects(t, NewHandler(base))
	r := projectOrderFailureRepo{memoryRepo: base, err: errors.New(internalSecret)}
	body := `{"projectIds":[` +
		strconv.FormatInt(ids[2], 10) + `,` +
		strconv.FormatInt(ids[1], 10) + `,` +
		strconv.FormatInt(ids[0], 10) + `]}`
	w := request(NewHandler(r), "PUT", "/api/projects/order", body)
	if w.Code != 500 {
		t.Fatalf("status=%d want 500 body=%s", w.Code, w.Body)
	}
	if strings.Contains(w.Body.String(), internalSecret) {
		t.Fatalf("leaked internal error: %s", w.Body)
	}
}
