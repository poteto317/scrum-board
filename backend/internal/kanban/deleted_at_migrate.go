package kanban

import (
	"context"
	"fmt"
)

// InitializeDeletedAt adds items.deleted_at (soft delete) and supporting index when missing.
func (r MySQLRepository) InitializeDeletedAt(ctx context.Context) error {
	var count int
	err := r.DB.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'items' AND COLUMN_NAME = 'deleted_at'`).Scan(&count)
	if err != nil {
		return fmt.Errorf("check items.deleted_at: %w", err)
	}
	if count == 0 {
		if _, err = r.DB.ExecContext(ctx, "ALTER TABLE items ADD COLUMN deleted_at DATETIME(6) NULL"); err != nil {
			return fmt.Errorf("add items.deleted_at: %w", err)
		}
	}
	indexed, err := r.indexExists(ctx, "items", "items_project_deleted_at")
	if err != nil {
		return fmt.Errorf("check items_project_deleted_at: %w", err)
	}
	if !indexed {
		if _, err = r.DB.ExecContext(ctx, `ALTER TABLE items ADD INDEX items_project_deleted_at (project_id, deleted_at)`); err != nil {
			return fmt.Errorf("add items_project_deleted_at: %w", err)
		}
	}
	return nil
}
