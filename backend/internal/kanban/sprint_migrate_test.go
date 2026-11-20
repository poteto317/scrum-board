package kanban

import (
	"context"
	"testing"
)

func TestInitializeSprintsIdempotent(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	if err := r.InitializeSprints(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r.InitializeSprints(ctx); err != nil {
		t.Fatal(err)
	}
	assertIndex(t, r, "sprints", "sprints_project_status")
	assertIndex(t, r, "sprints", "sprints_project_start")
	assertIndex(t, r, "sprint_items", "sprint_items_item")
	assertFK(t, r, "sprints", "fk_sprints_project")
	assertFK(t, r, "sprint_items", "fk_sprint_items_sprint")
	assertFK(t, r, "sprint_items", "fk_sprint_items_item")
}
