package kanban

import (
	"context"
	"database/sql"
	"fmt"
)

// InitializeBacklogPositions adds cards.backlog_position when missing and backfills once.
func (r MySQLRepository) InitializeBacklogPositions(ctx context.Context) error {
	var count int
	err := r.DB.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cards' AND COLUMN_NAME = 'backlog_position'`).Scan(&count)
	if err != nil {
		return fmt.Errorf("check cards.backlog_position: %w", err)
	}
	if count == 0 {
		if _, err = r.DB.ExecContext(ctx, "ALTER TABLE cards ADD COLUMN backlog_position INT NOT NULL DEFAULT 0"); err != nil {
			return fmt.Errorf("add cards.backlog_position: %w", err)
		}
	}
	if err = backfillIdenticalBacklogPositions(ctx, r.DB); err != nil {
		return err
	}
	var idx int
	err = r.DB.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cards' AND INDEX_NAME = 'cards_backlog_position'`).Scan(&idx)
	if err != nil {
		return fmt.Errorf("check cards_backlog_position: %w", err)
	}
	if idx == 0 {
		if _, err = r.DB.ExecContext(ctx, "ALTER TABLE cards ADD INDEX cards_backlog_position (backlog_position, id)"); err != nil {
			return fmt.Errorf("add cards_backlog_position: %w", err)
		}
	}
	return nil
}

func backfillIdenticalBacklogPositions(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Lock by primary key order first (same as CreateCard / ReorderBacklog), then decide.
	if _, err = lockAllCards(ctx, tx); err != nil {
		return err
	}
	var n, distinct int
	err = tx.QueryRowContext(ctx, "SELECT COUNT(*), COUNT(DISTINCT backlog_position) FROM cards").Scan(&n, &distinct)
	if err != nil {
		return err
	}
	if n < 2 || distinct != 1 {
		return tx.Commit()
	}
	rows, err := tx.QueryContext(ctx, "SELECT id FROM cards ORDER BY created_at,id")
	if err != nil {
		return err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for pos, id := range ids {
		if _, err = tx.ExecContext(ctx, "UPDATE cards SET backlog_position=?, updated_at=updated_at WHERE id=?", pos, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}
