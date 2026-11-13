// import-history appends explicitly reviewed historical records; it never updates cards.
package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/go-sql-driver/mysql"
	"scrumboard/internal/kanban"
)

const (
	maxManifestBytes   = 2 * 1024 * 1024
	maxManifestRecords = 10000
)

// loadManifest reads exactly one bounded JSON array, rejecting unknown keys and trailing data.
func loadManifest(r io.Reader) ([]kanban.HistoricalRecord, error) {
	content, err := io.ReadAll(io.LimitReader(r, maxManifestBytes+1))
	if err != nil || len(content) > maxManifestBytes {
		return nil, fmt.Errorf("manifest must be at most 2 MiB")
	}
	var records []kanban.HistoricalRecord
	decoder := json.NewDecoder(bytes.NewReader(content))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&records); err != nil {
		return nil, fmt.Errorf("invalid manifest JSON")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return nil, fmt.Errorf("trailing manifest data")
	}
	if len(records) == 0 || len(records) > maxManifestRecords {
		return nil, fmt.Errorf("manifest must contain 1..10000 records")
	}
	return records, nil
}

func run() error {
	path := flag.String("file", "", "reviewed JSON manifest")
	flag.Parse()
	if *path == "" || os.Getenv("KANBAN_IMPORT_DSN") == "" {
		return fmt.Errorf("--file and KANBAN_IMPORT_DSN are required")
	}
	data, err := os.Open(*path)
	if err != nil {
		return fmt.Errorf("cannot open manifest")
	}
	defer data.Close()
	records, err := loadManifest(data)
	if err != nil {
		return err
	}
	cfg, err := mysql.ParseDSN(os.Getenv("KANBAN_IMPORT_DSN"))
	if err != nil {
		return fmt.Errorf("invalid database configuration")
	}
	cfg.ParseTime = true
	cfg.Loc = time.UTC
	cfg.MultiStatements = false
	cfg.Timeout = 5 * time.Second
	cfg.ReadTimeout = 30 * time.Second
	cfg.WriteTimeout = 30 * time.Second
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		return fmt.Errorf("database unavailable")
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err = (kanban.MySQLRepository{DB: db}).ImportHistory(ctx, records); err != nil {
		return fmt.Errorf("history import failed; verify manifest identities and database readiness")
	}
	fmt.Printf("Imported %d records (existing keys preserved).\n", len(records))
	return nil
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
