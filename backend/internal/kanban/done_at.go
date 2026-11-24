package kanban

import (
	"context"
	"database/sql"
	"time"
)

// isFinishedColumnName tells the columns whose items count as finished: Done and Close. An item
// gets its done_at time on entering one of them from outside, loses it on leaving them, and is
// archived archiveAfterDone after it (names are matched exactly, case-sensitively).
func isFinishedColumnName(name string) bool {
	return name == "Done" || name == "Close"
}

func isFinishedColumn(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, columnID int64) (bool, error) {
	var name string
	if err := q.QueryRowContext(ctx, "SELECT name FROM board_columns WHERE id=?", columnID).Scan(&name); err != nil {
		return false, err
	}
	return isFinishedColumnName(name), nil
}

func doneAtForColumn(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, columnID int64) (*time.Time, error) {
	done, err := isFinishedColumn(ctx, q, columnID)
	if err != nil || !done {
		return nil, err
	}
	now := time.Now().UTC()
	return &now, nil
}
