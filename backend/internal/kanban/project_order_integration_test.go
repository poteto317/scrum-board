package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"testing"
)

func TestMySQLProjectReorder(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)

	other, err := r.CreateProject(ctx, "other")
	if err != nil {
		t.Fatal(err)
	}
	listed, err := r.ListProjects(ctx)
	if err != nil || len(listed) != 2 {
		t.Fatalf("list: %+v %v", listed, err)
	}
	mainID := listed[0].ID
	if listed[1].ID != other.ID {
		t.Fatalf("expected other at end, got %+v", listed)
	}

	h := NewHandler(r)
	payload, _ := json.Marshal(map[string][]int64{"projectIds": {other.ID, mainID}})
	w := request(h, "PUT", "/api/projects/order", string(payload))
	if w.Code != 200 {
		t.Fatalf("PUT /api/projects/order: %d %s", w.Code, w.Body)
	}

	after, err := r.ListProjects(ctx)
	if err != nil {
		t.Fatal(err)
	}
	want := []int64{other.ID, mainID}
	if len(after) != 2 || after[0].ID != want[0] || after[1].ID != want[1] {
		t.Fatalf("order=%+v want ids=%v", after, want)
	}
	for i, p := range after {
		if p.Position != i {
			t.Fatalf("position[%d]=%d want %d", i, p.Position, i)
		}
	}

	for _, bad := range [][]int64{{mainID}, {mainID, other.ID, 999}} {
		if _, err := r.ReorderProjects(ctx, bad); !errors.Is(err, ErrProjectMismatch) {
			t.Fatalf("bad=%v: err=%v, want ErrProjectMismatch", bad, err)
		}
	}
	unchanged, err := r.ListProjects(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.EqualFunc(unchanged, after, func(a, b Project) bool {
		return a.ID == b.ID && a.Position == b.Position
	}) {
		t.Fatalf("mismatch mutated projects: before=%+v after=%+v", after, unchanged)
	}
}
