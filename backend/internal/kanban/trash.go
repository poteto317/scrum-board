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

// ListTrash returns the soft-deleted items of projectID still within the retention period, newest
// deleted_at first, with the access policy of each. It only reads: expired rows are hidden and
// left to the purge job (POST /api/trash/purge), and the allowlists of the restricted items come
// from one batched query, so the number of statements does not grow with the trash.
func (r MySQLRepository) ListTrash(ctx context.Context, projectID int64) ([]TrashEntry, error) {
	rows, err := r.DB.QueryContext(ctx, `
SELECT c.id, n.item_number, c.title, c.project_id, c.deleted_at, c.view_access, c.edit_access, c.created_by_user_id
  FROM items c
  JOIN item_numbers n ON n.item_id=c.id
 WHERE c.project_id=? AND c.deleted_at IS NOT NULL AND c.deleted_at>?
 ORDER BY c.deleted_at DESC, c.id DESC`, projectID, trashCutoff(time.Now().UTC()))
	if err != nil {
		return nil, err
	}
	out, restricted, err := scanTrashEntries(rows)
	if err != nil {
		return nil, err
	}
	if err = r.attachTrashAllowlists(ctx, out, restricted); err != nil {
		return nil, err
	}
	return out, nil
}

// scanTrashEntries reads and closes rows, and returns the ids whose allowlists are still to load
// (the restricted ones).
func scanTrashEntries(rows *sql.Rows) ([]TrashEntry, []int64, error) {
	out := []TrashEntry{}
	var restricted []int64
	for rows.Next() {
		var e TrashEntry
		var createdBy sql.NullInt64
		if err := rows.Scan(&e.ID, &e.Number, &e.Title, &e.ProjectID, &e.DeletedAt, &e.ACL.ViewAccess, &e.ACL.EditAccess, &createdBy); err != nil {
			rows.Close()
			return nil, nil, err
		}
		if createdBy.Valid {
			id := createdBy.Int64
			e.ACL.CreatedByUserID = &id
		}
		if e.ACL.ViewAccess == "" {
			e.ACL.ViewAccess = ViewAccessOpen
		}
		if e.ACL.ViewAccess == ViewAccessRestricted || e.ACL.EditAccess == EditAccessRestricted {
			restricted = append(restricted, e.ID)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, nil, err
	}
	return out, restricted, rows.Close()
}

// attachTrashAllowlists loads the allowlists of the restricted entries in one query.
func (r MySQLRepository) attachTrashAllowlists(ctx context.Context, entries []TrashEntry, restrictedIDs []int64) error {
	allowlists, err := r.ListACLEntriesForItems(ctx, restrictedIDs)
	if err != nil {
		return err
	}
	for i := range entries {
		if acl, ok := allowlists[entries[i].ID]; ok {
			entries[i].ACL.ViewUserIDs = acl.ViewUserIDs
			entries[i].ACL.EditUserIDs = acl.EditUserIDs
		}
	}
	return nil
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
	return r.purgeExpired(ctx)
}

func (r MySQLRepository) purgeExpired(ctx context.Context) (int64, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if _, err = lockColumnRows(ctx, tx); err != nil {
		return 0, err
	}
	cutoff := trashCutoff(time.Now().UTC())
	rows, err := tx.QueryContext(ctx, `
SELECT id FROM items
 WHERE deleted_at IS NOT NULL AND deleted_at<=?
 ORDER BY id FOR UPDATE`, cutoff)
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
