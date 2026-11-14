package kanban

import (
	"context"
	"reflect"
	"testing"
)

// A database from before both drag & drop (no cards.position) and multiple PR links (card_pr_links keyed by
// card_id only) goes through the startup initializers in the order cmd/server/main.go runs them. Each is
// idempotent, so booting twice changes nothing, and no step may touch the legacy PR table before it is migrated.
func TestStartupMigrationsFromLegacySchemaMySQL(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	exec("DROP TABLE card_pr_links")
	exec("DROP TABLE IF EXISTS card_history")
	exec("DROP TABLE IF EXISTS hidden_history")
	exec("DROP TABLE IF EXISTS card_numbers")
	exec("DROP TABLE IF EXISTS card_number_sequence")
	exec("ALTER TABLE cards ADD INDEX cards_column (column_id), DROP INDEX cards_column_position, DROP COLUMN position")
	exec("DELETE FROM cards")
	exec("INSERT INTO cards(id,column_id,title,description,created_at) VALUES (10,1,'older','','2026-01-01 00:00:00'),(11,1,'linked','','2026-01-02 00:00:00'),(12,1,'newer','','2026-01-03 00:00:00')")
	exec(`CREATE TABLE card_pr_links (
 card_id BIGINT NOT NULL PRIMARY KEY,
 pr_url VARCHAR(2048) NOT NULL,
 CONSTRAINT fk_card_pr_links_card FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`)
	kept := "https://github.com/poteto317/scrum-board/pull/99"
	exec("INSERT INTO card_pr_links(card_id,pr_url) VALUES (11,?)", kept)

	r := MySQLRepository{DB: db}
	boot := func() {
		t.Helper()
		// The same order as cmd/server/main.go.
		for _, step := range []struct {
			name string
			run  func(context.Context) error
		}{
			{"InitializeCardPositions", r.InitializeCardPositions},
			{"InitializeBacklogPositions", r.InitializeBacklogPositions},
			{"InitializePRLinks", r.InitializePRLinks},
			{"InitializeNumbers", r.InitializeNumbers},
			{"InitializeHistory", r.InitializeHistory},
		} {
			if err := step.run(ctx); err != nil {
				t.Fatalf("%s: %v", step.name, err)
			}
		}
	}
	check := func(round string) {
		t.Helper()
		board, err := r.Board(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var ids []int64
		for _, c := range board.Cards {
			ids = append(ids, c.ID)
			want := []string{}
			if c.ID == 11 {
				want = []string{kept}
			}
			if !reflect.DeepEqual(c.PRURLs, want) {
				t.Fatalf("%s: card %d prUrls = %#v, want %#v", round, c.ID, c.PRURLs, want)
			}
		}
		if !reflect.DeepEqual(ids, []int64{10, 11, 12}) {
			t.Fatalf("%s: board order/duplicates: %v, want [10 11 12] (position backfilled by created_at)", round, ids)
		}
	}
	boot()
	check("first boot")
	// A manual order and a second PR link must survive the next boot.
	if _, err := r.ReorderCards(ctx, []CardColumnOrder{{ColumnID: 1, CardIDs: []int64{12, 11, 10}}}); err != nil {
		t.Fatal(err)
	}
	urls := []string{kept, "https://github.com/poteto317/scrum-board/pull/100"}
	if _, err := r.UpdateCard(ctx, 11, CardPatch{PRURLs: &urls}); err != nil {
		t.Fatal(err)
	}
	boot()
	board, err := r.Board(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var ids []int64
	for _, c := range board.Cards {
		ids = append(ids, c.ID)
		if c.ID == 11 && !reflect.DeepEqual(c.PRURLs, urls) {
			t.Fatalf("second boot lost links: %#v", c.PRURLs)
		}
	}
	if !reflect.DeepEqual(ids, []int64{12, 11, 10}) {
		t.Fatalf("second boot reset the manual order: %v", ids)
	}
}
