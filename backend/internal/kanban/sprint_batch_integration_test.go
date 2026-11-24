package kanban

import (
	"context"
	"errors"
	"testing"
	"time"
)

// mysqlSprintWithItems creates a sprint in the first project with n new items.
func mysqlSprintWithItems(t *testing.T, r MySQLRepository, name string, n int) (Sprint, []int64) {
	t.Helper()
	ctx := context.Background()
	projects, err := r.ListProjects(ctx)
	if err != nil || len(projects) == 0 {
		t.Fatalf("projects: %v %v", projects, err)
	}
	s, err := r.CreateSprint(ctx, SprintCreateInput{ProjectID: projects[0].ID, Name: name, StartDate: "2026-11-01", EndDate: "2026-11-14"})
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]int64, n)
	for i := range ids {
		pid := projects[0].ID
		it, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: name + " item", ProjectID: &pid})
		if err != nil {
			t.Fatal(err)
		}
		ids[i] = it.ID
	}
	if n > 0 {
		if s, err = r.ReplaceSprintItems(ctx, s.ID, ids, nil); err != nil {
			t.Fatal(err)
		}
	}
	return s, ids
}

func statements(t *testing.T, r MySQLRepository, run func()) int64 {
	t.Helper()
	before := sessionCounter(t, r, "Questions")
	run()
	return sessionCounter(t, r, "Questions") - before
}

func TestMySQLListSprintsStatementCountDoesNotGrowWithSprintsOrItems(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	projects, _ := r.ListProjects(ctx)
	mysqlSprintWithItems(t, r, "one", 1)
	db.SetMaxOpenConns(1) // a list that holds a result open while querying again hangs here
	listCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var few []Sprint
	nFew := statements(t, r, func() {
		var err error
		if few, err = r.ListSprints(listCtx, projects[0].ID); err != nil {
			t.Fatal(err)
		}
	})
	db.SetMaxOpenConns(12)
	for i := 0; i < 6; i++ {
		mysqlSprintWithItems(t, r, "more", 5)
	}
	db.SetMaxOpenConns(1)
	var many []Sprint
	nMany := statements(t, r, func() {
		var err error
		if many, err = r.ListSprints(listCtx, projects[0].ID); err != nil {
			t.Fatal(err)
		}
	})
	if len(few) != 1 || len(many) != 7 {
		t.Fatalf("sprints: %d, %d", len(few), len(many))
	}
	if nFew != nMany {
		t.Fatalf("ListSprints used %d statements for 1 sprint and %d for 7 sprints with 31 items", nFew, nMany)
	}
	for _, s := range many {
		if s.ItemCount != len(s.Items) {
			t.Fatalf("sprint %d: itemCount %d, items %d", s.ID, s.ItemCount, len(s.Items))
		}
		for _, it := range s.Items {
			if it.Title == "" || it.Number == 0 {
				t.Fatalf("a listed member must carry what visibility needs: %+v", it)
			}
		}
	}
}

func TestMySQLReplaceSprintItemsStatementCountDoesNotGrowWithItems(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	small, smallIDs := mysqlSprintWithItems(t, r, "small", 1)
	large, largeIDs := mysqlSprintWithItems(t, r, "large", 12)
	db.SetMaxOpenConns(1)
	nSmall := statements(t, r, func() {
		if _, err := r.ReplaceSprintItems(ctx, small.ID, smallIDs, nil); err != nil {
			t.Fatal(err)
		}
	})
	nLarge := statements(t, r, func() {
		if _, err := r.ReplaceSprintItems(ctx, large.ID, largeIDs, nil); err != nil {
			t.Fatal(err)
		}
	})
	if nSmall != nLarge {
		t.Fatalf("ReplaceSprintItems used %d statements for 1 item and %d for 12", nSmall, nLarge)
	}
}

func mysqlSprintItemIDs(t *testing.T, r MySQLRepository, sprintID int64) []int64 {
	t.Helper()
	s, err := r.GetSprint(context.Background(), sprintID)
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]int64, len(s.Items))
	for i, it := range s.Items {
		ids[i] = it.ID
	}
	return ids
}

// The order in which ReplaceSprintItems reports a member that cannot join: not found or deleted,
// then archived, then another project, then another open sprint. Each case here fails for one
// reason only, and the last one for two (the first reason in the order must win).
func TestMySQLReplaceSprintItemsReportsTheFirstReasonAMemberCannotJoin(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	sprint, _ := mysqlSprintWithItems(t, r, "target", 0)
	_, otherIDs := mysqlSprintWithItems(t, r, "other", 1)
	mk := func(title string) int64 {
		it, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: title})
		if err != nil {
			t.Fatal(err)
		}
		return it.ID
	}
	deleted, archived, elsewhere := mk("deleted"), mk("archived"), otherIDs[0]
	if _, err := db.Exec("UPDATE items SET deleted_at=UTC_TIMESTAMP(6) WHERE id=?", deleted); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE items SET archived_at=UTC_TIMESTAMP(6) WHERE id=?", archived); err != nil {
		t.Fatal(err)
	}
	project2, err := r.CreateProject(ctx, "second")
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := r.CreateItem(ctx, ItemInput{ColumnID: 1, Title: "foreign", ProjectID: &project2.ID})
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name string
		ids  []int64
		want error
	}{
		{"unknown id", []int64{999999}, ErrNotFound},
		{"deleted", []int64{deleted}, ErrNotFound},
		{"archived", []int64{archived}, ErrSprintConflict},
		{"another project", []int64{foreign.ID}, ErrSprint},
		{"another open sprint", []int64{elsewhere}, ErrSprintConflict},
		{"deleted before archived (the order of the list decides)", []int64{deleted, archived}, ErrNotFound},
		{"another project before another sprint", []int64{foreign.ID, elsewhere}, ErrSprint},
	}
	for _, c := range cases {
		if _, err := r.ReplaceSprintItems(ctx, sprint.ID, c.ids, nil); !errors.Is(err, c.want) {
			t.Fatalf("%s: got %v, want %v", c.name, err, c.want)
		}
	}
	if got := mysqlSprintItemIDs(t, r, sprint.ID); len(got) != 0 {
		t.Fatalf("a rejected replacement must change nothing, members %v", got)
	}
}

func TestMySQLReplaceSprintItemsKeepsArchivedAndRetainedMembersAndAllowsEmpty(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	sprint, ids := mysqlSprintWithItems(t, r, "keep", 4) // ids[0..3]
	if _, err := db.Exec("UPDATE items SET archived_at=UTC_TIMESTAMP(6) WHERE id=?", ids[0]); err != nil {
		t.Fatal(err)
	}
	// ids[1] is "hidden from the caller": it is passed as retained, not as submitted.
	got, err := r.ReplaceSprintItems(ctx, sprint.ID, []int64{ids[3], ids[2]}, []int64{ids[1]})
	if err != nil {
		t.Fatal(err)
	}
	have := make([]int64, len(got.Items))
	for i, it := range got.Items {
		have[i] = it.ID
	}
	want := []int64{ids[3], ids[2], ids[1], ids[0]} // submitted in order, then retained, then archived
	if len(have) != len(want) {
		t.Fatalf("members %v, want %v", have, want)
	}
	for i := range want {
		if have[i] != want[i] {
			t.Fatalf("members %v, want %v", have, want)
		}
	}
	// With nothing left but the archived one, an empty submission still works.
	got, err = r.ReplaceSprintItems(ctx, sprint.ID, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 1 || got.Items[0].ID != ids[0] {
		t.Fatalf("after an empty replacement only the archived member stays: %+v", got.Items)
	}
}

func TestMySQLSprintMembersCarryWhatVisibilityTakes(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	sprint, ids := mysqlSprintWithItems(t, r, "acl", 2)
	if _, err := db.Exec("UPDATE items SET view_access='restricted', edit_access='restricted', created_by_user_id=1 WHERE id=?", ids[1]); err != nil {
		t.Fatal(err)
	}
	projects, _ := r.ListProjects(ctx)
	list, err := r.ListSprints(ctx, projects[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	for name, items := range map[string][]SprintItem{"list": list[0].Items, "detail": mysqlSprintDetailItems(t, r, sprint.ID)} {
		if len(items) != 2 {
			t.Fatalf("%s: %+v", name, items)
		}
		open, restricted := items[0], items[1]
		if open.ViewAccess != "open" || open.CreatedByUserID != nil {
			t.Fatalf("%s open member: %+v", name, open)
		}
		if restricted.ViewAccess != "restricted" || restricted.EditAccess != "restricted" || restricted.CreatedByUserID == nil || *restricted.CreatedByUserID != 1 {
			t.Fatalf("%s restricted member: %+v", name, restricted)
		}
	}
}

func mysqlSprintDetailItems(t *testing.T, r MySQLRepository, id int64) []SprintItem {
	t.Helper()
	s, err := r.GetSprint(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return s.Items
}

// With small batches the statements split, but the result and the error order stay the same.
func TestMySQLSprintBatchesGiveTheSameResultWhenSplit(t *testing.T) {
	old := sprintBatchSize
	sprintBatchSize = 3
	t.Cleanup(func() { sprintBatchSize = old })
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	sprint, ids := mysqlSprintWithItems(t, r, "split", 8)
	// Reversed, with a duplicate-free submission: positions follow the submitted order.
	reversed := make([]int64, len(ids))
	for i, id := range ids {
		reversed[len(ids)-1-i] = id
	}
	got, err := r.ReplaceSprintItems(ctx, sprint.ID, reversed, nil)
	if err != nil {
		t.Fatal(err)
	}
	for i, it := range got.Items {
		if it.ID != reversed[i] {
			t.Fatalf("member %d is %d, want %d", i, it.ID, reversed[i])
		}
	}
	listed, err := r.ListSprints(ctx, got.ProjectID)
	if err != nil || len(listed) == 0 {
		t.Fatalf("list: %v %v", listed, err)
	}
	for i := 0; i < 5; i++ { // more sprints than one batch
		mysqlSprintWithItems(t, r, "extra", 1)
	}
	listed, err = r.ListSprints(ctx, got.ProjectID)
	if err != nil {
		t.Fatal(err)
	}
	total := 0
	for _, s := range listed {
		total += s.ItemCount
	}
	if len(listed) != 6 || total != 8+5 {
		t.Fatalf("%d sprints with %d members", len(listed), total)
	}
}
