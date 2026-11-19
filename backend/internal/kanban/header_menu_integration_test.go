package kanban

import (
	"context"
	"testing"
)

func TestHeaderMenuMySQLCorruptJSONDoesNotOverwrite(t *testing.T) {
	db := mysqlTestDB(t, "")
	repo := MySQLRepository{DB: db}
	if err := repo.InitializeHeaderMenu(t.Context()); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	_, err := db.ExecContext(ctx, `
INSERT INTO workspace_header_menu (id, payload)
VALUES (1, CAST(? AS JSON))
ON DUPLICATE KEY UPDATE payload = VALUES(payload)`, `"oops"`)
	if err != nil {
		t.Fatal(err)
	}
	got, err := repo.GetHeaderMenu(ctx)
	if err != nil {
		t.Fatal(err)
	}
	empty := emptyWorkspaceHeaderMenu()
	if !workspaceHeaderMenuEqual(got, empty) {
		t.Fatalf("corrupt → empty×3, got %+v", got)
	}
	var raw []byte
	if err = db.QueryRowContext(ctx, `SELECT payload FROM workspace_header_menu WHERE id = 1`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if string(raw) != `"oops"` {
		t.Fatalf("row should remain untouched, raw=%s", raw)
	}
}

func TestHeaderMenuMySQLPutGet(t *testing.T) {
	db := mysqlTestDB(t, "")
	repo := MySQLRepository{DB: db}
	if err := repo.InitializeHeaderMenu(t.Context()); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	out, err := repo.PutHeaderMenu(ctx, WorkspaceHeaderMenu{
		Board:      PageHeaderMenu{HiddenIDs: []string{}},
		Backlog:    PageHeaderMenu{HiddenIDs: []string{"project_delete", "project_delete"}},
		ItemDetail: PageHeaderMenu{HiddenIDs: []string{"item_favorite"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Backlog.HiddenIDs) != 1 || out.Backlog.HiddenIDs[0] != "project_delete" {
		t.Fatalf("deduped put %+v", out.Backlog)
	}
	got, err := repo.GetHeaderMenu(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Backlog.HiddenIDs) != 1 || len(got.ItemDetail.HiddenIDs) != 1 {
		t.Fatalf("get %+v", got)
	}
}