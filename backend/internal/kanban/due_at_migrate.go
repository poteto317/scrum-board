package kanban

import (
	"context"
	"fmt"
)

// InitializeDueAt adds items.due_at when missing. Existing rows keep NULL.
func (r MySQLRepository) InitializeDueAt(ctx context.Context) error {
	var count int
	err := r.DB.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'items' AND COLUMN_NAME = 'due_at'`).Scan(&count)
	if err != nil {
		return fmt.Errorf("check items.due_at: %w", err)
	}
	if count > 0 {
		return nil
	}
	if _, err = r.DB.ExecContext(ctx, "ALTER TABLE items ADD COLUMN due_at DATETIME NULL"); err != nil {
		return fmt.Errorf("add items.due_at: %w", err)
	}
	return nil
}
