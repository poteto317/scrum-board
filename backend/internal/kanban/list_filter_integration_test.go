package kanban

import (
	"context"
	"testing"
)

func TestListFilterMySQLCorruptJSONDoesNotOverwrite(t *testing.T) {
	db := mysqlTestDB(t, "")
	r := MySQLRepository{DB: db}
	ctx := context.Background()
	if _, err := db.ExecContext(ctx, `INSERT INTO workspace_list_filter (id, query_text, status_ids) VALUES (1, 'saved', CAST('"bad"' AS JSON))`); err != nil {
		t.Fatal(err)
	}
	got, err := r.GetListFilter(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got.Query != "" || len(got.StatusIDs) != 0 {
		t.Fatalf("expected empty filter for corrupt status_ids, got %+v", got)
	}
	var query string
	var raw []byte
	if err := db.QueryRowContext(ctx, `SELECT query_text, status_ids FROM workspace_list_filter WHERE id = 1`).Scan(&query, &raw); err != nil {
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
	out, err := r.PutListFilter(ctx, ListFilter{Query: "  x  ", StatusIDs: []int64{1, 1, 999}})
	if err != nil {
		t.Fatal(err)
	}
	if out.Query != "x" || len(out.StatusIDs) != 1 || out.StatusIDs[0] != 1 {
		t.Fatalf("put %+v", out)
	}
	got, err := r.GetListFilter(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got.Query != "x" || len(got.StatusIDs) != 1 || got.StatusIDs[0] != 1 {
		t.Fatalf("get %+v", got)
	}
}
