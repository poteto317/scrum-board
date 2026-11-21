package kanban

import (
	"context"
	"testing"
)

func TestInitializeFavoriteIdempotentMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}

	mustExec(t, db, `ALTER TABLE items DROP COLUMN favorite`)
	if err := r.InitializeFavorite(ctx); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(`
SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='items' AND COLUMN_NAME='favorite'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("favorite missing: count=%d err=%v", count, err)
	}
	var favorite int
	if err := db.QueryRow(`SELECT favorite FROM items LIMIT 1`).Scan(&favorite); err != nil {
		t.Fatal(err)
	}
	if favorite != 0 {
		t.Fatalf("existing rows want favorite=0, got %d", favorite)
	}
	if err := r.InitializeFavorite(ctx); err != nil {
		t.Fatal(err)
	}
}
