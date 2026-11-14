package kanban

import (
	"context"
	"database/sql"
	"testing"
	"time"
)

// ImportHistory (cmd/import-history) locks cards by ascending id; ReorderCards locks them in index-scan order.
// Deterministic interleaving: a blocker holds the highest card; Reorder queues on it first; Import then takes the
// lowest card and queues behind Reorder on the highest card; releasing the blocker lets Reorder walk to the lowest card.
// Each step waits until InnoDB reports the expected number of row-lock waits, so a slow goroutine start cannot
// skip the interleaving (and, with the all-columns lock in place, Import queues on the column rows instead of a card).
func TestMySQLImportAndReorderDoNotDeadlock(t *testing.T) { importVsCardWriter(t, "reorder") }

func TestMySQLImportAndCreateDoNotDeadlock(t *testing.T) { importVsCardWriter(t, "create") }

func importVsCardWriter(t *testing.T, writer string) {
	r := MySQLRepository{DB: mysqlTestDB(t, "")}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	mustInit(t, r)
	if err := r.InitializeHistory(ctx); err != nil {
		t.Fatal(err)
	}
	col1 := []Card{}
	first, err := r.GetCard(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	col1 = append(col1, first)
	for i := 0; i < 5; i++ {
		c, err := r.CreateCard(ctx, CardInput{ColumnID: 1, Title: "c"})
		if err != nil {
			t.Fatal(err)
		}
		col1 = append(col1, c)
	}
	for i := 0; i < 300; i++ { // enough rows that the optimizer scans cards_column_position instead of the PK
		if _, err := r.CreateCard(ctx, CardInput{ColumnID: 2, Title: "other"}); err != nil {
			t.Fatal(err)
		}
	}
	rev := func() []int64 {
		ids := make([]int64, 0, len(col1))
		for i := len(col1) - 1; i >= 0; i-- {
			ids = append(ids, col1[i].ID)
		}
		return ids
	}
	if _, err = r.ReorderCards(ctx, []CardColumnOrder{{ColumnID: 1, CardIDs: rev()}}); err != nil {
		t.Fatal(err)
	}
	lo, hi := col1[0], col1[len(col1)-1]
	blocker, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Rollback()
	var id int64
	if err = blocker.QueryRowContext(ctx, "SELECT id FROM cards WHERE id=? FOR UPDATE", hi.ID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	orig := make([]int64, 0, len(col1))
	for _, c := range col1 {
		orig = append(orig, c.ID)
	}
	reorderErr := make(chan error, 1)
	go func() {
		var e error
		if writer == "create" {
			_, e = r.CreateCard(ctx, CardInput{ColumnID: 1, Title: "new"})
		} else {
			_, e = r.ReorderCards(ctx, []CardColumnOrder{{ColumnID: 1, CardIDs: orig}})
		}
		reorderErr <- e
	}()
	waitForRowLockWaits(t, r.DB, 1) // the writer is queued behind the blocker on the highest card
	importErr := make(chan error, 1)
	rec := func(c Card) HistoricalRecord {
		return HistoricalRecord{Number: c.Number, CardID: c.ID, CreatedAt: c.CreatedAt, Key: "k", OccurredAt: c.CreatedAt, Note: "verified import"}
	}
	go func() { importErr <- r.ImportHistory(ctx, []HistoricalRecord{rec(lo), rec(hi)}) }()
	waitForRowLockWaits(t, r.DB, 2) // the import is queued too
	blocker.Rollback()
	if e := <-importErr; e != nil {
		t.Errorf("import: %v", e)
	}
	if e := <-reorderErr; e != nil {
		t.Errorf("reorder: %v", e)
	}
}

// waitForRowLockWaits polls InnoDB's count of row-lock waits that are in progress. SHOW GLOBAL STATUS needs no
// privilege beyond the test user's (performance_schema.data_lock_waits and INNODB_TRX need SELECT / PROCESS),
// and this suite runs on a disposable database where nothing else waits on a row lock.
func waitForRowLockWaits(t *testing.T, db *sql.DB, want int) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	got := 0
	for time.Now().Before(deadline) {
		var name string
		if err := db.QueryRow("SHOW GLOBAL STATUS LIKE 'Innodb_row_lock_current_waits'").Scan(&name, &got); err != nil {
			t.Fatal(err)
		}
		if got >= want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("expected %d row-lock waits, saw %d", want, got)
}
