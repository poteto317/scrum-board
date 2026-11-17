package kanban

import (
	"context"
	"testing"
)

func TestInitializeCloseReasonIdempotentMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}

	mustExec(t, db, `ALTER TABLE items DROP COLUMN close_reason`)
	if err := r.InitializeCloseReason(ctx); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(`
SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='items' AND COLUMN_NAME='close_reason'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("close_reason missing: count=%d err=%v", count, err)
	}
	var reason string
	if err := db.QueryRow(`SELECT close_reason FROM items LIMIT 1`).Scan(&reason); err != nil {
		t.Fatal(err)
	}
	if reason != "" {
		t.Fatalf("existing rows want close_reason=\"\", got %q", reason)
	}
	if err := r.InitializeCloseReason(ctx); err != nil {
		t.Fatal(err)
	}
}
