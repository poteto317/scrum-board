package kanban

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"
)

// archiveAfterDone is how long an item stays on the board after it became Done or Close.
const archiveAfterDone = 10 * 24 * time.Hour
const archiveBatchSize = 100

type ArchiveRepository interface {
	ListArchivedItems(context.Context, int64) ([]Item, error)
	ArchiveDoneItems(context.Context) (int, error)
	RestoreArchivedItem(context.Context, int64, int64) (Item, error)
}

func ensureActiveItemForWrite(ctx context.Context, tx *sql.Tx, itemID int64) error {
	var id int64
	err := tx.QueryRowContext(ctx, `SELECT id FROM items
WHERE id=? AND deleted_at IS NULL AND archived_at IS NULL FOR UPDATE`, itemID).Scan(&id)
	if err == sql.ErrNoRows {
		return ErrNotFound
	}
	return err
}

func (r MySQLRepository) ListArchivedItems(ctx context.Context, projectID int64) ([]Item, error) {
	if projectID <= 0 {
		return nil, ErrProject
	}
	var exists int
	if err := r.DB.QueryRowContext(ctx, "SELECT COUNT(*) FROM projects WHERE id=?", projectID).Scan(&exists); err != nil {
		return nil, err
	}
	if exists == 0 {
		return nil, ErrProject
	}
	rows, err := r.DB.QueryContext(ctx, "SELECT "+cardFields+numberedCards+" WHERE c.project_id=? AND c.deleted_at IS NULL AND c.archived_at IS NOT NULL ORDER BY c.archived_at DESC,c.id DESC", projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Item{}
	for rows.Next() {
		item, scanErr := scanCard(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	if err = attachPRURLs(ctx, r.DB, items); err != nil {
		return nil, err
	}
	if err = attachRelatedItems(ctx, r.DB, items); err != nil {
		return nil, err
	}
	if err = attachLabels(ctx, r.DB, items); err != nil {
		return nil, err
	}
	return items, nil
}

func (r MySQLRepository) ArchiveDoneItems(ctx context.Context) (int, error) {
	now := time.Now().UTC()
	cutoff := now.Add(-archiveAfterDone)
	var archived int
	var cursor int64
	// The SQL below must list the same columns as isFinishedColumnName.
	for {
		tx, err := r.DB.BeginTx(ctx, nil)
		if err != nil {
			return archived, err
		}
		if _, err = lockColumnRows(ctx, tx); err != nil {
			tx.Rollback()
			return archived, err
		}
		rows, err := tx.QueryContext(ctx, `SELECT i.id, i.done_at
FROM items i JOIN board_columns c ON c.id=i.column_id
WHERE i.id>? AND i.deleted_at IS NULL AND i.archived_at IS NULL
  AND (BINARY c.name=BINARY 'Done' OR BINARY c.name=BINARY 'Close')
  AND (i.done_at IS NULL OR i.done_at<=?)
ORDER BY i.id LIMIT ? FOR UPDATE`, cursor, cutoff, archiveBatchSize)
		if err != nil {
			tx.Rollback()
			return archived, err
		}
		type candidate struct {
			id     int64
			doneAt sql.NullTime
		}
		batch := make([]candidate, 0, archiveBatchSize)
		for rows.Next() {
			var item candidate
			if err = rows.Scan(&item.id, &item.doneAt); err != nil {
				rows.Close()
				tx.Rollback()
				return archived, err
			}
			batch = append(batch, item)
		}
		if err = rows.Err(); err != nil {
			rows.Close()
			tx.Rollback()
			return archived, err
		}
		rows.Close()
		if len(batch) == 0 {
			if err = tx.Commit(); err != nil {
				return archived, err
			}
			return archived, nil
		}
		cursor = batch[len(batch)-1].id
		for _, candidate := range batch {
			archivedItem, archiveErr := archiveDoneCandidate(ctx, tx, candidate.id, candidate.doneAt, now, cutoff)
			if archiveErr != nil {
				tx.Rollback()
				return archived, archiveErr
			}
			if archivedItem {
				archived++
			}
		}
		if err = tx.Commit(); err != nil {
			return archived, err
		}
	}
}

func archiveDoneCandidate(ctx context.Context, tx *sql.Tx, id int64, doneAt sql.NullTime, now, cutoff time.Time) (bool, error) {
	var doneAtTime *time.Time
	if doneAt.Valid {
		t := doneAt.Time
		doneAtTime = &t
	}
	latestDoneAt, err := latestFinishedTransitionAt(ctx, tx, id)
	if err != nil {
		return false, fmt.Errorf("read Done/Close transition history for item %d: %w", id, err)
	}
	effective := effectiveDoneAt(doneAtTime, latestDoneAt)
	if effective == nil {
		slog.WarnContext(ctx, "archive item has no effective Done/Close time", "item_id", id)
		return false, nil
	}
	if !isArchiveDue(effective, cutoff) {
		return false, nil
	}
	before, err := loadCard(ctx, tx, "SELECT "+cardFields+numberedCards+" WHERE c.id=? AND c.deleted_at IS NULL AND c.archived_at IS NULL", id)
	if err != nil {
		return false, err
	}
	result, err := tx.ExecContext(ctx, "UPDATE items SET archived_at=? WHERE id=? AND deleted_at IS NULL AND archived_at IS NULL", now, id)
	if err != nil {
		return false, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	if changed != 1 {
		return false, nil
	}
	after := before
	after.ArchivedAt = &now
	after.UpdatedAt = now
	if err = appendHistory(ctx, tx, &before, after, "updated"); err != nil {
		return false, err
	}
	return true, nil
}

// latestFinishedTransitionAt is when the item last entered Done or Close from another column, from
// its history. A Done<->Close move is not an entry: it keeps the finish time, so it must not restart
// the archive timer.
func latestFinishedTransitionAt(ctx context.Context, q interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, itemID int64) (*time.Time, error) {
	rows, err := q.QueryContext(ctx, `SELECT occurred_at, changes
FROM item_history
WHERE item_id=? AND kind='updated'
ORDER BY occurred_at DESC, id DESC`, itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var occurredAt time.Time
		var payload []byte
		if err = rows.Scan(&occurredAt, &payload); err != nil {
			return nil, err
		}
		var changes []HistoryChange
		if err = json.Unmarshal(payload, &changes); err != nil {
			return nil, fmt.Errorf("decode item %d history changes: %w", itemID, err)
		}
		for _, change := range changes {
			if change.Field == "status" && isFinishedColumnName(change.After) && !isFinishedColumnName(change.Before) {
				at := occurredAt
				return &at, nil
			}
		}
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return nil, nil
}

func (r MySQLRepository) RestoreArchivedItem(ctx context.Context, id, projectID int64) (Item, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Item{}, err
	}
	defer tx.Rollback()
	if _, err = lockColumnRows(ctx, tx); err != nil {
		return Item{}, err
	}
	before, err := loadCard(ctx, tx, "SELECT "+cardFields+numberedCards+" WHERE c.id=? AND c.project_id=? AND c.deleted_at IS NULL AND c.archived_at IS NOT NULL FOR UPDATE", id, projectID)
	if err != nil {
		return Item{}, dbError(err)
	}
	restoreColumn, err := findRestoreColumn(ctx, tx, before.ColumnID)
	if err != nil {
		return Item{}, err
	}
	position, err := nextCardPosition(ctx, tx, restoreColumn.ID, projectID)
	if err != nil {
		return Item{}, err
	}
	layout, err := loadBoardSettings(ctx, tx)
	if err != nil {
		return Item{}, err
	}
	offsetY := 0
	if layout.CardLayout == CardLayoutFree {
		offsetY, err = nextFreeOffsetY(ctx, tx, restoreColumn.ID, projectID)
		if err != nil {
			return Item{}, err
		}
	}
	now := time.Now().UTC()
	result, err := tx.ExecContext(ctx, `UPDATE items
SET column_id=?, position=?, offset_y=?, archived_at=NULL, done_at=?
WHERE id=? AND project_id=? AND deleted_at IS NULL AND archived_at IS NOT NULL`, restoreColumn.ID, position, offsetY, now, id, projectID)
	if err != nil {
		return Item{}, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return Item{}, err
	}
	if changed != 1 {
		return Item{}, ErrNotFound
	}
	after, err := loadCard(ctx, tx, "SELECT "+cardFields+numberedCards+" WHERE c.id=?", id)
	if err != nil {
		return Item{}, err
	}
	after.UpdatedAt = now
	if err = appendHistory(ctx, tx, &before, after, "updated"); err != nil {
		return Item{}, err
	}
	if err = tx.Commit(); err != nil {
		return Item{}, err
	}
	return after, nil
}

// findRestoreColumn is the column an archived item goes back to: the one it was archived in (Done or
// Close). An item whose column is no longer a finished one goes to Done, as before.
func findRestoreColumn(ctx context.Context, tx *sql.Tx, itemColumnID int64) (Column, error) {
	cols, err := listOrderedColumns(ctx, tx)
	if err != nil {
		return Column{}, err
	}
	for _, column := range cols {
		if column.ID == itemColumnID && isFinishedColumnName(column.Name) {
			return column, nil
		}
	}
	for _, column := range cols {
		if column.Name == "Done" {
			return column, nil
		}
	}
	return Column{}, ErrColumn
}

var _ ArchiveRepository = MySQLRepository{}
