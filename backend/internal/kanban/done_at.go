package kanban

import (
	"context"
	"database/sql"
	"time"
)

func isDoneColumn(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, columnID int64) (bool, error) {
	var name string
	if err := q.QueryRowContext(ctx, "SELECT name FROM board_columns WHERE id=?", columnID).Scan(&name); err != nil {
		return false, err
	}
	return name == "Done", nil
}

func doneAtForColumn(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, columnID int64) (*time.Time, error) {
	done, err := isDoneColumn(ctx, q, columnID)
	if err != nil || !done {
		return nil, err
	}
	now := time.Now().UTC()
	return &now, nil
}
