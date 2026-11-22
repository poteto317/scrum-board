package kanban

import (
	"context"
	"testing"
)

func TestInitializeCommentsIdempotentMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}

	mustExec(t, db, `DROP TABLE IF EXISTS item_comments`)
	if err := r.InitializeComments(ctx); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(`
SELECT COUNT(*) FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='item_comments'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("item_comments missing: count=%d err=%v", count, err)
	}
	if err := r.InitializeComments(ctx); err != nil {
		t.Fatal(err)
	}
	var col int
	if err := db.QueryRow(`SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='item_comments' AND COLUMN_NAME='created_by_user_id'`).Scan(&col); err != nil || col != 1 {
		t.Fatalf("created_by_user_id column: count=%d err=%v", col, err)
	}
}
