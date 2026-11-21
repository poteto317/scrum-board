package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sync"
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

func TestMySQLProjectReorderConcurrency(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)

	second, err := r.CreateProject(ctx, "second")
	if err != nil {
		t.Fatal(err)
	}
	third, err := r.CreateProject(ctx, "third")
	if err != nil {
		t.Fatal(err)
	}
	listed, err := r.ListProjects(ctx)
	if err != nil || len(listed) != 3 {
		t.Fatalf("list: %+v %v", listed, err)
	}
	a, b, c := listed[0].ID, second.ID, third.ID
	perms := [][]int64{
		{a, b, c},
		{c, b, a},
		{b, c, a},
		{b, a, c},
	}

	const workers = 20
	phase1Errs := make(chan error, workers)
	var wg sync.WaitGroup
	for i := range workers {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			if _, err := r.ReorderProjects(ctx, perms[idx%len(perms)]); err != nil {
				phase1Errs <- fmt.Errorf("phase1 reorder worker %d: %w", idx, err)
			}
		}(i)
	}
	wg.Wait()
	close(phase1Errs)
	for err := range phase1Errs {
		t.Fatal(err)
	}

	after, err := r.ListProjects(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != 3 {
		t.Fatalf("len=%d want 3: %+v", len(after), after)
	}
	seenPos := make(map[int]bool, len(after))
	for i, p := range after {
		if p.Position != i {
			t.Fatalf("project[%d]=%+v, want position=%d", i, p, i)
		}
		if seenPos[p.Position] {
			t.Fatalf("duplicate position %d in %+v", p.Position, after)
		}
		seenPos[p.Position] = true
	}

	errs := make(chan error, workers+2)
	for i := range workers {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			_, err := r.ReorderProjects(ctx, perms[idx%len(perms)])
			if err != nil && !errors.Is(err, ErrProjectMismatch) {
				errs <- fmt.Errorf("reorder worker %d: %w", idx, err)
			}
		}(i)
	}
	for i := range 2 {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			if _, err := r.CreateProject(ctx, fmt.Sprintf("extra-%d", idx)); err != nil {
				errs <- fmt.Errorf("create worker %d: %w", idx, err)
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}

	final, err := r.ListProjects(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(final) != 5 {
		t.Fatalf("expected 5 projects after concurrent create, got %d: %+v", len(final), final)
	}
	seenPos = make(map[int]bool, len(final))
	for _, p := range final {
		if seenPos[p.Position] {
			t.Fatalf("duplicate position %d in %+v", p.Position, final)
		}
		seenPos[p.Position] = true
	}
}
