package kanban

import (
	"context"
	"database/sql"
	"testing"
)

func TestInitializeDeletedAtIdempotentMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}

	mustExec(t, db, `ALTER TABLE items DROP INDEX items_project_deleted_at`)
	mustExec(t, db, `ALTER TABLE items DROP COLUMN deleted_at`)
	if err := r.InitializeDeletedAt(ctx); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(`
SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='items' AND COLUMN_NAME='deleted_at'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("deleted_at missing: count=%d err=%v", count, err)
	}
	var deletedAt sql.NullTime
	if err := db.QueryRow(`SELECT deleted_at FROM items LIMIT 1`).Scan(&deletedAt); err != nil {
		t.Fatal(err)
	}
	if deletedAt.Valid {
		t.Fatalf("existing rows want deleted_at NULL, got %v", deletedAt.Time)
	}
	var idx int
	if err := db.QueryRow(`
SELECT COUNT(*) FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='items' AND INDEX_NAME='items_project_deleted_at'`).Scan(&idx); err != nil || idx == 0 {
		t.Fatalf("items_project_deleted_at missing: %d %v", idx, err)
	}
	if err := r.InitializeDeletedAt(ctx); err != nil {
		t.Fatal(err)
	}
}
