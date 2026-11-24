package kanban

import (
	"context"
	"database/sql"
)

func (r MySQLRepository) Backlog(ctx context.Context) ([]Item, error) {
	return r.loadBacklog(ctx, 0)
}

func (r MySQLRepository) BacklogForProject(ctx context.Context, projectID int64) ([]Item, error) {
	if projectID <= 0 {
		return nil, ErrProject
	}
	return r.loadBacklog(ctx, projectID)
}

func (r MySQLRepository) loadBacklog(ctx context.Context, itemProjectID int64) ([]Item, error) {
	tx, err := r.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	rawSettings, err := loadBoardSettings(ctx, tx)
	if err != nil {
		return nil, err
	}
	projects, err := listProjects(ctx, tx)
	if err != nil {
		return nil, err
	}
	active := resolveActiveProjectID(rawSettings.ActiveProjectID, projects)
	scope, err := resolveItemListScope(active, itemProjectID, projects)
	if err != nil {
		return nil, err
	}
	cards, err := listBacklogCards(ctx, tx, scope)
	if err != nil {
		return nil, err
	}
	return cards, tx.Commit()
}

func (r MySQLRepository) ReorderBacklog(ctx context.Context, cardIDs []int64) ([]Item, error) {
	if err := validateBacklogOrder(cardIDs); err != nil {
		return nil, err
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	// Every card writer takes the all-columns lock before touching cards (see lockColumnRows), so ReorderBacklog
	// must too: otherwise its primary-key-order card locks invert against ReorderItems' index-order locks (deadlock).
	if _, err = lockColumnRows(ctx, tx); err != nil {
		return nil, err
	}
	countBacklogReorderMeasuredSQL()
	active, err := resolvedActiveProjectID(ctx, tx)
	if err != nil {
		return nil, err
	}
	countBacklogReorderMeasuredSQL()
	existing, err := lockProjectCards(ctx, tx, active)
	if err != nil {
		return nil, err
	}
	countBacklogReorderMeasuredSQL()
	if !sameItemIDSet(existing, cardIDs) {
		return nil, ErrBacklogMismatch
	}
	current, err := lockBacklogPositions(ctx, tx, active)
	if err != nil {
		return nil, err
	}
	countBacklogReorderMeasuredSQL()
	if err = execBacklogReorderBatch(ctx, tx, changedBacklogAssignments(current, cardIDs)); err != nil {
		return nil, err
	}
	cards, err := listBacklogCards(ctx, tx, active)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return cards, nil
}

func nextBacklogPosition(ctx context.Context, tx *sql.Tx, projectID int64) (int, error) {
	ids, err := lockProjectCards(ctx, tx, projectID)
	if err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, nil
	}
	var maxPos int
	err = tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(backlog_position), -1) FROM items WHERE project_id=? AND deleted_at IS NULL AND archived_at IS NULL", projectID).Scan(&maxPos)
	if err != nil {
		return 0, err
	}
	return maxPos + 1, nil
}

type backlogPositionAssign struct {
	ID       int64
	Position int
}

func lockBacklogPositions(ctx context.Context, tx *sql.Tx, projectID int64) (map[int64]int, error) {
	rows, err := tx.QueryContext(ctx, "SELECT id, backlog_position FROM items WHERE project_id=? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY id FOR UPDATE", projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[int64]int)
	for rows.Next() {
		var id int64
		var pos int
		if err = rows.Scan(&id, &pos); err != nil {
			return nil, err
		}
		out[id] = pos
	}
	return out, rows.Err()
}

func changedBacklogAssignments(current map[int64]int, cardIDs []int64) []backlogPositionAssign {
	changed := make([]backlogPositionAssign, 0, len(cardIDs))
	for pos, id := range cardIDs {
		if cur, ok := current[id]; !ok || cur != pos {
			changed = append(changed, backlogPositionAssign{ID: id, Position: pos})
		}
	}
	return changed
}

func buildBacklogReorderBatchSQL(rows []backlogPositionAssign) (string, []any) {
	ids := make([]int64, len(rows))
	values := make([]int, len(rows))
	for i, row := range rows {
		ids[i] = row.ID
		values[i] = row.Position
	}
	return buildIntCaseColumnUpdateSQL("backlog_position", ids, values)
}

func execBacklogReorderBatch(ctx context.Context, tx *sql.Tx, rows []backlogPositionAssign) error {
	if len(rows) == 0 {
		return nil
	}
	query, args := buildBacklogReorderBatchSQL(rows)
	if _, err := tx.ExecContext(ctx, query, args...); err != nil {
		return err
	}
	countBacklogReorderMeasuredSQL()
	return nil
}

func lockProjectCards(ctx context.Context, tx *sql.Tx, projectID int64) ([]int64, error) {
	rows, err := tx.QueryContext(ctx, "SELECT id FROM items WHERE project_id=? AND deleted_at IS NULL AND archived_at IS NULL ORDER BY id FOR UPDATE", projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func lockAllCards(ctx context.Context, tx *sql.Tx) ([]int64, error) {
	rows, err := tx.QueryContext(ctx, "SELECT id FROM items ORDER BY id FOR UPDATE")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// listBacklogCards は一覧の形（説明を切り、ソリューションを空にしたもの。cardListFields）で返す。
// 応答にだけ使い、書き戻しには使わない。
func listBacklogCards(ctx context.Context, tx *sql.Tx, projectID int64) ([]Item, error) {
	rows, err := tx.QueryContext(ctx, "SELECT "+cardListFields+numberedCards+" WHERE c.project_id=? AND c.deleted_at IS NULL AND c.archived_at IS NULL ORDER BY c.backlog_position,c.id", projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cards := []Item{}
	for rows.Next() {
		c, err := scanCard(rows)
		if err != nil {
			return nil, err
		}
		cards = append(cards, c)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	if err = attachPRURLs(ctx, tx, cards); err != nil {
		return nil, err
	}
	if err = attachRelatedItems(ctx, tx, cards); err != nil {
		return nil, err
	}
	return cards, nil
}

func sameItemIDSet(existing, requested []int64) bool {
	if len(existing) != len(requested) {
		return false
	}
	known := make(map[int64]struct{}, len(existing))
	for _, id := range existing {
		known[id] = struct{}{}
	}
	for _, id := range requested {
		if _, ok := known[id]; !ok {
			return false
		}
	}
	return true
}
