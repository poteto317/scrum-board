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
	DoneAt        *time.Time
}

// planCardReorder decides whether to skip an UPDATE and, if not, which query/args to run.
// updated_at is the card's edit time: only a column (status) change moves it. A card that merely
// shifts position/offset keeps it (and its history revision) as it was.
// ReorderItems uses Skip/ColumnChanged/NextOffset/DoneAt only; Query/Args remain for unit tests.
func planCardReorder(before Item, columnID int64, pos int, offsetY *int, now time.Time, sourceDone, targetDone bool) cardReorderPlan {
	nextOffset := before.OffsetY
	offsetChanged := false
	if offsetY != nil {
		nextOffset = *offsetY
		offsetChanged = before.OffsetY != nextOffset
	}
	columnChanged := before.ColumnID != columnID
	doneAt := before.DoneAt
	if columnChanged {
		if targetDone && !sourceDone {
			doneAt = &now
		} else if !targetDone {
			doneAt = nil
		}
	}
	if !columnChanged && before.Position == pos && !offsetChanged {
		return cardReorderPlan{Skip: true, NextOffset: nextOffset, DoneAt: doneAt}
	}
	query := "UPDATE items SET column_id=?, position=?, offset_y=?, updated_at=updated_at WHERE id=?"
	args := []any{columnID, pos, nextOffset, before.ID}
	if columnChanged {
		query = "UPDATE items SET column_id=?, position=?, offset_y=?, done_at=?, updated_at=? WHERE id=?"
		args = []any{columnID, pos, nextOffset, doneAt, now, before.ID}
	}
	return cardReorderPlan{
		ColumnChanged: columnChanged,
		Query:         query,
		Args:          args,
		NextOffset:    nextOffset,
		DoneAt:        doneAt,
	}
}

// appliedCardReorder is one non-skip plan plus the target column/position for CASE batching.
type appliedCardReorder struct {
	ID       int64
	ColumnID int64
	Position int
	Plan     cardReorderPlan
	Before   Item
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
	countReorderMeasuredSQL()
	knownColumns := make(map[int64]struct{}, len(cols))
	doneColumns := make(map[int64]bool, len(cols))
	for _, c := range cols {
		knownColumns[c.ID] = struct{}{}
		doneColumns[c.ID] = c.Name == "Done"
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
	countReorderMeasuredSQL()
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
	var sameCol, moved []appliedCardReorder
	for _, order := range orders {
		for pos, cardID := range order.ItemIDs {
			before := existingSet[cardID]
			var offsetY *int
			if order.OffsetYs != nil {
				offsetY = &(*order.OffsetYs)[pos]
			}
			plan := planCardReorder(before, order.ColumnID, pos, offsetY, now, doneColumns[before.ColumnID], doneColumns[order.ColumnID])
			if plan.Skip {
				continue
			}
			row := appliedCardReorder{ID: cardID, ColumnID: order.ColumnID, Position: pos, Plan: plan, Before: before}
			if plan.ColumnChanged {
				moved = append(moved, row)
			} else {
				sameCol = append(sameCol, row)
			}
		}
	}
	if err = execCardReorderBatch(ctx, tx, sameCol, false, now); err != nil {
		return nil, err
	}
	if err = execCardReorderBatch(ctx, tx, moved, true, now); err != nil {
		return nil, err
	}
	if err = appendMovedCardHistory(ctx, tx, moved, now); err != nil {
		return nil, err
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

func appendMovedCardHistory(ctx context.Context, tx *sql.Tx, moved []appliedCardReorder, now time.Time) error {
	for _, row := range moved {
		after := row.Before
		after.ColumnID = row.ColumnID
		after.Position = row.Position
		after.OffsetY = row.Plan.NextOffset
		after.DoneAt = row.Plan.DoneAt
		after.UpdatedAt = now
		before := row.Before
		if err := appendHistory(ctx, tx, &before, after, "updated"); err != nil {
			return err
		}
	}
	return nil
}

func buildCardReorderBatchSQL(rows []appliedCardReorder, columnChanged bool, now time.Time) (string, []any) {
	n := len(rows)
	args := make([]any, 0, n*10)
	colCase := "CASE id"
	posCase := "CASE id"
	offCase := "CASE id"
	for _, row := range rows {
		colCase += " WHEN ? THEN ?"
		args = append(args, row.ID, row.ColumnID)
	}
	colCase += " END"
	for _, row := range rows {
		posCase += " WHEN ? THEN ?"
		args = append(args, row.ID, row.Position)
	}
	posCase += " END"
	for _, row := range rows {
		offCase += " WHEN ? THEN ?"
		args = append(args, row.ID, row.Plan.NextOffset)
	}
	offCase += " END"
	var query string
	if columnChanged {
		doneCase := "CASE id"
		updCase := "CASE id"
		for _, row := range rows {
			doneCase += " WHEN ? THEN ?"
			args = append(args, row.ID, row.Plan.DoneAt)
		}
		doneCase += " END"
		for _, row := range rows {
			updCase += " WHEN ? THEN ?"
			args = append(args, row.ID, now)
		}
		updCase += " END"
		query = "UPDATE items SET column_id=" + colCase + ", position=" + posCase + ", offset_y=" + offCase +
			", done_at=" + doneCase + ", updated_at=" + updCase + " WHERE id IN (" + placeholders(n) + ")"
	} else {
		query = "UPDATE items SET column_id=" + colCase + ", position=" + posCase + ", offset_y=" + offCase +
			", updated_at=updated_at WHERE id IN (" + placeholders(n) + ")"
	}
	for _, row := range rows {
		args = append(args, row.ID)
	}
	return query, args
}

func execCardReorderBatch(ctx context.Context, tx *sql.Tx, rows []appliedCardReorder, columnChanged bool, now time.Time) error {
	if len(rows) == 0 {
		return nil
	}
	query, args := buildCardReorderBatchSQL(rows, columnChanged, now)
	if _, err := tx.ExecContext(ctx, query, args...); err != nil {
		return err
	}
	countReorderMeasuredSQL()
	return nil
}

// lockCardsInColumns locks every card in the given columns with one SELECT … FOR UPDATE of
// reorder/history fields only (no description/PR/related). ORDER BY id does not define InnoDB
// lock order; callers take lockColumnRows first so concurrent writers do not deadlock.
func lockCardsInColumns(ctx context.Context, tx *sql.Tx, columnIDs []int64, projectID int64) ([]Item, error) {
	if len(columnIDs) == 0 {
		return nil, ErrItemOrder
	}
	query := "SELECT id, column_id, project_id, position, offset_y, done_at, updated_at FROM items WHERE project_id=? AND deleted_at IS NULL AND archived_at IS NULL AND column_id IN (" + placeholders(len(columnIDs)) + ") ORDER BY id FOR UPDATE"
	args := make([]any, 0, len(columnIDs)+1)
	args = append(args, projectID)
	for _, id := range columnIDs {
		args = append(args, id)
	}
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cards := make([]Item, 0)
	for rows.Next() {
		var c Item
		if err = rows.Scan(&c.ID, &c.ColumnID, &c.ProjectID, &c.Position, &c.OffsetY, &c.DoneAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		cards = append(cards, c)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	countReorderMeasuredSQL()
	return cards, nil
}
