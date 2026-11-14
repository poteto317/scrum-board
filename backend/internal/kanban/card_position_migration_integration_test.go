package kanban

import (
	"context"
	"testing"
)

// A database created before drag & drop has no cards.position: startup must add it and backfill by
// (created_at, id), then keep a manual order on every later start.
func TestInitializeCardPositionsOnLegacySchemaMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	exec := func(q string) {
		t.Helper()
		if _, err := db.ExecContext(ctx, q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	// The foreign key needs an index on column_id, so add the legacy one before dropping the new one.
	exec("ALTER TABLE cards ADD INDEX cards_column (column_id), ADD INDEX cards_order (created_at,id), DROP INDEX cards_column_position, DROP COLUMN position")
	exec("DELETE FROM cards")
	// ids ascend while created_at descends in column 1; ids 12 and 13 tie on created_at.
	exec("INSERT INTO cards(id,column_id,title,description,created_at) VALUES (10,1,'c','','2026-01-03 00:00:00'),(11,1,'b','','2026-01-02 00:00:00'),(12,1,'a','','2026-01-01 00:00:00'),(13,1,'a2','','2026-01-01 00:00:00'),(20,2,'solo','','2026-01-01 00:00:00')")
	r := MySQLRepository{DB: db}
	updatedAt := func() map[int64]string {
		rows, err := db.QueryContext(ctx, "SELECT id,CAST(updated_at AS CHAR) FROM cards")
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		m := map[int64]string{}
		for rows.Next() {
			var id int64
			var ts string
			if err = rows.Scan(&id, &ts); err != nil {
				t.Fatal(err)
			}
			m[id] = ts
		}
		if err = rows.Err(); err != nil {
			t.Fatal(err)
		}
		return m
	}
	stamps := updatedAt()
	if err := r.InitializeCardPositions(ctx); err != nil {
		t.Fatal(err)
	}
	positions := func() map[int64]int {
		rows, err := db.QueryContext(ctx, "SELECT id,position FROM cards")
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		m := map[int64]int{}
		for rows.Next() {
			var id int64
			var p int
			if err = rows.Scan(&id, &p); err != nil {
				t.Fatal(err)
			}
			m[id] = p
		}
		if err = rows.Err(); err != nil {
			t.Fatal(err)
		}
		return m
	}
	got := positions()
	want := map[int64]int{12: 0, 13: 1, 11: 2, 10: 3, 20: 0}
	for id, p := range want {
		if got[id] != p {
			t.Fatalf("backfill: got %v want %v", got, want)
		}
	}
	var indexRows int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cards' AND INDEX_NAME='cards_column_position'").Scan(&indexRows); err != nil || indexRows != 3 {
		t.Fatalf("cards_column_position rows=%d err=%v", indexRows, err)
	}
	// The backfill is a migration, not an edit: it must not move any card's updatedAt.
	for id, ts := range updatedAt() {
		if ts != stamps[id] {
			t.Fatalf("backfill changed updated_at of card %d: %s -> %s", id, stamps[id], ts)
		}
	}

	// A restart must keep a manual order.
	exec("UPDATE cards SET position=3-position WHERE column_id=1")
	before := positions()
	if err := r.InitializeCardPositions(ctx); err != nil {
		t.Fatal(err)
	}
	after := positions()
	for id, p := range before {
		if after[id] != p {
			t.Fatalf("restart changed order: %v -> %v", before, after)
		}
	}
}
