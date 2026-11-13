package kanban

import (
	"database/sql"
	"github.com/go-sql-driver/mysql"
	"os"
	"testing"
	"time"
)

// Only explicitly named disposable databases may be reset by this suite.
func mysqlTestDB(t *testing.T, suffix string) *sql.DB {
	t.Helper()
	dsn := os.Getenv("KANBAN_TEST_DSN")
	if dsn == "" {
		t.Skip("KANBAN_TEST_DSN is not set: real MySQL tests skipped")
	}
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DBName != "scrumboard_numbering_test" {
		t.Fatal("KANBAN_TEST_DSN must target disposable scrumboard_numbering_test")
	}
	if suffix != "" && suffix != "_fresh" {
		t.Fatal("unexpected disposable database suffix")
	}
	cfg.DBName += suffix
	cfg.ParseTime = true
	cfg.MultiStatements = true
	cfg.Loc = time.UTC
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	db.SetMaxOpenConns(12)
	for _, table := range []string{"hidden_history", "card_history", "card_pr_links", "card_numbers", "card_number_sequence", "cards", "board_columns"} {
		if _, err = db.Exec("DROP TABLE IF EXISTS " + table); err != nil {
			t.Fatal(err)
		}
	}
	schema, err := os.ReadFile("../../../database/init/001_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(string(schema)); err != nil {
		t.Fatal(err)
	}
	if err = (MySQLRepository{DB: db}).InitializePRLinks(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = (MySQLRepository{DB: db}).prepareHistory(t.Context()); err != nil {
		t.Fatal(err)
	}
	return db
}
