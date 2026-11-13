package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestReorderColumnsHandler(t *testing.T) {
	r := fresh()
	h := NewHandler(r)
	w := request(h, "POST", "/api/columns", `{"name":"Review"}`)
	if w.Code != 201 {
		t.Fatalf("create column: %d %s", w.Code, w.Body)
	}
	var created Column
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}

	// Done (ID=3) の前に Review (ID=4) を配置する
	w = request(h, "PUT", "/api/columns/order", `{"columnIds":[1,2,4,3]}`)
	if w.Code != 200 {
		t.Fatalf("reorder: %d %s", w.Code, w.Body)
	}
	var resp struct {
		Columns []Column `json:"columns"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	wantIDs := []int64{1, 2, 4, 3}
	if len(resp.Columns) != len(wantIDs) {
		t.Fatalf("len=%d, want %d", len(resp.Columns), len(wantIDs))
	}
	for i, col := range resp.Columns {
		if col.ID != wantIDs[i] || col.Position != i {
			t.Fatalf("col[%d]=%+v, want id=%d pos=%d", i, col, wantIDs[i], i)
		}
	}

	// GET /api/board でも同じ順序が返ること
	w = request(h, "GET", "/api/board", "")
	if w.Code != 200 {
		t.Fatalf("board: %d", w.Code)
	}
	var board Board
	if err := json.Unmarshal(w.Body.Bytes(), &board); err != nil {
		t.Fatal(err)
	}
	for i, col := range board.Columns {
		if col.ID != wantIDs[i] {
			t.Fatalf("board.Columns[%d].ID=%d, want %d", i, col.ID, wantIDs[i])
		}
	}

	// 並び替え後に新規列を追加すると末尾に配置されること
	w = request(h, "POST", "/api/columns", `{"name":"QA"}`)
	if w.Code != 201 {
		t.Fatalf("create after reorder: %d %s", w.Code, w.Body)
	}
	w = request(h, "GET", "/api/board", "")
	if err := json.Unmarshal(w.Body.Bytes(), &board); err != nil {
		t.Fatal(err)
	}
	if len(board.Columns) != 5 || board.Columns[4].Name != "QA" {
		t.Fatalf("expected QA appended at end, got %+v", board.Columns)
	}
}

func TestReorderColumnsValidationAndConflict(t *testing.T) {
	cases := []struct {
		name, body string
		status     int
	}{
		{"missing field", `{}`, 400},
		{"null columnIds", `{"columnIds":null}`, 400},
		{"empty array", `{"columnIds":[]}`, 400},
		{"zero id", `{"columnIds":[1,0,3]}`, 400},
		{"negative id", `{"columnIds":[1,-2,3]}`, 400},
		{"duplicate id", `{"columnIds":[1,2,2]}`, 400},
		{"unknown field", `{"columnIds":[1,2,3],"extra":true}`, 400},
		{"malformed json", `{`, 400},
		{"multiple json", `{"columnIds":[1,2,3]}{}`, 400},
		{"missing existing column", `{"columnIds":[1,2]}`, 409},
		{"unknown column id", `{"columnIds":[1,2,99]}`, 409},
		{"extra column id", `{"columnIds":[1,2,3,99]}`, 409},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := fresh()
			h := NewHandler(r)
			w := request(h, "PUT", "/api/columns/order", tc.body)
			if w.Code != tc.status {
				t.Fatalf("status=%d want=%d body=%s", w.Code, tc.status, w.Body)
			}
			b, _ := r.Board(context.Background())
			if b.Columns[0].ID != 1 || b.Columns[1].ID != 2 || b.Columns[2].ID != 3 {
				t.Fatalf("columns mutated on error: %+v", b.Columns)
			}
		})
	}
}

type columnOrderFailureRepo struct {
	*memoryRepo
	err error
}

func (r columnOrderFailureRepo) ReorderColumns(context.Context, []int64) ([]Column, error) {
	return nil, r.err
}

func TestReorderColumnsStorageFailure(t *testing.T) {
	internalSecret := "internal-mysql-connection-lost-secret"
	r := columnOrderFailureRepo{memoryRepo: fresh(), err: errors.New(internalSecret)}
	w := request(NewHandler(r), "PUT", "/api/columns/order", `{"columnIds":[3,2,1]}`)
	if w.Code != 500 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	if strings.Contains(w.Body.String(), internalSecret) {
		t.Fatalf("leaked internal error detail: %s", w.Body.String())
	}
	b, _ := r.Board(context.Background())
	if b.Columns[0].ID != 1 || b.Columns[1].ID != 2 || b.Columns[2].ID != 3 {
		t.Fatalf("columns mutated on storage failure: %+v", b.Columns)
	}
}
