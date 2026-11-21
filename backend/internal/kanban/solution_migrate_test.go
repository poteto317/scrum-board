package kanban

import (
	"context"
	"testing"
)

func TestInitializeSolutionIdempotentMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}

	mustExec(t, db, `ALTER TABLE items DROP COLUMN solution`)
	if err := r.InitializeSolution(ctx); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(`
SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='items' AND COLUMN_NAME='solution'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("solution missing: count=%d err=%v", count, err)
	}
	var solution string
	if err := db.QueryRow(`SELECT solution FROM items LIMIT 1`).Scan(&solution); err != nil {
		t.Fatal(err)
	}
	if solution != "" {
		t.Fatalf("existing rows want solution=\"\", got %q", solution)
	}
	if err := r.InitializeSolution(ctx); err != nil {
		t.Fatal(err)
	}
}
