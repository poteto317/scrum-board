package kanban

import (
	"database/sql"
	"testing"
)

func TestInitializeItemACLIdempotentMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := t.Context()
	// Schema already has ACL columns; Initialize must be a no-op twice.
	if err := r.InitializeItemACL(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r.InitializeItemACL(ctx); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='items' AND COLUMN_NAME='view_access'`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("view_access: %v n=%d", err, n)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='item_acl_entries'`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("item_acl_entries: %v n=%d", err, n)
	}
	var view, edit string
	var created sql.NullInt64
	err := db.QueryRow(`SELECT view_access, edit_access, created_by_user_id FROM items LIMIT 1`).Scan(&view, &edit, &created)
	if err == sql.ErrNoRows {
		return
	}
	if err != nil {
		t.Fatal(err)
	}
	if view != ViewAccessOpen || edit != EditAccessOpen {
		t.Fatalf("defaults view=%q edit=%q", view, edit)
	}
}
