package kanban

import (
	"context"
	"database/sql"
	"testing"
)

func TestInitializeDueAtIdempotentMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}

	mustExec(t, db, `ALTER TABLE items DROP COLUMN due_at`)
	if err := r.InitializeDueAt(ctx); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(`
SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='items' AND COLUMN_NAME='due_at'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("due_at missing: count=%d err=%v", count, err)
	}
	var dueAt sql.NullTime
	if err := db.QueryRow(`SELECT due_at FROM items LIMIT 1`).Scan(&dueAt); err != nil {
		t.Fatal(err)
	}
	if dueAt.Valid {
		t.Fatalf("existing rows want due_at NULL, got %v", dueAt.Time)
	}
	if err := r.InitializeDueAt(ctx); err != nil {
		t.Fatal(err)
	}
}
