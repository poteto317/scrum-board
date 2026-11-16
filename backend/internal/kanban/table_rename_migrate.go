package kanban

import (
	"context"
	"fmt"
	"strings"
)

// Legacy storage names → public Item naming. Column names (card_id, …) stay for this step.
// old names are written as literals so renames are not rewritten by mechanical edits.
var cardToItemTables = []struct{ old, new string }{
	{"card_command_templates", "item_command_templates"},
	{"card_related_items", "item_related_items"},
	{"card_pr_links__new", "item_pr_links__new"},
	{"card_pr_links", "item_pr_links"},
	{"card_history", "item_history"},
	{"card_numbers", "item_numbers"},
	{"card_number_sequence", "item_number_sequence"},
	{"cards", "items"},
}

// RenameCardTablesToItems renames legacy card_* / cards tables to item_* / items when present.
// Idempotent: no-op when only the new names exist. Fails if both old and new exist for a pair.
func (r MySQLRepository) RenameCardTablesToItems(ctx context.Context) error {
	var locked int
	if err := r.DB.QueryRowContext(ctx, "SELECT GET_LOCK('scrumboard_rename_card_tables_to_items', 30)").Scan(&locked); err != nil {
		return err
	}
	if locked != 1 {
		return fmt.Errorf("rename card tables lock busy")
	}
	defer r.DB.ExecContext(ctx, "SELECT RELEASE_LOCK('scrumboard_rename_card_tables_to_items')")

	var clauses []string
	for _, p := range cardToItemTables {
		oldOK, err := r.tableExists(ctx, p.old)
		if err != nil {
			return err
		}
		newOK, err := r.tableExists(ctx, p.new)
		if err != nil {
			return err
		}
		if oldOK && newOK {
			return fmt.Errorf("both %s and %s exist; resolve before migrate", p.old, p.new)
		}
		if oldOK && !newOK {
			clauses = append(clauses, fmt.Sprintf("%s TO %s", p.old, p.new))
		}
	}
	if len(clauses) == 0 {
		return nil
	}
	_, err := r.DB.ExecContext(ctx, "RENAME TABLE "+strings.Join(clauses, ", "))
	return err
}

func (r MySQLRepository) tableExists(ctx context.Context, name string) (bool, error) {
	var n int
	err := r.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`,
		name,
	).Scan(&n)
	return n > 0, err
}
