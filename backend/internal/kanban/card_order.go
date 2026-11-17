package kanban

import (
	"context"
	"database/sql"
	"time"
)

// cardReorderPlan is the SQL/skip decision for one card in ReorderItems.
type cardReorderPlan struct {
	Skip          bool
	ColumnChanged bool
	Query         string
	Args          []any
	NextOffset    int
}

// planCardReorder decides whether to skip an UPDATE and, if not, which query/args to run.
// updated_at is the card's edit time: only a column (status) change moves it. A card that merely
// shifts position/offset keeps it (and its history revision) as it was.
func planCardReorder(before Item, columnID int64, pos int, offsetY *int, now time.Time) cardReorderPlan {
	nextOffset := before.OffsetY
	offsetChanged := false
	if offsetY != nil {
		nextOffset = *offsetY
		offsetChanged = before.OffsetY != nextOffset
	}
	columnChanged := before.ColumnID != columnID
	if !columnChanged && before.Position == pos && !offsetChanged {
		return cardReorderPlan{Skip: true, NextOffset: nextOffset}
	}
	query := "UPDATE items SET column_id=?, position=?, offset_y=?, updated_at=updated_at WHERE id=?"
	args := []any{columnID, pos, nextOffset, before.ID}
	if columnChanged {
		query = "UPDATE items SET column_id=?, position=?, offset_y=?, updated_at=? WHERE id=?"
		args = []any{columnID, pos, nextOffset, now, before.ID}
	}
	return cardReorderPlan{
		ColumnChanged: columnChanged,
		Query:         query,
		Args:          args,
		NextOffset:    nextOffset,
	}
}

func (r MySQLRepository) ReorderItems(ctx context.Context, orders []ItemColumnOrder) ([]Item, error) {
	if err := validateItemOrder(orders); err != nil {
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
			return nil, ErrItemOrderMismatch
		}
	}

	requestedSet := make(map[int64]struct{})
	for _, order := range orders {
		for _, id := range order.ItemIDs {
			if _, dup := requestedSet[id]; dup {
				return nil, ErrItemOrder
			}
			requestedSet[id] = struct{}{}
		}
	}

	columnIDs := make([]int64, len(orders))
	for i, order := range orders {
		columnIDs[i] = order.ColumnID
	}
	active, err := resolvedActiveProjectID(ctx, tx)
	if err != nil {
		return nil, err
	}
	existing, err := lockCardsInColumns(ctx, tx, columnIDs, active)
	if err != nil {
		return nil, err
	}
	existingSet := make(map[int64]Item, len(existing))
	for _, c := range existing {
		existingSet[c.ID] = c
	}
	if len(existingSet) != len(requestedSet) {
		return nil, ErrItemOrderMismatch
	}
	for id := range requestedSet {
		if _, ok := existingSet[id]; !ok {
			return nil, ErrItemOrderMismatch
		}
	}

	now := time.Now().UTC()
	for _, order := range orders {
		for pos, cardID := range order.ItemIDs {
			before := existingSet[cardID]
			var offsetY *int
			if order.OffsetYs != nil {
				offsetY = &(*order.OffsetYs)[pos]
			}
			plan := planCardReorder(before, order.ColumnID, pos, offsetY, now)
			if plan.Skip {
				continue
			}
			if _, err = tx.ExecContext(ctx, plan.Query, plan.Args...); err != nil {
				return nil, err
			}
			if plan.ColumnChanged {
				after := before
				after.ColumnID = order.ColumnID
				after.Position = pos
				after.OffsetY = plan.NextOffset
				after.UpdatedAt = now
				if err = appendHistory(ctx, tx, &before, after, "updated"); err != nil {
					return nil, err
				}
			}
		}
	}

	cards, err := listOrderedCards(ctx, tx, active)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return cards, nil
}

// lockCardsInColumns reads and locks every card in the given columns. ORDER BY only sorts the result: InnoDB
// locks rows in the order the chosen index is scanned (items_column_position for a large table, the primary key
// for a tiny one), so the lock order is not guaranteed. Callers are serialized by the all-columns lock
// (lockColumnRows / lockExistingColumn) taken first, which is what keeps concurrent writers from deadlocking.
func lockCardsInColumns(ctx context.Context, tx *sql.Tx, columnIDs []int64, projectID int64) ([]Item, error) {
	if len(columnIDs) == 0 {
		return nil, ErrItemOrder
	}
	query := "SELECT id FROM items WHERE project_id=? AND column_id IN (" + placeholders(len(columnIDs)) + ") ORDER BY id FOR UPDATE"
	args := make([]any, 0, len(columnIDs)+1)
	args = append(args, projectID)
	for _, id := range columnIDs {
		args = append(args, id)
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
	cards := make([]Item, 0, len(ids))
	for _, id := range ids {
		c, err := scanCard(tx.QueryRowContext(ctx, "SELECT "+cardFields+numberedCards+" WHERE c.id=?", id))
		if err != nil {
			return nil, err
		}
		cards = append(cards, c)
	}
	// PR URLs are read in a separate query (not joined) so one card is never returned once per PR and
	// item_pr_links rows are never locked on behalf of a reorder.
	if err = attachPRURLs(ctx, tx, cards); err != nil {
		return nil, err
	}
	if err = attachRelatedItems(ctx, tx, cards); err != nil {
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
