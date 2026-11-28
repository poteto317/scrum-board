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

func TestListFilterMySQLLabelIDsAndMigration(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	l1, err := r.CreateLabel(ctx, LabelInput{Name: "bug", Color: "#ef4444"})
	if err != nil {
		t.Fatal(err)
	}
	l2, err := r.CreateLabel(ctx, LabelInput{Name: "api", Color: "#3b82f6"})
	if err != nil {
		t.Fatal(err)
	}
	out, err := r.PutListFilter(ctx, WorkspaceListFilters{
		Board:   ListFilter{Query: "q", StatusIDs: []int64{1}, LabelIDs: []int64{l2.ID, l1.ID, l2.ID, 99999}},
		Backlog: ListFilter{Query: "", StatusIDs: []int64{}, LabelIDs: []int64{l1.ID}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Board.LabelIDs) != 2 || out.Board.LabelIDs[0] != l2.ID || out.Board.LabelIDs[1] != l1.ID {
		t.Fatalf("unexpected put board labels: %+v", out.Board.LabelIDs)
	}
	got, err := r.GetListFilter(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Board.LabelIDs) != 2 || len(got.Backlog.LabelIDs) != 1 || got.Backlog.LabelIDs[0] != l1.ID {
		t.Fatalf("unexpected get labels: %+v", got)
	}

	// Corrupt board_label_ids falls back without mutating healthy backlog.
	if _, err := db.ExecContext(ctx, `UPDATE workspace_list_filter SET board_label_ids = CAST('"bad"' AS JSON) WHERE id = 1`); err != nil {
		t.Fatal(err)
	}
	got, err = r.GetListFilter(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got.Board.Query != "" || len(got.Board.LabelIDs) != 0 {
		t.Fatalf("corrupt board_label_ids should yield empty board: %+v", got.Board)
	}
	if len(got.Backlog.LabelIDs) != 1 || got.Backlog.LabelIDs[0] != l1.ID {
		t.Fatalf("healthy backlog should stay: %+v", got.Backlog)
	}

	// 4-column -> 6-column migration adds board_label_ids / backlog_label_ids with [].
	if _, err := db.ExecContext(ctx, `DROP TABLE IF EXISTS workspace_list_filter`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `CREATE TABLE workspace_list_filter (
  id TINYINT NOT NULL PRIMARY KEY,
  board_query_text VARCHAR(200) NOT NULL DEFAULT '',
  board_status_ids JSON NOT NULL,
  backlog_query_text VARCHAR(200) NOT NULL DEFAULT '',
  backlog_status_ids JSON NOT NULL,
  CONSTRAINT chk_workspace_list_filter_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO workspace_list_filter (id, board_query_text, board_status_ids, backlog_query_text, backlog_status_ids) VALUES (1, 'v4', CAST('[1]' AS JSON), 'b4', CAST('[2]' AS JSON))`); err != nil {
		t.Fatal(err)
	}
	if err := r.InitializeListFilter(ctx); err != nil {
		t.Fatal(err)
	}
	got, err = r.GetListFilter(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got.Board.Query != "v4" || len(got.Board.LabelIDs) != 0 || got.Backlog.Query != "b4" || len(got.Backlog.LabelIDs) != 0 {
		t.Fatalf("4->6 migration failed: %+v", got)
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

func TestListFilterMySQLResumesPartialNullableLabelColumns(t *testing.T) {
	db := mysqlTestDB(t, "")
	ctx := context.Background()
	r := MySQLRepository{DB: db}
	if err := r.InitializeListFilter(ctx); err != nil {
		t.Fatal(err)
	}
	// Simulate partial migration stopped after ADD COLUMN ... JSON NULL.
	for _, stmt := range []string{
		`ALTER TABLE workspace_list_filter MODIFY board_label_ids JSON NULL`,
		`ALTER TABLE workspace_list_filter MODIFY backlog_label_ids JSON NULL`,
		`UPDATE workspace_list_filter SET board_label_ids = NULL, backlog_label_ids = NULL`,
	} {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.InitializeListFilter(ctx); err != nil {
		t.Fatal(err)
	}
	boardReady, err := r.listFilterHasNonNullColumn(ctx, "board_label_ids")
	if err != nil || !boardReady {
		t.Fatalf("board_label_ids should be NOT NULL after resume: ready=%v err=%v", boardReady, err)
	}
	backlogReady, err := r.listFilterHasNonNullColumn(ctx, "backlog_label_ids")
	if err != nil || !backlogReady {
		t.Fatalf("backlog_label_ids should be NOT NULL after resume: ready=%v err=%v", backlogReady, err)
	}
	got, err := r.GetListFilter(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got.Board.LabelIDs == nil || got.Backlog.LabelIDs == nil {
		t.Fatalf("labelIds should be initialized empty arrays: %+v", got)
	}
}
