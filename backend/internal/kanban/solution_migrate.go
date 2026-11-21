package kanban

import (
	"context"
	"fmt"
)

// InitializeSolution adds items.solution when missing. Existing rows keep the default empty string.
func (r MySQLRepository) InitializeSolution(ctx context.Context) error {
	var count int
	err := r.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'items' AND COLUMN_NAME = 'solution'`).Scan(&count)
	if err != nil {
		return fmt.Errorf("check items.solution: %w", err)
	}
	if count > 0 {
		return nil
	}
	if _, err = r.DB.ExecContext(ctx, "ALTER TABLE items ADD COLUMN solution TEXT NOT NULL DEFAULT ('')"); err != nil {
		return fmt.Errorf("add items.solution: %w", err)
	}
	return nil
}
