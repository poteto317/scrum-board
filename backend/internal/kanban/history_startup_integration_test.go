package kanban

import (
	"context"
	"reflect"
	"strconv"
	"sync"
	"testing"
)

// sessionCounter reads a MySQL session status counter (Com_begin, ...). The caller pins the
// pool to one connection first, so every statement of the repository goes through the
// connection being counted and nothing else on the server can change the value.
func sessionCounter(t *testing.T, r MySQLRepository, name string) int64 {
	t.Helper()
	var key, value string
	if err := r.DB.QueryRow("SHOW SESSION STATUS LIKE '"+name+"'").Scan(&key, &value); err != nil {
		t.Fatal(err)
	}
	n, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

// addItems adds n items, so a per-item cost differs from a constant one.
func addItems(t *testing.T, r MySQLRepository, n int) {
	t.Helper()
	for i := range n {
		if _, err := r.CreateItem(context.Background(), ItemInput{Title: "startup item " + strconv.Itoa(i), ColumnID: 1}); err != nil {
			t.Fatal(err)
		}
	}
}

// Start-up must not walk every item: with history already present, InitializeHistory
// opens no transaction, whatever the number of items (#122).
func TestMySQLInitializeHistoryOpensNoTransactionWhenHistoryExists(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	addItems(t, r, 3)
	if err := r.InitializeHistory(ctx); err != nil {
		t.Fatal(err)
	}
	var items int
	if err := db.QueryRow("SELECT COUNT(*) FROM items").Scan(&items); err != nil || items < 2 {
		t.Fatalf("need several items to tell a per-item cost from a constant one: %d %v", items, err)
	}
	db.SetMaxOpenConns(1)
	begins := sessionCounter(t, r, "Com_begin")
	if err := r.InitializeHistory(ctx); err != nil {
		t.Fatal(err)
	}
	if got := sessionCounter(t, r, "Com_begin") - begins; got != 0 {
		t.Fatalf("InitializeHistory opened %d transactions for %d items that already have history", got, items)
	}
}

func TestMySQLItemIDsWithoutHistoryReturnsOnlyMissingOnes(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	addItems(t, r, 3)
	if err := r.InitializeHistory(ctx); err != nil {
		t.Fatal(err)
	}
	ids, err := r.itemIDsWithoutHistory(ctx)
	if err != nil || len(ids) != 0 {
		t.Fatalf("all items have history: %v %v", ids, err)
	}
	var all []int64
	rows, err := db.Query("SELECT id FROM items ORDER BY id")
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		all = append(all, id)
	}
	if err = rows.Err(); err != nil || len(all) < 4 {
		t.Fatalf("need at least 4 items: %v %v", all, err)
	}
	rows.Close()
	first, third := all[0], all[2]
	if _, err = db.Exec("DELETE FROM item_history WHERE item_id IN (?,?)", first, third); err != nil {
		t.Fatal(err)
	}
	ids, err = r.itemIDsWithoutHistory(ctx)
	if err != nil || !reflect.DeepEqual(ids, []int64{first, third}) {
		t.Fatalf("want [%d %d] in id order (the others keep their history), got %v %v", first, third, ids, err)
	}
}

// The baseline is rebuilt only for the items that lack one, and running start-up again adds none.
func TestMySQLInitializeHistoryRebuildsMissingBaselineOnce(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	addItems(t, r, 2)
	if err := r.InitializeHistory(ctx); err != nil {
		t.Fatal(err)
	}
	var missing, kept int64
	if err := db.QueryRow("SELECT MIN(id), MAX(id) FROM items").Scan(&missing, &kept); err != nil || missing == kept {
		t.Fatalf("need two distinct items: %d %d %v", missing, kept, err)
	}
	var keptBefore int
	if err := db.QueryRow("SELECT COUNT(*) FROM item_history WHERE item_id=?", kept).Scan(&keptBefore); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("DELETE FROM item_history WHERE item_id=?", missing); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := r.InitializeHistory(ctx); err != nil {
			t.Fatal(err)
		}
	}
	var rebuilt, keptAfter int
	if err := db.QueryRow("SELECT COUNT(*) FROM item_history WHERE item_id=? AND kind='baseline'", missing).Scan(&rebuilt); err != nil || rebuilt != 1 {
		t.Fatalf("item %d baseline count %d %v", missing, rebuilt, err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM item_history WHERE item_id=?", kept).Scan(&keptAfter); err != nil || keptAfter != keptBefore {
		t.Fatalf("item %d history changed: %d -> %d %v", kept, keptBefore, keptAfter, err)
	}
}

// The trash is part of the history too: a restored item must not come back without a baseline.
func TestMySQLItemIDsWithoutHistoryIncludesTrashedItems(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	item, err := r.CreateItem(ctx, ItemInput{Title: "trashed startup item", ColumnID: 1})
	if err != nil {
		t.Fatal(err)
	}
	if err = r.InitializeHistory(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("UPDATE items SET deleted_at=UTC_TIMESTAMP(6) WHERE id=?", item.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("DELETE FROM item_history WHERE item_id=?", item.ID); err != nil {
		t.Fatal(err)
	}
	ids, err := r.itemIDsWithoutHistory(ctx)
	if err != nil || !reflect.DeepEqual(ids, []int64{item.ID}) {
		t.Fatalf("want the trashed item %d, got %v %v", item.ID, ids, err)
	}
	if err = r.InitializeHistory(ctx); err != nil {
		t.Fatal(err)
	}
	var n int
	if err = db.QueryRow("SELECT COUNT(*) FROM item_history WHERE item_id=? AND kind='baseline'", item.ID).Scan(&n); err != nil || n != 1 {
		t.Fatalf("trashed item baseline count %d %v", n, err)
	}
}

// Several instances starting together all see the same items without history; the row lock
// and the re-check inside baseline must keep it at one baseline per item and no start-up error.
func TestMySQLInitializeHistoryConcurrentStartsKeepOneBaseline(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	mustInit(t, r)
	addItems(t, r, 4)
	if err := r.InitializeHistory(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("DELETE FROM item_history"); err != nil {
		t.Fatal(err)
	}
	const starts = 4
	errs := make(chan error, starts)
	var wg sync.WaitGroup
	for range starts {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- r.InitializeHistory(ctx)
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent InitializeHistory: %v", err)
		}
	}
	var items, baselines, withBaseline int
	if err := db.QueryRow("SELECT COUNT(*) FROM items").Scan(&items); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT COUNT(*), COUNT(DISTINCT item_id) FROM item_history WHERE kind='baseline'").Scan(&baselines, &withBaseline); err != nil {
		t.Fatal(err)
	}
	if baselines != items || withBaseline != items {
		t.Fatalf("items %d, baselines %d for %d distinct items", items, baselines, withBaseline)
	}
}
