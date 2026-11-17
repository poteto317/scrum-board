package kanban

import (
	"context"
	"fmt"
)

// InitializeCloseReason adds items.close_reason when missing. Existing rows keep the default empty string.
func (r MySQLRepository) InitializeCloseReason(ctx context.Context) error {
	var count int
	err := r.DB.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'items' AND COLUMN_NAME = 'close_reason'`).Scan(&count)
	if err != nil {
		return fmt.Errorf("check items.close_reason: %w", err)
	}
	if count > 0 {
		return nil
	}
	if _, err = r.DB.ExecContext(ctx, "ALTER TABLE items ADD COLUMN close_reason TEXT NOT NULL DEFAULT ('')"); err != nil {
		return fmt.Errorf("add items.close_reason: %w", err)
	}
	return nil
}
