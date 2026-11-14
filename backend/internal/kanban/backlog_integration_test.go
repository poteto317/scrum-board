package kanban

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sync"
	"testing"
	"time"
)

func TestMySQLBacklogReorderAndCreateAppend(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)

	var ids []int64
	for _, title := range []string{"A", "B", "C"} {
		c, err := r.CreateCard(ctx, CardInput{ColumnID: 1, Title: title})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, c.ID)
	}
	// seed card (id=1) + A,B,C
	backlog, err := r.Backlog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(backlog) != 4 {
		t.Fatalf("len=%d want 4", len(backlog))
	}
	seedID := backlog[0].ID
	order := []int64{ids[2], seedID, ids[0], ids[1]}
	h := NewHandler(r)
	payload, _ := json.Marshal(map[string][]int64{"cardIds": order})
	w := request(h, "PUT", "/api/backlog/order", string(payload))
	if w.Code != 200 {
		t.Fatalf("PUT /api/backlog/order: %d %s", w.Code, w.Body)
	}
	backlog, err = r.Backlog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for i, want := range order {
		if backlog[i].ID != want || backlog[i].BacklogPosition != i {
			t.Fatalf("card[%d]=%+v want id=%d pos=%d", i, backlog[i], want, i)
		}
	}

	d, err := r.CreateCard(ctx, CardInput{ColumnID: 3, Title: "D"})
	if err != nil {
		t.Fatal(err)
	}
	if d.BacklogPosition != 4 {
		t.Fatalf("D backlogPosition=%d want 4", d.BacklogPosition)
	}
	backlog, err = r.Backlog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if backlog[len(backlog)-1].ID != d.ID {
		t.Fatalf("expected D at end, got %+v", backlog)
	}

	before := slices.Clone(backlog)
	for _, bad := range [][]int64{{ids[0], ids[1]}, {ids[0], ids[1], ids[2], seedID, 999}} {
		if _, err := r.ReorderBacklog(ctx, bad); !errors.Is(err, ErrBacklogMismatch) {
			t.Fatalf("bad=%v: err=%v want ErrBacklogMismatch", bad, err)
		}
	}
	after, err := r.Backlog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.EqualFunc(before, after, func(a, b Card) bool {
		return a.ID == b.ID && a.BacklogPosition == b.BacklogPosition
	}) {
		t.Fatalf("mismatch mutated backlog: before=%+v after=%+v", before, after)
	}
}

func TestMySQLBacklogInitializeIdempotent(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	c1, err := r.CreateCard(ctx, CardInput{ColumnID: 1, Title: "one"})
	if err != nil {
		t.Fatal(err)
	}
	c2, err := r.CreateCard(ctx, CardInput{ColumnID: 1, Title: "two"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = r.ReorderBacklog(ctx, []int64{c2.ID, 1, c1.ID}); err != nil {
		t.Fatal(err)
	}
	before, err := r.Backlog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if err = r.InitializeBacklogPositions(ctx); err != nil {
			t.Fatal(err)
		}
	}
	after, err := r.Backlog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.EqualFunc(before, after, func(a, b Card) bool {
		return a.ID == b.ID && a.BacklogPosition == b.BacklogPosition
	}) {
		t.Fatalf("re-init changed order: before=%+v after=%+v", before, after)
	}
}

func TestMySQLBacklogBackfillAllZeroPreservesUpdatedAt(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	for _, title := range []string{"late", "early"} {
		if _, err := r.CreateCard(ctx, CardInput{ColumnID: 1, Title: title}); err != nil {
			t.Fatal(err)
		}
	}
	// Force the ALTER-DEFAULT-0 path: every card shares backlog_position=0.
	if _, err := db.ExecContext(ctx, "UPDATE cards SET backlog_position=0, updated_at=updated_at"); err != nil {
		t.Fatal(err)
	}
	before, err := r.Backlog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(before) < 2 {
		t.Fatalf("need >=2 cards, got %d", len(before))
	}
	updatedBefore := map[int64]time.Time{}
	for _, c := range before {
		updatedBefore[c.ID] = c.UpdatedAt
		if c.BacklogPosition != 0 {
			t.Fatalf("expected all-zero before backfill, got %+v", c)
		}
	}
	if err = r.InitializeBacklogPositions(ctx); err != nil {
		t.Fatal(err)
	}
	after, err := r.Backlog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for i, c := range after {
		if c.BacklogPosition != i {
			t.Fatalf("after[%d]=%+v want position %d", i, c, i)
		}
		if !c.UpdatedAt.Equal(updatedBefore[c.ID]) {
			t.Fatalf("updated_at changed for id=%d: before=%v after=%v", c.ID, updatedBefore[c.ID], c.UpdatedAt)
		}
	}
	rows, err := db.QueryContext(ctx, "SELECT id FROM cards ORDER BY created_at,id")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var ordered []int64
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ordered = append(ordered, id)
	}
	for i, c := range after {
		if c.ID != ordered[i] {
			t.Fatalf("order[%d]=%d want %d (created_at,id)", i, c.ID, ordered[i])
		}
	}
}

func TestMySQLBacklogReorderPreservesUpdatedAt(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	if _, err := r.CreateCard(ctx, CardInput{ColumnID: 1, Title: "one"}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.CreateCard(ctx, CardInput{ColumnID: 1, Title: "two"}); err != nil {
		t.Fatal(err)
	}
	before, err := r.Backlog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	order := make([]int64, len(before))
	updated := map[int64]time.Time{}
	for i, c := range before {
		order[i] = c.ID
		updated[c.ID] = c.UpdatedAt
	}
	slices.Reverse(order)
	after, err := r.ReorderBacklog(ctx, order)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range after {
		if !c.UpdatedAt.Equal(updated[c.ID]) {
			t.Fatalf("reorder changed updated_at id=%d", c.ID)
		}
	}
}

func TestMySQLBacklogReorderConcurrency(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)

	var ids []int64
	for i := 0; i < 3; i++ {
		c, err := r.CreateCard(ctx, CardInput{ColumnID: 1, Title: fmt.Sprintf("C%d", i)})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, c.ID)
	}
	seed, err := r.Backlog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	all := make([]int64, len(seed))
	for i, c := range seed {
		all[i] = c.ID
	}
	perms := [][]int64{
		{all[0], all[1], all[2], all[3]},
		{all[3], all[2], all[1], all[0]},
		{all[1], all[3], all[0], all[2]},
		{all[2], all[0], all[3], all[1]},
	}

	const workers = 20
	errs := make(chan error, workers)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			if _, err := r.ReorderBacklog(ctx, perms[idx%len(perms)]); err != nil {
				errs <- err
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	backlog, err := r.Backlog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[int]struct{}{}
	for _, c := range backlog {
		if _, ok := seen[c.BacklogPosition]; ok {
			t.Fatalf("duplicate backlog_position: %+v", backlog)
		}
		seen[c.BacklogPosition] = struct{}{}
	}
	if len(seen) != len(backlog) {
		t.Fatalf("positions not contiguous unique: %+v", backlog)
	}

	createErrs := make(chan error, workers)
	reorderErrs := make(chan error, workers)
	wg = sync.WaitGroup{}
	for i := 0; i < workers; i++ {
		wg.Add(2)
		go func(idx int) {
			defer wg.Done()
			current, err := r.Backlog(ctx)
			if err != nil {
				reorderErrs <- err
				return
			}
			order := make([]int64, len(current))
			for j, c := range current {
				order[j] = c.ID
			}
			slices.Reverse(order)
			if _, err := r.ReorderBacklog(ctx, order); err != nil && !errors.Is(err, ErrBacklogMismatch) {
				reorderErrs <- err
			}
		}(i)
		go func(idx int) {
			defer wg.Done()
			_, err := r.CreateCard(ctx, CardInput{ColumnID: 1, Title: fmt.Sprintf("N%d", idx)})
			if err != nil {
				createErrs <- err
			}
		}(i)
	}
	wg.Wait()
	close(createErrs)
	close(reorderErrs)
	for err := range createErrs {
		t.Fatal(err)
	}
	for err := range reorderErrs {
		t.Fatal(err)
	}
	final, err := r.Backlog(ctx)
	if err != nil {
		t.Fatal(err)
	}
	posSeen := map[int]struct{}{}
	for i, c := range final {
		if c.BacklogPosition != i {
			t.Fatalf("expected contiguous positions, got %+v", final)
		}
		if _, ok := posSeen[c.BacklogPosition]; ok {
			t.Fatalf("duplicate position after concurrency: %+v", final)
		}
		posSeen[c.BacklogPosition] = struct{}{}
	}
}
