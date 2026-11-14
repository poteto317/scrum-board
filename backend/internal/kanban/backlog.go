package kanban

import (
	"context"
	"database/sql"
)

func (r MySQLRepository) Backlog(ctx context.Context) ([]Card, error) {
	tx, err := r.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	cards, err := listBacklogCards(ctx, tx)
	if err != nil {
		return nil, err
	}
	return cards, tx.Commit()
}

func (r MySQLRepository) ReorderBacklog(ctx context.Context, cardIDs []int64) ([]Card, error) {
	if err := validateBacklogOrder(cardIDs); err != nil {
		return nil, err
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	existing, err := lockAllCards(ctx, tx)
	if err != nil {
		return nil, err
	}
	if !sameCardIDSet(existing, cardIDs) {
		return nil, ErrBacklogMismatch
	}
	for pos, id := range cardIDs {
		if _, err = tx.ExecContext(ctx, "UPDATE cards SET backlog_position=?, updated_at=updated_at WHERE id=?", pos, id); err != nil {
			return nil, err
		}
	}
	cards, err := listBacklogCards(ctx, tx)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return cards, nil
}

func nextBacklogPosition(ctx context.Context, tx *sql.Tx) (int, error) {
	ids, err := lockAllCards(ctx, tx)
	if err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, nil
	}
	var maxPos int
	err = tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(backlog_position), -1) FROM cards").Scan(&maxPos)
	if err != nil {
		return 0, err
	}
	return maxPos + 1, nil
}

func lockAllCards(ctx context.Context, tx *sql.Tx) ([]int64, error) {
	rows, err := tx.QueryContext(ctx, "SELECT id FROM cards ORDER BY id FOR UPDATE")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func listBacklogCards(ctx context.Context, tx *sql.Tx) ([]Card, error) {
	rows, err := tx.QueryContext(ctx, "SELECT "+cardFields+numberedCards+" ORDER BY c.backlog_position,c.id")
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
	if err = rows.Err(); err != nil {
		return nil, err
	}
	if err = attachPRURLs(ctx, tx, cards); err != nil {
		return nil, err
	}
	return cards, nil
}

func sameCardIDSet(existing, requested []int64) bool {
	if len(existing) != len(requested) {
		return false
	}
	known := make(map[int64]struct{}, len(existing))
	for _, id := range existing {
		known[id] = struct{}{}
	}
	for _, id := range requested {
		if _, ok := known[id]; !ok {
			return false
		}
	}
	return true
}
