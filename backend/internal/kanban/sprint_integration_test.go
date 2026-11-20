package kanban

import (
	"context"
	"errors"
	"sync"
	"testing"
)

func TestMySQLSprintCRUDActivateCompleteMembers(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}

	created, err := r.CreateSprint(ctx, SprintCreateInput{
		Name: "Sprint 1", Goal: "g", StartDate: "2026-11-21", EndDate: "2026-12-04", ProjectID: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.Status != SprintStatusPlanned || created.Velocity != nil || created.ID == 0 {
		t.Fatalf("created=%+v", created)
	}

	item, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "m", Description: "d"})
	if err != nil {
		t.Fatal(err)
	}
	replaced, err := r.ReplaceSprintItems(ctx, created.ID, []int64{item.ID}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(replaced.Items) != 1 || replaced.Items[0].ID != item.ID {
		t.Fatalf("members=%+v", replaced.Items)
	}

	active, err := r.ActivateSprint(ctx, created.ID)
	if err != nil || active.Status != SprintStatusActive {
		t.Fatalf("activate: %+v %v", active, err)
	}
	other, err := r.CreateSprint(ctx, SprintCreateInput{
		Name: "Sprint 2", StartDate: "2026-12-05", EndDate: "2026-12-18", ProjectID: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = r.ActivateSprint(ctx, other.ID); !errors.Is(err, ErrSprintConflict) {
		t.Fatalf("second active: %v", err)
	}

	vel := 4
	completed, err := r.CompleteSprint(ctx, created.ID, &vel)
	if err != nil || completed.Status != SprintStatusCompleted || completed.Velocity == nil || *completed.Velocity != 4 {
		t.Fatalf("complete: %+v %v", completed, err)
	}
	if err = r.DeleteSprint(ctx, created.ID); !errors.Is(err, ErrSprintConflict) {
		t.Fatalf("delete completed: %v", err)
	}

	// CASCADE on hard delete item
	var n int
	if err = r.HardDeleteItem(ctx, item.ID); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM sprint_items WHERE item_id=?`, item.ID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("cascade: n=%d err=%v", n, err)
	}
}

func TestMySQLSprintSoftDeleteAndProjectMoveClear(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	s, err := r.CreateSprint(ctx, SprintCreateInput{
		Name: "S", StartDate: "2026-11-01", EndDate: "2026-11-14", ProjectID: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	a, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "a", Description: "d"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = r.ReplaceSprintItems(ctx, s.ID, []int64{a.ID}, nil); err != nil {
		t.Fatal(err)
	}
	if err = r.DeleteItem(ctx, a.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	if err = db.QueryRow(`SELECT COUNT(*) FROM sprint_items WHERE item_id=?`, a.ID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("soft delete clear: n=%d err=%v", n, err)
	}

	b, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "b", Description: "d"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = r.ReplaceSprintItems(ctx, s.ID, []int64{b.ID}, nil); err != nil {
		t.Fatal(err)
	}
	p2, err := r.CreateProject(ctx, "other")
	if err != nil {
		t.Fatal(err)
	}
	pid := p2.ID
	if _, err = r.UpdateItem(ctx, b.ID, ItemPatch{ProjectID: &pid}); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM sprint_items WHERE item_id=?`, b.ID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("project move clear: n=%d err=%v", n, err)
	}
}

// TestMySQLActivateSprintConcurrent requires KANBAN_TEST_DSN (skipped otherwise).
// Two planned sprints in one project: only one concurrent ActivateSprint may succeed.
func TestMySQLActivateSprintConcurrent(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	a, err := r.CreateSprint(ctx, SprintCreateInput{
		Name: "A", StartDate: "2026-11-01", EndDate: "2026-11-14", ProjectID: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	b, err := r.CreateSprint(ctx, SprintCreateInput{
		Name: "B", StartDate: "2026-12-01", EndDate: "2026-12-14", ProjectID: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, id := range []int64{a.ID, b.ID} {
		id := id
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := r.ActivateSprint(ctx, id)
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	var ok, conflict int
	for err := range results {
		switch {
		case err == nil:
			ok++
		case errors.Is(err, ErrSprintConflict):
			conflict++
		default:
			t.Fatalf("unexpected: %v", err)
		}
	}
	if ok != 1 || conflict != 1 {
		t.Fatalf("want one success and one conflict, got ok=%d conflict=%d", ok, conflict)
	}
}

func TestMySQLReplaceSprintItemsConcurrent(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	s, err := r.CreateSprint(ctx, SprintCreateInput{
		Name: "S", StartDate: "2026-11-01", EndDate: "2026-11-14", ProjectID: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	items := make([]int64, 0, 4)
	for i := 0; i < 4; i++ {
		it, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "m", Description: "d"})
		if err != nil {
			t.Fatal(err)
		}
		items = append(items, it.ID)
	}
	var wg sync.WaitGroup
	errCh := make(chan error, 8)
	orders := [][]int64{
		{items[0], items[1], items[2], items[3]},
		{items[3], items[2], items[1], items[0]},
	}
	for round := 0; round < 4; round++ {
		order := orders[round%2]
		wg.Add(1)
		go func(ids []int64) {
			defer wg.Done()
			_, err := r.ReplaceSprintItems(ctx, s.ID, ids, nil)
			errCh <- err
		}(append([]int64(nil), order...))
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		if err != nil {
			t.Fatalf("concurrent replace: %v", err)
		}
	}
	var n int
	if err = db.QueryRow(`SELECT COUNT(*) FROM sprint_items WHERE sprint_id=?`, s.ID).Scan(&n); err != nil || n != 4 {
		t.Fatalf("member count: n=%d err=%v", n, err)
	}
}
