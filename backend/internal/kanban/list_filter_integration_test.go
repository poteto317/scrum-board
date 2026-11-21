package kanban

import (
	"context"
	"testing"
)

func TestListFilterMySQLCorruptJSONDoesNotOverwrite(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	if _, err := db.ExecContext(ctx, `
UPDATE workspace_list_filter SET
  board_query_text = 'saved',
  board_status_ids = CAST('"bad"' AS JSON),
  backlog_query_text = 'kept',
  backlog_status_ids = CAST('[]' AS JSON)
WHERE id = 1`); err != nil {
		t.Fatal(err)
	}
	got, err := r.GetListFilter(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got.Board.Query != "" || len(got.Board.StatusIDs) != 0 {
		t.Fatalf("corrupt board → default board, got %+v", got.Board)
	}
	if got.Backlog.Query != "kept" || len(got.Backlog.StatusIDs) != 0 {
		t.Fatalf("healthy backlog must stay, got %+v", got.Backlog)
	}
	var query string
	var raw []byte
	if err := db.QueryRowContext(ctx, `SELECT board_query_text, board_status_ids FROM workspace_list_filter WHERE id = 1`).Scan(&query, &raw); err != nil {
		t.Fatal(err)
	}
	if query != "saved" {
		t.Fatalf("row should remain untouched, query=%q raw=%s", query, raw)
	}
}

func TestListFilterMySQLPutGet(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	if _, err := r.CreateColumn(ctx, "Extra"); err != nil {
		t.Fatal(err)
	}
	out, err := r.PutListFilter(ctx, WorkspaceListFilters{
		Board:   ListFilter{Query: "  x  ", StatusIDs: []int64{1, 1, 999}},
		Backlog: ListFilter{Query: "", StatusIDs: []int64{}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if out.Board.Query != "x" || len(out.Board.StatusIDs) != 1 || out.Board.StatusIDs[0] != 1 {
		t.Fatalf("put board %+v", out.Board)
	}
	if len(out.Backlog.StatusIDs) != 0 {
		t.Fatalf("put backlog %+v", out.Backlog)
	}
	got, err := r.GetListFilter(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got.Board.Query != "x" || len(got.Board.StatusIDs) != 1 || got.Board.StatusIDs[0] != 1 {
		t.Fatalf("get board %+v", got.Board)
	}
	if len(got.Backlog.StatusIDs) != 0 {
		t.Fatalf("cleared backlog must stay empty %+v", got.Backlog)
	}
}

func TestListFilterMySQLInitializeSeedsTodo(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	got, err := r.GetListFilter(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Board.StatusIDs) != 0 {
		t.Fatalf("board default empty %+v", got.Board)
	}
	if len(got.Backlog.StatusIDs) != 1 || got.Backlog.StatusIDs[0] != 1 {
		t.Fatalf("backlog default Todo id=1 %+v", got.Backlog)
	}
}

func TestListFilterMySQLLegacyMigrateCopiesBoardAndSeedsBacklog(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	if _, err := db.ExecContext(ctx, `DROP TABLE IF EXISTS workspace_list_filter`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `CREATE TABLE workspace_list_filter (
  id TINYINT NOT NULL PRIMARY KEY,
  query_text VARCHAR(200) NOT NULL DEFAULT '',
  status_ids JSON NOT NULL,
  CONSTRAINT chk_workspace_list_filter_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO workspace_list_filter (id, query_text, status_ids) VALUES (1, 'legacy', CAST('[2]' AS JSON))`); err != nil {
		t.Fatal(err)
	}
	r := MySQLRepository{DB: db}
	if err := r.InitializeListFilter(ctx); err != nil {
		t.Fatal(err)
	}
	got, err := r.GetListFilter(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got.Board.Query != "legacy" || len(got.Board.StatusIDs) != 1 || got.Board.StatusIDs[0] != 2 {
		t.Fatalf("board from legacy %+v", got.Board)
	}
	if len(got.Backlog.StatusIDs) != 1 || got.Backlog.StatusIDs[0] != 1 {
		t.Fatalf("backlog Todo seed %+v", got.Backlog)
	}
	var legacyCols int
	if err := db.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspace_list_filter'
  AND COLUMN_NAME IN ('query_text','status_ids')`).Scan(&legacyCols); err != nil {
		t.Fatal(err)
	}
	if legacyCols != 0 {
		t.Fatalf("legacy columns should be dropped, still have %d", legacyCols)
	}
}
