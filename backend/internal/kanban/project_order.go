package kanban

import (
	"context"
	"database/sql"
)

func (r MySQLRepository) ReorderProjects(ctx context.Context, projectIDs []int64) ([]Project, error) {
	if err := validateProjectOrder(projectIDs); err != nil {
		return nil, err
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	existing, err := lockProjectRows(ctx, tx)
	if err != nil {
		return nil, err
	}
	if !sameProjectIDSet(existing, projectIDs) {
		return nil, ErrProjectMismatch
	}
	for pos, id := range projectIDs {
		if _, err := tx.ExecContext(ctx, "UPDATE projects SET position=? WHERE id=?", pos, id); err != nil {
			return nil, err
		}
	}
	projects, err := listProjects(ctx, tx)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return projects, nil
}

func lockProjectRows(ctx context.Context, tx *sql.Tx) ([]Project, error) {
	return queryProjects(ctx, tx, `SELECT id, name, position, created_at, updated_at FROM projects ORDER BY id FOR UPDATE`)
}

func sameProjectIDSet(existing []Project, requested []int64) bool {
	if len(existing) != len(requested) {
		return false
	}
	known := make(map[int64]struct{}, len(existing))
	for _, p := range existing {
		known[p.ID] = struct{}{}
	}
	for _, id := range requested {
		if _, ok := known[id]; !ok {
			return false
		}
	}
	return true
}
