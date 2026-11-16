package kanban

import (
	"context"
	"fmt"
)

// InitializeItemOffsetY adds items.offset_y when missing. Existing rows keep the default 0.
func (r MySQLRepository) InitializeItemOffsetY(ctx context.Context) error {
	var count int
	err := r.DB.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'items' AND COLUMN_NAME = 'offset_y'`).Scan(&count)
	if err != nil {
		return fmt.Errorf("check items.offset_y: %w", err)
	}
	if count > 0 {
		return nil
	}
	if _, err = r.DB.ExecContext(ctx, "ALTER TABLE items ADD COLUMN offset_y INT NOT NULL DEFAULT 0"); err != nil {
		return fmt.Errorf("add items.offset_y: %w", err)
	}
	return nil
}
