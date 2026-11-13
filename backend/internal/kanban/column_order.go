package kanban

import (
	"context"
	"database/sql"
)

func (r MySQLRepository) ReorderColumns(ctx context.Context, columnIDs []int64) ([]Column, error) {
	if err := validateColumnOrder(columnIDs); err != nil {
		return nil, err
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	existing, err := lockColumnRows(ctx, tx)
	if err != nil {
		return nil, err
	}
	if !sameColumnIDSet(existing, columnIDs) {
		return nil, ErrColumnMismatch
	}
	for pos, colID := range columnIDs {
		if _, err := tx.ExecContext(ctx, "UPDATE board_columns SET position=? WHERE id=?", pos, colID); err != nil {
			return nil, err
		}
	}
	cols, err := listOrderedColumns(ctx, tx)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return cols, nil
}

func lockColumnRows(ctx context.Context, tx *sql.Tx) ([]Column, error) {
	return queryColumns(ctx, tx, "SELECT id,name,position FROM board_columns ORDER BY id FOR UPDATE")
}

func listOrderedColumns(ctx context.Context, tx *sql.Tx) ([]Column, error) {
	return queryColumns(ctx, tx, "SELECT id,name,position FROM board_columns ORDER BY position,id")
}

func queryColumns(ctx context.Context, tx *sql.Tx, query string) ([]Column, error) {
	rows, err := tx.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols := []Column{}
	for rows.Next() {
		var c Column
		if err := rows.Scan(&c.ID, &c.Name, &c.Position); err != nil {
			return nil, err
		}
		cols = append(cols, c)
	}
	return cols, rows.Err()
}

func sameColumnIDSet(existing []Column, requested []int64) bool {
	if len(existing) != len(requested) {
		return false
	}
	known := make(map[int64]struct{}, len(existing))
	for _, c := range existing {
		known[c.ID] = struct{}{}
	}
	for _, colID := range requested {
		if _, ok := known[colID]; !ok {
			return false
		}
	}
	return true
}
