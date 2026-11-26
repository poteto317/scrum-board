package kanban

import (
	"database/sql"
	"os"
	"testing"

	"github.com/go-sql-driver/mysql"
	"scrumboard/internal/mysqlconfig"
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
	switch suffix {
	case "", "_fresh", "_per_project_numbers":
	default:
		t.Fatal("unexpected disposable database suffix")
	}
	cfg.DBName += suffix
	mysqlconfig.ApplyStandardDriverFlags(cfg)
	cfg.MultiStatements = true
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	db.SetMaxOpenConns(12)
	for _, table := range []string{
		"hidden_history",
		"item_history", "card_history",
		"item_pr_links__new", "card_pr_links__new", "item_pr_links", "card_pr_links",
		"item_related_items", "card_related_items",
		"item_command_templates", "card_command_templates",
		"command_template_defaults",
		"command_templates",
		"workspace_list_filter",
		"item_attachments",
		"item_ai_messages",
		"project_ai_messages",
		"project_ai_conversations",
		"ai_usage",
		"item_comments",
		"item_acl_entries",
		"sessions",
		"sprint_items",
		"sprints",
		"recurring_rules",
		"item_numbers", "card_numbers",
		"item_number_sequence", "card_number_sequence",
		"items", "cards",
		"users",
		"projects",
		"board_settings",
		"board_columns",
	} {
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
	if err = (MySQLRepository{DB: db}).InitializeItemPositions(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = (MySQLRepository{DB: db}).InitializeItemOffsetY(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = (MySQLRepository{DB: db}).InitializeProjects(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = (MySQLRepository{DB: db}).InitializeSprints(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = (MySQLRepository{DB: db}).InitializeRecurringRules(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = (MySQLRepository{DB: db}).InitializeBoardSettings(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = (MySQLRepository{DB: db}).InitializeBacklogPositions(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = (MySQLRepository{DB: db}).InitializePRLinks(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = (MySQLRepository{DB: db}).InitializeRelatedItems(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = (MySQLRepository{DB: db}).InitializeDueAt(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = (MySQLRepository{DB: db}).InitializeDeletedAt(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = (MySQLRepository{DB: db}).InitializeSolution(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = (MySQLRepository{DB: db}).InitializeFavorite(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = (MySQLRepository{DB: db}).prepareHistory(t.Context()); err != nil {
		t.Fatal(err)
	}
	repo := MySQLRepository{DB: db}
	if err = repo.InitializeNumbers(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = repo.InitializeCommandTemplates(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = repo.InitializeItemCommandTemplates(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = repo.InitializeListFilter(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = repo.InitializeHeaderMenu(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = repo.InitializeComments(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = repo.InitializeAIChat(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = repo.InitializeUsers(t.Context()); err != nil {
		t.Fatal(err)
	}
	// project_ai_messages references users, so it comes after InitializeUsers (same order as cmd/server).
	if err = repo.InitializeProjectAIChat(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = repo.InitializeSessions(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = repo.InitializeItemACL(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = repo.InitializeItemAttachments(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err = seedHandlerTestAuth(t.Context(), repo); err != nil {
		t.Fatal(err)
	}
	return db
}
