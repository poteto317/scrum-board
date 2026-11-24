package kanban

import (
	"context"
	"fmt"
	"time"
)

func (r MySQLRepository) InitializeArchive(ctx context.Context) error {
	for _, column := range []struct {
		name string
		ddl  string
	}{
		{"done_at", "ALTER TABLE items ADD COLUMN done_at DATETIME(6) NULL"},
		{"archived_at", "ALTER TABLE items ADD COLUMN archived_at DATETIME(6) NULL"},
	} {
		var count int
		if err := r.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='items' AND COLUMN_NAME=?`, column.name).Scan(&count); err != nil {
			return fmt.Errorf("check items.%s: %w", column.name, err)
		}
		if count == 0 {
			if _, err := r.DB.ExecContext(ctx, column.ddl); err != nil {
				return fmt.Errorf("add items.%s: %w", column.name, err)
			}
		}
	}
	for _, index := range []struct {
		name string
		ddl  string
	}{
		{"idx_items_project_archived", "ALTER TABLE items ADD INDEX idx_items_project_archived (project_id, archived_at, id)"},
		{"idx_items_done_archived_deleted", "ALTER TABLE items ADD INDEX idx_items_done_archived_deleted (done_at, archived_at, deleted_at)"},
	} {
		exists, err := r.indexExists(ctx, "items", index.name)
		if err != nil {
			return fmt.Errorf("check %s: %w", index.name, err)
		}
		if !exists {
			if _, err = r.DB.ExecContext(ctx, index.ddl); err != nil {
				return fmt.Errorf("add %s: %w", index.name, err)
			}
		}
	}
	if err := r.prepareHistory(ctx); err != nil {
		return fmt.Errorf("prepare item history for archive migration: %w", err)
	}
	return r.backfillDoneAt(ctx)
}

// The query lists the same columns as isFinishedColumnName; keep them in sync.
func (r MySQLRepository) backfillDoneAt(ctx context.Context) error {
	rows, err := r.DB.QueryContext(ctx, `SELECT i.id, i.updated_at
FROM items i JOIN board_columns c ON c.id=i.column_id
WHERE i.done_at IS NULL AND (BINARY c.name=BINARY 'Done' OR BINARY c.name=BINARY 'Close')
ORDER BY i.id`)
	if err != nil {
		return err
	}
	type row struct {
		id        int64
		updatedAt time.Time
	}
	var items []row
	for rows.Next() {
		var item row
		if err = rows.Scan(&item.id, &item.updatedAt); err != nil {
			rows.Close()
			return err
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err = rows.Close(); err != nil {
		return err
	}
	for _, item := range items {
		at := item.updatedAt.UTC()
		entered, err := latestFinishedTransitionAt(ctx, r.DB, item.id)
		if err != nil {
			return fmt.Errorf("read latest status history for item %d: %w", item.id, err)
		}
		if entered != nil {
			at = entered.UTC()
		}
		if _, err = r.DB.ExecContext(ctx, `UPDATE items SET done_at=? WHERE id=? AND done_at IS NULL`, at, item.id); err != nil {
			return fmt.Errorf("backfill done_at for item %d: %w", item.id, err)
		}
	}
	return nil
}
