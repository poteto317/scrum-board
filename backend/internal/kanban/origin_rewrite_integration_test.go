package kanban

import (
	"context"
	"database/sql"
	"testing"
)

func TestRewriteLocalBoardOrigins_Integration(t *testing.T) {
	db := mysqlTestDB(t, "_fresh")
	ctx := context.Background()
	repo := MySQLRepository{DB: db}
	if err := repo.InitializeCommandTemplates(ctx); err != nil {
		t.Fatal(err)
	}
	target := "https://prod.example"

	res, err := db.Exec(`INSERT INTO items (column_id, title, description, position, project_id) VALUES (1, ?, ?, 0, 1)`,
		"see http://127.0.0.1:4200/cards/1",
		"also http://localhost:4200/")
	if err != nil {
		t.Fatal(err)
	}
	cardID, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, db, `INSERT INTO item_history (item_id, kind, occurred_at, changes, note, evidence_url, event_key)
		VALUES (?, 'edited', NOW(6), '[]', ?, ?, 'e1')`, cardID,
		"note http://127.0.0.1:4200",
		"http://localhost:4200/cards/9")
	mustExec(t, db, `INSERT INTO command_templates (name, template, position) VALUES ('t', ?, 0)`,
		"open http://127.0.0.1:4200/cards/{{id}}")
	mustExec(t, db, `INSERT INTO item_pr_links (item_id, position, pr_url) VALUES (?, 0, ?)`, cardID,
		"https://github.com/org/repo/pull/1")

	matches, updates, err := repo.RewriteLocalBoardOrigins(ctx, target, true)
	if err != nil {
		t.Fatal(err)
	}
	if matches != 5 || updates != 0 {
		t.Fatalf("dry run: matches=%d updates=%d", matches, updates)
	}
	var title, desc string
	if err = db.QueryRow(`SELECT title, description FROM items WHERE id=?`, cardID).Scan(&title, &desc); err != nil {
		t.Fatal(err)
	}
	if !ContainsLocalBoardOrigin(title) || !ContainsLocalBoardOrigin(desc) {
		t.Fatal("dry run should not mutate cards")
	}

	matches, updates, err = repo.RewriteLocalBoardOrigins(ctx, target, false)
	if err != nil {
		t.Fatal(err)
	}
	if matches != 5 || updates != 5 {
		t.Fatalf("apply: matches=%d updates=%d", matches, updates)
	}
	if err = db.QueryRow(`SELECT title, description FROM items WHERE id=?`, cardID).Scan(&title, &desc); err != nil {
		t.Fatal(err)
	}
	wantTitle := "see https://prod.example/cards/1"
	wantDesc := "also https://prod.example/"
	if title != wantTitle || desc != wantDesc {
		t.Fatalf("cards: title=%q desc=%q", title, desc)
	}
	var note, evidence string
	if err = db.QueryRow(`SELECT note, evidence_url FROM item_history WHERE item_id=?`, cardID).Scan(&note, &evidence); err != nil {
		t.Fatal(err)
	}
	if note != "note https://prod.example" || evidence != "https://prod.example/cards/9" {
		t.Fatalf("history: note=%q evidence=%q", note, evidence)
	}
	var tmpl string
	if err = db.QueryRow(`SELECT template FROM command_templates WHERE name='t'`).Scan(&tmpl); err != nil {
		t.Fatal(err)
	}
	if tmpl != "open https://prod.example/cards/{{id}}" {
		t.Fatalf("template=%q", tmpl)
	}
	var prURL string
	if err = db.QueryRow(`SELECT pr_url FROM item_pr_links WHERE item_id=?`, cardID).Scan(&prURL); err != nil {
		t.Fatal(err)
	}
	if prURL != "https://github.com/org/repo/pull/1" {
		t.Fatalf("pr url changed: %q", prURL)
	}

	matches, updates, err = repo.RewriteLocalBoardOrigins(ctx, target, false)
	if err != nil {
		t.Fatal(err)
	}
	if matches != 0 || updates != 0 {
		t.Fatalf("second run: matches=%d updates=%d", matches, updates)
	}
}

func mustExec(t *testing.T, db *sql.DB, q string, args ...any) {
	t.Helper()
	if _, err := db.Exec(q, args...); err != nil {
		t.Fatal(err)
	}
}
