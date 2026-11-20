package kanban

import (
	"context"
	"database/sql"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	maxSprintNameLen = 120
	maxSprintGoalLen = 2000
)

func normalizeSprintName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > maxSprintNameLen {
		return "", ErrSprint
	}
	return name, nil
}

func normalizeSprintGoal(goal string) (string, error) {
	if !utf8.ValidString(goal) || utf8.RuneCountInString(goal) > maxSprintGoalLen {
		return "", ErrSprint
	}
	return goal, nil
}

func parseSprintDate(s string) (string, error) {
	t, err := time.Parse("2006-01-02", s)
	if err != nil || t.Format("2006-01-02") != s {
		return "", ErrSprint
	}
	return s, nil
}

func validateSprintDateRange(start, end string) error {
	if start > end {
		return ErrSprint
	}
	return nil
}

// buildFinalSprintItemIDs orders visible IDs first, then retain IDs in previousOrder relative order.
// IDs present in both visible and retain appear once (from visible). Invalid visible IDs return ErrSprint.
func buildFinalSprintItemIDs(previousOrder, visible, retainIDs []int64) ([]int64, error) {
	retainSet := map[int64]struct{}{}
	for _, rid := range retainIDs {
		retainSet[rid] = struct{}{}
	}
	orderedRetain := make([]int64, 0, len(retainIDs))
	for _, pid := range previousOrder {
		if _, ok := retainSet[pid]; ok {
			orderedRetain = append(orderedRetain, pid)
		}
	}
	final := make([]int64, 0, len(visible)+len(orderedRetain))
	seen := map[int64]struct{}{}
	for _, iid := range visible {
		if iid <= 0 {
			return nil, ErrSprint
		}
		if _, dup := seen[iid]; dup {
			return nil, ErrSprint
		}
		seen[iid] = struct{}{}
		final = append(final, iid)
	}
	for _, rid := range orderedRetain {
		if _, dup := seen[rid]; dup {
			continue
		}
		seen[rid] = struct{}{}
		final = append(final, rid)
	}
	return final, nil
}

func (r MySQLRepository) ListSprints(ctx context.Context, projectID int64) ([]Sprint, error) {
	rows, err := r.DB.QueryContext(ctx, `
SELECT id, project_id, name, goal, start_date, end_date, status, velocity, created_at, updated_at
FROM sprints WHERE project_id=?
ORDER BY start_date DESC, id DESC`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Sprint{}
	for rows.Next() {
		s, err := scanSprint(rows)
		if err != nil {
			return nil, err
		}
		ids, err := loadSprintItemIDs(ctx, r.DB, s.ID)
		if err != nil {
			return nil, err
		}
		s.Items = sprintItemsFromIDs(ids)
		s.ItemCount = len(ids)
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r MySQLRepository) GetSprint(ctx context.Context, id int64) (Sprint, error) {
	return loadSprintFull(ctx, r.DB, id)
}

func (r MySQLRepository) CreateSprint(ctx context.Context, in SprintCreateInput) (Sprint, error) {
	name, err := normalizeSprintName(in.Name)
	if err != nil {
		return Sprint{}, err
	}
	goal, err := normalizeSprintGoal(in.Goal)
	if err != nil {
		return Sprint{}, err
	}
	start, err := parseSprintDate(in.StartDate)
	if err != nil {
		return Sprint{}, err
	}
	end, err := parseSprintDate(in.EndDate)
	if err != nil {
		return Sprint{}, err
	}
	if err = validateSprintDateRange(start, end); err != nil {
		return Sprint{}, err
	}
	if in.ProjectID <= 0 {
		return Sprint{}, ErrProject
	}
	res, err := r.DB.ExecContext(ctx, `
INSERT INTO sprints(project_id, name, goal, start_date, end_date, status, velocity)
VALUES(?,?,?,?,?,?,NULL)`, in.ProjectID, name, goal, start, end, SprintStatusPlanned)
	if err != nil {
		return Sprint{}, dbError(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Sprint{}, err
	}
	return loadSprintFull(ctx, r.DB, id)
}

func (r MySQLRepository) UpdateSprint(ctx context.Context, id int64, p SprintPatch) (Sprint, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Sprint{}, err
	}
	defer tx.Rollback()
	s, err := loadSprintRow(ctx, tx, id)
	if err != nil {
		return Sprint{}, err
	}
	if p.Name != nil {
		name, err := normalizeSprintName(*p.Name)
		if err != nil {
			return Sprint{}, err
		}
		s.Name = name
	}
	if p.Goal != nil {
		goal, err := normalizeSprintGoal(*p.Goal)
		if err != nil {
			return Sprint{}, err
		}
		s.Goal = goal
	}
	start, end := s.StartDate, s.EndDate
	if p.StartDate != nil {
		start, err = parseSprintDate(*p.StartDate)
		if err != nil {
			return Sprint{}, err
		}
	}
	if p.EndDate != nil {
		end, err = parseSprintDate(*p.EndDate)
		if err != nil {
			return Sprint{}, err
		}
	}
	if err = validateSprintDateRange(start, end); err != nil {
		return Sprint{}, err
	}
	s.StartDate, s.EndDate = start, end
	if p.ClearVelocity {
		if s.Status != SprintStatusCompleted {
			return Sprint{}, ErrSprint
		}
		s.Velocity = nil
	} else if p.Velocity != nil {
		if s.Status != SprintStatusCompleted {
			return Sprint{}, ErrSprint
		}
		if *p.Velocity < 0 {
			return Sprint{}, ErrSprint
		}
		v := *p.Velocity
		s.Velocity = &v
	}
	_, err = tx.ExecContext(ctx, `
UPDATE sprints SET name=?, goal=?, start_date=?, end_date=?, velocity=? WHERE id=?`,
		s.Name, s.Goal, s.StartDate, s.EndDate, nullInt(s.Velocity), id)
	if err != nil {
		return Sprint{}, err
	}
	out, err := loadSprintFull(ctx, tx, id)
	if err != nil {
		return Sprint{}, err
	}
	return out, tx.Commit()
}

func (r MySQLRepository) DeleteSprint(ctx context.Context, id int64) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	s, err := loadSprintRow(ctx, tx, id)
	if err != nil {
		return err
	}
	if s.Status == SprintStatusCompleted {
		return ErrSprintConflict
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM sprints WHERE id=?`, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

func (r MySQLRepository) ReplaceSprintItems(ctx context.Context, id int64, itemIDs, retainIDs []int64) (Sprint, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Sprint{}, err
	}
	defer tx.Rollback()
	s, err := loadSprintRow(ctx, tx, id)
	if err != nil {
		return Sprint{}, err
	}
	if s.Status == SprintStatusCompleted {
		return Sprint{}, ErrSprintConflict
	}
	prevItems, err := loadSprintItems(ctx, tx, id)
	if err != nil {
		return Sprint{}, err
	}
	prevOrder := make([]int64, len(prevItems))
	for i, it := range prevItems {
		prevOrder[i] = it.ID
	}
	final, err := buildFinalSprintItemIDs(prevOrder, itemIDs, retainIDs)
	if err != nil {
		return Sprint{}, err
	}
	for _, iid := range final {
		if err = assertSprintMemberEligible(ctx, tx, s, iid); err != nil {
			return Sprint{}, err
		}
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM sprint_items WHERE sprint_id=?`, id); err != nil {
		return Sprint{}, err
	}
	for pos, iid := range final {
		if _, err = tx.ExecContext(ctx, `INSERT INTO sprint_items(sprint_id, item_id, position) VALUES(?,?,?)`, id, iid, pos); err != nil {
			return Sprint{}, err
		}
	}
	out, err := loadSprintFull(ctx, tx, id)
	if err != nil {
		return Sprint{}, err
	}
	return out, tx.Commit()
}

func (r MySQLRepository) ActivateSprint(ctx context.Context, id int64) (Sprint, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Sprint{}, err
	}
	defer tx.Rollback()
	s, err := loadSprintRow(ctx, tx, id)
	if err != nil {
		return Sprint{}, err
	}
	if s.Status != SprintStatusPlanned {
		return Sprint{}, ErrSprintConflict
	}
	// Lock planned/active rows in this project before the active conflict check (concurrent activate).
	lockRows, err := tx.QueryContext(ctx, `
SELECT id FROM sprints WHERE project_id=? AND status IN (?, ?) FOR UPDATE`,
		s.ProjectID, SprintStatusPlanned, SprintStatusActive)
	if err != nil {
		return Sprint{}, err
	}
	if err = lockRows.Close(); err != nil {
		return Sprint{}, err
	}
	var other int64
	err = tx.QueryRowContext(ctx, `
SELECT id FROM sprints WHERE project_id=? AND status=? AND id<>? LIMIT 1`,
		s.ProjectID, SprintStatusActive, id).Scan(&other)
	if err == nil {
		return Sprint{}, ErrSprintConflict
	}
	if err != sql.ErrNoRows {
		return Sprint{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE sprints SET status=? WHERE id=?`, SprintStatusActive, id); err != nil {
		return Sprint{}, err
	}
	out, err := loadSprintFull(ctx, tx, id)
	if err != nil {
		return Sprint{}, err
	}
	return out, tx.Commit()
}

func (r MySQLRepository) CompleteSprint(ctx context.Context, id int64, velocity *int) (Sprint, error) {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Sprint{}, err
	}
	defer tx.Rollback()
	s, err := loadSprintRow(ctx, tx, id)
	if err != nil {
		return Sprint{}, err
	}
	if s.Status != SprintStatusActive {
		return Sprint{}, ErrSprintConflict
	}
	if velocity != nil && *velocity < 0 {
		return Sprint{}, ErrSprint
	}
	_, err = tx.ExecContext(ctx, `UPDATE sprints SET status=?, velocity=? WHERE id=?`,
		SprintStatusCompleted, nullInt(velocity), id)
	if err != nil {
		return Sprint{}, err
	}
	out, err := loadSprintFull(ctx, tx, id)
	if err != nil {
		return Sprint{}, err
	}
	return out, tx.Commit()
}

func (r MySQLRepository) CountSprintsForProject(ctx context.Context, projectID int64) (int64, error) {
	var n int64
	err := r.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM sprints WHERE project_id=?`, projectID).Scan(&n)
	return n, err
}

func (r MySQLRepository) DeleteSprintItemsForItem(ctx context.Context, itemID int64) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM sprint_items WHERE item_id=?`, itemID)
	return err
}

func deleteSprintItemsForItemTx(ctx context.Context, tx *sql.Tx, itemID int64) error {
	_, err := tx.ExecContext(ctx, `DELETE FROM sprint_items WHERE item_id=?`, itemID)
	return err
}

func assertSprintMemberEligible(ctx context.Context, tx *sql.Tx, sprint Sprint, itemID int64) error {
	var projectID int64
	var deletedAt sql.NullTime
	err := tx.QueryRowContext(ctx, `SELECT project_id, deleted_at FROM items WHERE id=? FOR UPDATE`, itemID).Scan(&projectID, &deletedAt)
	if err != nil {
		return dbError(err)
	}
	if deletedAt.Valid {
		return ErrNotFound
	}
	if projectID != sprint.ProjectID {
		return ErrSprint
	}
	var otherSprint int64
	err = tx.QueryRowContext(ctx, `
SELECT si.sprint_id FROM sprint_items si
JOIN sprints s ON s.id=si.sprint_id
WHERE si.item_id=? AND s.status IN (?,?) AND si.sprint_id<>?
LIMIT 1`, itemID, SprintStatusPlanned, SprintStatusActive, sprint.ID).Scan(&otherSprint)
	if err == nil {
		return ErrSprintConflict
	}
	if err != sql.ErrNoRows {
		return err
	}
	return nil
}

type sprintQuerier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func loadSprintFull(ctx context.Context, q sprintQuerier, id int64) (Sprint, error) {
	s, err := loadSprintRow(ctx, q, id)
	if err != nil {
		return Sprint{}, err
	}
	items, err := loadSprintItems(ctx, q, id)
	if err != nil {
		return Sprint{}, err
	}
	s.Items = items
	s.ItemCount = len(items)
	return s, nil
}

func loadSprintRow(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, id int64) (Sprint, error) {
	row := q.QueryRowContext(ctx, `
SELECT id, project_id, name, goal, start_date, end_date, status, velocity, created_at, updated_at
FROM sprints WHERE id=?`, id)
	return scanSprint(row)
}

func loadSprintItemIDs(ctx context.Context, q interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, sprintID int64) ([]int64, error) {
	rows, err := q.QueryContext(ctx, `
SELECT si.item_id
FROM sprint_items si
JOIN items c ON c.id=si.item_id
WHERE si.sprint_id=? AND c.deleted_at IS NULL
  AND c.project_id=(SELECT project_id FROM sprints WHERE id=?)
ORDER BY si.position ASC, c.id ASC`, sprintID, sprintID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []int64{}
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func sprintItemsFromIDs(ids []int64) []SprintItem {
	if len(ids) == 0 {
		return nil
	}
	out := make([]SprintItem, len(ids))
	for i, id := range ids {
		out[i] = SprintItem{ID: id}
	}
	return out
}

func loadSprintItems(ctx context.Context, q interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, sprintID int64) ([]SprintItem, error) {
	rows, err := q.QueryContext(ctx, `
SELECT c.id, n.item_number, c.title, c.column_id
FROM sprint_items si
JOIN items c ON c.id=si.item_id
JOIN item_numbers n ON n.item_id=c.id
WHERE si.sprint_id=? AND c.deleted_at IS NULL
  AND c.project_id=(SELECT project_id FROM sprints WHERE id=?)
ORDER BY si.position ASC, c.id ASC`, sprintID, sprintID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SprintItem{}
	for rows.Next() {
		var it SprintItem
		if err = rows.Scan(&it.ID, &it.Number, &it.Title, &it.ColumnID); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

func scanSprint(s scanner) (Sprint, error) {
	var sp Sprint
	var start, end time.Time
	var vel sql.NullInt64
	var status string
	err := s.Scan(&sp.ID, &sp.ProjectID, &sp.Name, &sp.Goal, &start, &end, &status, &vel, &sp.CreatedAt, &sp.UpdatedAt)
	if err != nil {
		return Sprint{}, dbError(err)
	}
	sp.StartDate = start.Format("2006-01-02")
	sp.EndDate = end.Format("2006-01-02")
	sp.Status = SprintStatus(status)
	if vel.Valid {
		v := int(vel.Int64)
		sp.Velocity = &v
	}
	return sp, nil
}

func nullInt(v *int) any {
	if v == nil {
		return nil
	}
	return *v
}
