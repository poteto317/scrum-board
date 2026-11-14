package kanban

import (
	"context"
	"fmt"
)

// InitializeAssignee adds cards.assignee when missing. Existing rows keep the default empty string.
func (r MySQLRepository) InitializeAssignee(ctx context.Context) error {
	var count int
	err := r.DB.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cards' AND COLUMN_NAME = 'assignee'`).Scan(&count)
	if err != nil {
		return fmt.Errorf("check cards.assignee: %w", err)
	}
	if count > 0 {
		return nil
	}
	if _, err = r.DB.ExecContext(ctx, "ALTER TABLE cards ADD COLUMN assignee VARCHAR(60) NOT NULL DEFAULT ''"); err != nil {
		return fmt.Errorf("add cards.assignee: %w", err)
	}
	return nil
}
