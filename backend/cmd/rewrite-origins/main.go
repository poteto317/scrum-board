// rewrite-origins replaces local dev board URLs in selected text columns with PUBLIC_ORIGIN.
package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"os"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"scrumboard/internal/kanban"
	"scrumboard/internal/mysqlconfig"
)

func usage() {
	fmt.Fprintf(os.Stderr, `Usage: rewrite-origins [--dry-run]

Replaces http://127.0.0.1:4200 and http://localhost:4200 (optional trailing slash)
in cards.description, cards.title, item_history.note, item_history.evidence_url,
and command_templates.template with PUBLIC_ORIGIN (trailing slash stripped).

Environment:
  PUBLIC_ORIGIN (required)   Target origin, e.g. https://example.run.app
  KANBAN_IMPORT_DSN          Full MySQL DSN (same as import-history CLI)
  Or DB_USER, DB_PASSWORD, DB_NAME, DB_ADDRESS, DB_SOCKET (same as API server)

Flags:
  --dry-run                  Count matches only; no updates (exit 0 when successful)

`)
}

func run(getenv func(string) string, args []string) error {
	fs := flag.NewFlagSet("rewrite-origins", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	dryRun := fs.Bool("dry-run", false, "count matches without updating the database")
	fs.Usage = usage
	if err := fs.Parse(args); err != nil {
		return fmt.Errorf("invalid arguments")
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("unexpected arguments")
	}
	target, err := kanban.ValidateRewriteTarget(getenv("PUBLIC_ORIGIN"))
	if err != nil {
		return err
	}
	cfg, err := mysqlconfig.ForCLI(getenv)
	if err != nil {
		return err
	}
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		return fmt.Errorf("database unavailable")
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err = db.PingContext(ctx); err != nil {
		return fmt.Errorf("database unavailable")
	}
	matches, updates, err := kanban.MySQLRepository{DB: db}.RewriteLocalBoardOrigins(ctx, target, *dryRun)
	if err != nil {
		return err
	}
	if *dryRun {
		fmt.Printf("Dry run: %d matches (no updates).\n", matches)
	} else {
		fmt.Printf("Matched %d rows; updated %d rows.\n", matches, updates)
	}
	return nil
}

func main() {
	if err := run(os.Getenv, os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
