package kanban

import (
	"context"
	"database/sql"
	"time"
)

func (r MySQLRepository) ReorderCards(ctx context.Context, orders []CardColumnOrder) ([]Card, error) {
	if err := validateCardOrder(orders); err != nil {
		return nil, err
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	cols, err := lockColumnRows(ctx, tx)
	if err != nil {
		return nil, err
	}
	knownColumns := make(map[int64]struct{}, len(cols))
	for _, c := range cols {
		knownColumns[c.ID] = struct{}{}
	}
	for _, order := range orders {
		if _, ok := knownColumns[order.ColumnID]; !ok {
			return nil, ErrCardOrderMismatch
		}
	}

	requestedSet := make(map[int64]struct{})
	for _, order := range orders {
		for _, id := range order.CardIDs {
			if _, dup := requestedSet[id]; dup {
				return nil, ErrCardOrder
			}
			requestedSet[id] = struct{}{}
		}
	}

	columnIDs := make([]int64, len(orders))
	for i, order := range orders {
		columnIDs[i] = order.ColumnID
	}
	existing, err := lockCardsInColumns(ctx, tx, columnIDs)
	if err != nil {
		return nil, err
	}
	existingSet := make(map[int64]Card, len(existing))
	for _, c := range existing {
		existingSet[c.ID] = c
	}
	if len(existingSet) != len(requestedSet) {
		return nil, ErrCardOrderMismatch
	}
	for id := range requestedSet {
		if _, ok := existingSet[id]; !ok {
			return nil, ErrCardOrderMismatch
		}
	}

	now := time.Now().UTC()
	for _, order := range orders {
		for pos, cardID := range order.CardIDs {
			before := existingSet[cardID]
			columnChanged := before.ColumnID != order.ColumnID
			if !columnChanged && before.Position == pos {
				continue
			}
			// updated_at is the card's edit time: only a status change moves it. A card that merely
			// shifts position keeps it (and its history revision) as it was.
			query := "UPDATE cards SET column_id=?, position=?, updated_at=updated_at WHERE id=?"
			args := []any{order.ColumnID, pos, cardID}
			if columnChanged {
				query = "UPDATE cards SET column_id=?, position=?, updated_at=? WHERE id=?"
				args = []any{order.ColumnID, pos, now, cardID}
			}
			if _, err = tx.ExecContext(ctx, query, args...); err != nil {
				return nil, err
			}
			if columnChanged {
				after := before
				after.ColumnID = order.ColumnID
				after.Position = pos
				after.UpdatedAt = now
				if err = appendHistory(ctx, tx, &before, after, "updated"); err != nil {
					return nil, err
				}
			}
		}
	}

	cards, err := listOrderedCards(ctx, tx)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return cards, nil
}

// lockCardsInColumns reads and locks every card in the given columns. ORDER BY only sorts the result: InnoDB
// locks rows in the order the chosen index is scanned (cards_column_position for a large table, the primary key
// for a tiny one), so the lock order is not guaranteed. Callers are serialized by the all-columns lock
// (lockColumnRows / lockExistingColumn) taken first, which is what keeps concurrent writers from deadlocking.
func lockCardsInColumns(ctx context.Context, tx *sql.Tx, columnIDs []int64) ([]Card, error) {
	if len(columnIDs) == 0 {
		return nil, ErrCardOrder
	}
	query := "SELECT id FROM cards WHERE column_id IN (" + placeholders(len(columnIDs)) + ") ORDER BY id FOR UPDATE"
	args := make([]any, len(columnIDs))
	for i, id := range columnIDs {
		args[i] = id
	}
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	cards := make([]Card, 0, len(ids))
	for _, id := range ids {
		c, err := scanCard(tx.QueryRowContext(ctx, "SELECT "+cardFields+numberedCards+" WHERE c.id=?", id))
		if err != nil {
			return nil, err
		}
		cards = append(cards, c)
	}
	// PR URLs are read in a separate query (not joined) so one card is never returned once per PR and
	// card_pr_links rows are never locked on behalf of a reorder.
	if err = attachPRURLs(ctx, tx, cards); err != nil {
		return nil, err
	}
	return cards, nil
}

func placeholders(n int) string {
	if n <= 0 {
		return ""
	}
	b := make([]byte, 0, n*2-1)
	for i := 0; i < n; i++ {
		if i > 0 {
			b = append(b, ',')
		}
		b = append(b, '?')
	}
	return string(b)
}
