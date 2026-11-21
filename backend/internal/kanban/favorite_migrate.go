package kanban

import (
	"context"
	"fmt"
)

// InitializeFavorite adds items.favorite when missing. Existing rows keep the default false (0).
func (r MySQLRepository) InitializeFavorite(ctx context.Context) error {
	var count int
	err := r.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'items' AND COLUMN_NAME = 'favorite'`).Scan(&count)
	if err != nil {
		return fmt.Errorf("check items.favorite: %w", err)
	}
	if count > 0 {
		return nil
	}
	if _, err = r.DB.ExecContext(ctx, "ALTER TABLE items ADD COLUMN favorite TINYINT(1) NOT NULL DEFAULT 0"); err != nil {
		return fmt.Errorf("add items.favorite: %w", err)
	}
	return nil
}
