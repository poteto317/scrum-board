package kanban

import (
	"context"
	"strings"
	"testing"
)

func TestRenameCardTablesToItemsMigratesLegacyNames(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}

	var reverse []string
	for _, p := range cardToItemTables {
		newOK, err := r.tableExists(ctx, p.new)
		if err != nil {
			t.Fatal(err)
		}
		oldOK, err := r.tableExists(ctx, p.old)
		if err != nil {
			t.Fatal(err)
		}
		if newOK && !oldOK {
			reverse = append(reverse, p.new+" TO "+p.old)
		}
	}
	if len(reverse) == 0 {
		t.Fatal("expected item_* tables from mysqlTestDB")
	}
	if _, err := db.ExecContext(ctx, "RENAME TABLE "+strings.Join(reverse, ", ")); err != nil {
		t.Fatal(err)
	}
	if ok, err := r.tableExists(ctx, "cards"); err != nil || !ok {
		t.Fatalf("cards missing after reverse: %v %v", ok, err)
	}

	if err := r.RenameCardTablesToItems(ctx); err != nil {
		t.Fatal(err)
	}
	if ok, err := r.tableExists(ctx, "items"); err != nil || !ok {
		t.Fatalf("items missing: %v %v", ok, err)
	}
	if ok, err := r.tableExists(ctx, "cards"); err != nil || ok {
		t.Fatalf("cards should be gone: %v %v", ok, err)
	}
	if err := r.RenameCardTablesToItems(ctx); err != nil {
		t.Fatalf("idempotent: %v", err)
	}
}
