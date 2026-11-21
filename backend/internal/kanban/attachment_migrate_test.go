package kanban

import (
	"context"
	"testing"
)

func TestInitializeItemAttachmentsIdempotentAndKeepsItemIdentity(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}

	type ident struct {
		id      int64
		created string
	}
	readItems := func() []ident {
		t.Helper()
		rows, err := db.Query(`SELECT id, CAST(created_at AS CHAR) FROM items ORDER BY id`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var out []ident
		for rows.Next() {
			var row ident
			if err = rows.Scan(&row.id, &row.created); err != nil {
				t.Fatal(err)
			}
			out = append(out, row)
		}
		if err = rows.Err(); err != nil {
			t.Fatal(err)
		}
		return out
	}
	before := readItems()
	if len(before) == 0 {
		t.Fatal("seed item missing")
	}

	mustExec(t, db, `DROP TABLE IF EXISTS item_attachments`)
	if err := r.InitializeItemAttachments(ctx); err != nil {
		t.Fatal(err)
	}
	if err := r.InitializeItemAttachments(ctx); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(`
SELECT COUNT(*) FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='item_attachments'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("item_attachments missing: count=%d err=%v", count, err)
	}

	after := readItems()
	if len(after) != len(before) {
		t.Fatalf("item count %d want %d", len(after), len(before))
	}
	for i := range before {
		if after[i].id != before[i].id || after[i].created != before[i].created {
			t.Fatalf("identity changed: before %+v after %+v", before[i], after[i])
		}
	}
}
