package kanban

import (
	"context"
	"database/sql"
	"time"
)

const trashRetention = 30 * 24 * time.Hour

func trashCutoff(now time.Time) time.Time {
	return now.Add(-trashRetention)
}

// ListTrash returns soft-deleted items for projectID, newest deleted_at first.
// Opportunistic purge for that project runs first.
func (r MySQLRepository) ListTrash(ctx context.Context, projectID int64) ([]TrashItem, error) {
	if _, err := r.PurgeExpiredTrashForProject(ctx, projectID); err != nil {
		return nil, err
	}
	rows, err := r.DB.QueryContext(ctx, `
SELECT c.id, n.item_number, c.title, c.project_id, c.deleted_at
  FROM items c
  JOIN item_numbers n ON n.item_id=c.id
 WHERE c.project_id=? AND c.deleted_at IS NOT NULL
 ORDER BY c.deleted_at DESC, c.id DESC`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TrashItem{}
	for rows.Next() {
		var t TrashItem
		if err = rows.Scan(&t.ID, &t.Number, &t.Title, &t.ProjectID, &t.DeletedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// RestoreItem clears deleted_at for a soft-deleted item in projectID.
// If column_id is missing/invalid for the board, moves to Todo.
func (r MySQLRepository) RestoreItem(ctx context.Context, id, projectID int64) (Item, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Item{}, err
	}
	defer tx.Rollback()
	if _, err = lockColumnRows(ctx, tx); err != nil {
		return Item{}, err
	}
	var lockedID, lockedProject, columnID int64
	err = tx.QueryRowContext(ctx, `
SELECT id, project_id, column_id FROM items
 WHERE id=? AND project_id=? AND deleted_at IS NOT NULL FOR UPDATE`, id, projectID).
		Scan(&lockedID, &lockedProject, &columnID)
	if err != nil {
		return Item{}, dbError(err)
	}
	cols, err := listOrderedColumns(ctx, tx)
	if err != nil {
		return Item{}, err
	}
	if !columnIDExists(cols, columnID) {
		todoID, err := todoColumnIDFromColumns(cols)
		if err != nil {
			return Item{}, err
		}
		if _, err = tx.ExecContext(ctx, "UPDATE items SET column_id=?,done_at=NULL WHERE id=?", todoID, id); err != nil {
			return Item{}, err
		}
	} else {
		columnFinished := false
		for _, column := range cols {
			if column.ID == columnID {
				columnFinished = isFinishedColumnName(column.Name)
				break
			}
		}
		if !columnFinished {
			if _, err = tx.ExecContext(ctx, "UPDATE items SET done_at=NULL WHERE id=?", id); err != nil {
				return Item{}, err
			}
		}
	}
	if _, err = tx.ExecContext(ctx, "UPDATE items SET deleted_at=NULL WHERE id=?", id); err != nil {
		return Item{}, err
	}
	card, err := loadCard(ctx, tx, "SELECT "+cardFields+numberedCards+" WHERE c.id=? AND c.deleted_at IS NULL", id)
	if err != nil {
		return Item{}, err
	}
	return card, tx.Commit()
}

func todoColumnIDFromColumns(cols []Column) (int64, error) {
	for _, c := range cols {
		if c.Name == "Todo" {
			return c.ID, nil
		}
	}
	return 0, ErrColumn
}

// PurgeExpiredTrash hard-deletes soft-deleted rows across all projects at/ past retention.
func (r MySQLRepository) PurgeExpiredTrash(ctx context.Context) (int64, error) {
	return r.purgeExpired(ctx, 0)
}

// PurgeExpiredTrashForProject hard-deletes expired soft-deleted rows for one project.
func (r MySQLRepository) PurgeExpiredTrashForProject(ctx context.Context, projectID int64) (int64, error) {
	if projectID <= 0 {
		return 0, ErrProject
	}
	return r.purgeExpired(ctx, projectID)
}

func (r MySQLRepository) purgeExpired(ctx context.Context, projectID int64) (int64, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if _, err = lockColumnRows(ctx, tx); err != nil {
		return 0, err
	}
	cutoff := trashCutoff(time.Now().UTC())
	var rows *sql.Rows
	if projectID > 0 {
		rows, err = tx.QueryContext(ctx, `
SELECT id FROM items
 WHERE project_id=? AND deleted_at IS NOT NULL AND deleted_at<=?
 ORDER BY id FOR UPDATE`, projectID, cutoff)
	} else {
		rows, err = tx.QueryContext(ctx, `
SELECT id FROM items
 WHERE deleted_at IS NOT NULL AND deleted_at<=?
 ORDER BY id FOR UPDATE`, cutoff)
	}
	if err != nil {
		return 0, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()
	var n int64
	for _, id := range ids {
		res, err := tx.ExecContext(ctx, "DELETE FROM items WHERE id=?", id)
		if err != nil {
			return 0, err
		}
		affected, err := res.RowsAffected()
		if err != nil {
			return 0, err
		}
		n += affected
	}
	return n, tx.Commit()
}

// HardDeleteTrashItem permanently deletes a soft-deleted item scoped to projectID.
func (r MySQLRepository) HardDeleteTrashItem(ctx context.Context, id, projectID int64) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = lockColumnRows(ctx, tx); err != nil {
		return err
	}
	var lockedID int64
	err = tx.QueryRowContext(ctx, `
SELECT id FROM items WHERE id=? AND project_id=? AND deleted_at IS NOT NULL FOR UPDATE`, id, projectID).
		Scan(&lockedID)
	if err != nil {
		return dbError(err)
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM items WHERE id=?", id); err != nil {
		return err
	}
	return tx.Commit()
}
