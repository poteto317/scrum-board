package kanban

import (
	"context"
	"database/sql"
	"fmt"
)

// InitializeCardPositions adds cards.position when missing and backfills only columns
// that still have identical positions (so restart never wipes DnD order).
func (r MySQLRepository) InitializeCardPositions(ctx context.Context) error {
	var count int
	err := r.DB.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cards' AND COLUMN_NAME = 'position'`).Scan(&count)
	if err != nil {
		return fmt.Errorf("check cards.position: %w", err)
	}
	if count == 0 {
		if _, err = r.DB.ExecContext(ctx, "ALTER TABLE cards ADD COLUMN position INT NOT NULL DEFAULT 0"); err != nil {
			return fmt.Errorf("add cards.position: %w", err)
		}
	}
	if err = backfillIdenticalColumnPositions(ctx, r.DB); err != nil {
		return err
	}
	var idx int
	err = r.DB.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cards' AND INDEX_NAME = 'cards_column_position'`).Scan(&idx)
	if err != nil {
		return fmt.Errorf("check cards_column_position: %w", err)
	}
	if idx == 0 {
		if _, err = r.DB.ExecContext(ctx, "ALTER TABLE cards ADD INDEX cards_column_position (column_id, position, id)"); err != nil {
			return fmt.Errorf("add cards_column_position: %w", err)
		}
	}
	return nil
}

func backfillIdenticalColumnPositions(ctx context.Context, db *sql.DB) error {
	rows, err := db.QueryContext(ctx, `
SELECT column_id FROM cards
 GROUP BY column_id
HAVING COUNT(*) >= 2 AND COUNT(DISTINCT position) = 1`)
	if err != nil {
		return fmt.Errorf("list columns needing position backfill: %w", err)
	}
	defer rows.Close()
	var columnIDs []int64
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			return err
		}
		columnIDs = append(columnIDs, id)
	}
	if err = rows.Err(); err != nil {
		return err
	}
	for _, columnID := range columnIDs {
		if err = backfillColumnByCreatedAt(ctx, db, columnID); err != nil {
			return err
		}
	}
	return nil
}

func backfillColumnByCreatedAt(ctx context.Context, db *sql.DB, columnID int64) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	cardRows, err := tx.QueryContext(ctx, "SELECT id FROM cards WHERE column_id=? ORDER BY created_at,id FOR UPDATE", columnID)
	if err != nil {
		return err
	}
	var ids []int64
	for cardRows.Next() {
		var id int64
		if err = cardRows.Scan(&id); err != nil {
			cardRows.Close()
			return err
		}
		ids = append(ids, id)
	}
	if err = cardRows.Err(); err != nil {
		cardRows.Close()
		return err
	}
	cardRows.Close()
	for pos, id := range ids {
		if _, err = tx.ExecContext(ctx, "UPDATE cards SET position=?, updated_at=updated_at WHERE id=?", pos, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// lockExistingColumn takes the same all-columns X lock that ReorderCards takes, so every path that
// changes card membership/position serializes on board_columns before touching cards.
func lockExistingColumn(ctx context.Context, tx *sql.Tx, columnID int64) error {
	cols, err := lockColumnRows(ctx, tx)
	if err != nil {
		return err
	}
	for _, c := range cols {
		if c.ID == columnID {
			return nil
		}
	}
	return ErrColumn
}

func nextCardPosition(ctx context.Context, tx *sql.Tx, columnID int64) (int, error) {
	rows, err := tx.QueryContext(ctx, "SELECT id,position FROM cards WHERE column_id=? ORDER BY id FOR UPDATE", columnID)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	maxPos := -1
	for rows.Next() {
		var id int64
		var pos int
		if err = rows.Scan(&id, &pos); err != nil {
			return 0, err
		}
		if pos > maxPos {
			maxPos = pos
		}
	}
	if err = rows.Err(); err != nil {
		return 0, err
	}
	return maxPos + 1, nil
}

func compactColumnPositions(ctx context.Context, tx *sql.Tx, columnID int64) error {
	rows, err := tx.QueryContext(ctx, "SELECT id FROM cards WHERE column_id=? ORDER BY position,id FOR UPDATE", columnID)
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
	// Closing a gap is not an edit of the remaining cards, so their updated_at stays as it was.
	for pos, id := range ids {
		if _, err = tx.ExecContext(ctx, "UPDATE cards SET position=?, updated_at=updated_at WHERE id=? AND position<>?", pos, id, pos); err != nil {
			return err
		}
	}
	return nil
}

func listOrderedCards(ctx context.Context, tx *sql.Tx) ([]Card, error) {
	rows, err := tx.QueryContext(ctx, "SELECT "+cardFields+numberedCards+" ORDER BY c.position,c.id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cards := []Card{}
	for rows.Next() {
		c, err := scanCard(rows)
		if err != nil {
			return nil, err
		}
		cards = append(cards, c)
	}
	return cards, rows.Err()
}
