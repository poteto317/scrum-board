package kanban

import (
	"context"
	"database/sql"
	"fmt"
)

// InitializeNumbers upgrades both new and existing databases without rewriting cards.
// DDL is restart-safe; the data backfill and counter advance commit atomically.
func (r MySQLRepository) InitializeNumbers(ctx context.Context) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS card_numbers (
    card_id BIGINT NOT NULL PRIMARY KEY,
    task_number BIGINT NOT NULL UNIQUE,
    CONSTRAINT fk_card_number FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
    CHECK (task_number > 0)
   ) ENGINE=InnoDB`,
		`CREATE TABLE IF NOT EXISTS card_number_sequence (
    singleton TINYINT NOT NULL PRIMARY KEY,
    next_number BIGINT NOT NULL,
    CHECK (singleton = 1), CHECK (next_number > 0)
   ) ENGINE=InnoDB`,
		`INSERT IGNORE INTO card_number_sequence(singleton,next_number) VALUES(1,1)`,
	}
	for _, statement := range statements {
		if _, err := r.DB.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("prepare card numbering: %w", err)
		}
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	next, err := lockNextNumber(ctx, tx)
	if err != nil {
		return err
	}
	var firstUnused int64
	if err = tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(task_number),0)+1 FROM card_numbers").Scan(&firstUnused); err != nil {
		return err
	}
	if firstUnused > next {
		next = firstUnused
	}
	result, err := tx.ExecContext(ctx, `INSERT INTO card_numbers(card_id,task_number)
  SELECT c.id, ? + ROW_NUMBER() OVER (ORDER BY c.created_at,c.id) - 1
  FROM cards c LEFT JOIN card_numbers n ON n.card_id=c.id WHERE n.card_id IS NULL`, next)
	if err != nil {
		return fmt.Errorf("backfill card numbers: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE card_number_sequence SET next_number=? WHERE singleton=1", next+count); err != nil {
		return err
	}
	return tx.Commit()
}

// All number issuers lock this same row until their enclosing transaction commits.
func lockNextNumber(ctx context.Context, tx *sql.Tx) (int64, error) {
	var next int64
	err := tx.QueryRowContext(ctx, "SELECT next_number FROM card_number_sequence WHERE singleton=1 FOR UPDATE").Scan(&next)
	return next, err
}
